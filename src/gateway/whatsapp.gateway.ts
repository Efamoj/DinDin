/**
 * src/gateway/whatsapp.gateway.ts
 *
 * Conexão com WhatsApp via Baileys.
 * Normaliza eventos do Baileys para InboundMessage tipado.
 */
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type proto,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { mkdir } from 'fs/promises';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { InboundMessage, MessageType } from '../types/message.types.js';

type MessageHandler = (msg: InboundMessage) => Promise<void>;

export class WhatsAppGateway {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: MessageHandler | null = null;

  /** Registra o handler que será chamado para cada mensagem recebida */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** Inicia a conexão com o WhatsApp */
  async connect(): Promise<void> {
    const sessionDir = env.WA_SESSION_DIR;
    await mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    logger.info({ version }, 'Conectando ao WhatsApp com Baileys');

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: logger.child({ module: 'baileys' }) as any,
      markOnlineOnConnect: false,
    });

    // Salva credenciais quando atualiza
    this.sock.ev.on('creds.update', saveCreds);

    // Gerencia conexão e reconexão
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR Code gerado — escaneie com o WhatsApp');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        logger.warn({ shouldReconnect }, 'Conexão fechada');

        if (shouldReconnect) {
          setTimeout(() => this.connect(), 5000);
        } else {
          logger.error('Sessão encerrada — remova a pasta de sessão e escaneie novamente');
          process.exit(1);
        }
      }

      if (connection === 'open') {
        logger.info('✅ WhatsApp conectado!');
      }
    });

    // Processa mensagens recebidas
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue; // ignora mensagens próprias
        if (!msg.message) continue;

        try {
          const normalized = this.normalizeMessage(msg);
          if (normalized && this.messageHandler) {
            await this.messageHandler(normalized);
          }
        } catch (err) {
          logger.error({ err }, 'Erro ao processar mensagem');
        }
      }
    });
  }

  /** Envia uma mensagem de texto para um JID */
  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp não conectado');
    await this.sock.sendMessage(jid, { text });
  }

  /** Marca mensagem como lida */
  async markAsRead(jid: string, messageId: string): Promise<void> {
    if (!this.sock) return;
    await this.sock.readMessages([{ remoteJid: jid, id: messageId }]);
  }

  /** Baixa mídia de uma mensagem (áudio, imagem, documento) */
  async downloadMedia(rawMessage: WAMessage): Promise<Buffer> {
    if (!this.sock) throw new Error('WhatsApp não conectado');
    const buffer = await downloadMediaMessage(rawMessage, 'buffer', {}, { reuploadRequest: this.sock.updateMediaMessage });
    return buffer as Buffer;
  }

  // ─── Helpers privados ────────────────────────────────────────────────────

  private normalizeMessage(raw: WAMessage): InboundMessage | null {
    const jid = raw.key.remoteJid;
    if (!jid) return null;

    // Extrai número de telefone do JID (remove @s.whatsapp.net e suffixos de grupo)
    const phone = '+' + jid.replace('@s.whatsapp.net', '').replace('@g.us', '').split(':')[0];

    const { type, text } = this.extractContent(raw);

    return {
      id: raw.key.id ?? '',
      jid,
      phone,
      type,
      text,
      raw,
      timestamp: (raw.messageTimestamp as number) ?? Date.now() / 1000,
    };
  }

  private extractContent(raw: WAMessage): { type: MessageType; text?: string } {
    const msg = raw.message;
    if (!msg) return { type: 'unknown' };

    // Texto simples
    if (msg.conversation) {
      return { type: 'text', text: msg.conversation };
    }

    // Texto extendido (links, formatação)
    if (msg.extendedTextMessage?.text) {
      return { type: 'text', text: msg.extendedTextMessage.text };
    }

    // Áudio (mensagem de voz)
    if (msg.audioMessage) {
      return { type: 'audio' };
    }

    // Documento — verifica se é PDF
    if (msg.documentMessage) {
      const mime = msg.documentMessage.mimetype ?? '';
      if (mime.includes('pdf')) return { type: 'pdf' };
      return { type: 'document' };
    }

    // Imagem
    if (msg.imageMessage) {
      return { type: 'image', text: msg.imageMessage.caption ?? undefined };
    }

    return { type: 'unknown' };
  }
}
