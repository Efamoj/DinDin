/**
 * src/gateway/whatsapp.gateway.ts
 *
 * Camada de entrada do WhatsApp via Baileys.
 * Responsabilidades:
 *  - Gerenciar conexão/reconexão
 *  - Descriptografar sessão do disco
 *  - Normalizar eventos brutos para InboundMessage
 *  - NÃO conter lógica de negócio
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { InboundMessage, MessageType } from '../types/message.types.js';

type MessageHandler = (msg: InboundMessage) => Promise<void>;

export class WhatsAppGateway {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private onMessageHandler: MessageHandler | null = null;
  private sessionDir: string;

  constructor() {
    this.sessionDir = env.WA_SESSION_DIR;
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /** Registra o handler que receberá todas as mensagens normalizadas */
  onMessage(handler: MessageHandler) {
    this.onMessageHandler = handler;
  }

  async connect(): Promise<void> {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger as any),
      },
      printQRInTerminal: true,
      logger: logger as any,
      // Não processar mensagens históricas no primeiro boot
      syncFullHistory: false,
      // Ignorar broadcast e status
      shouldIgnoreJid: (jid) => jid.includes('broadcast') || jid.includes('status'),
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR Code gerado — escaneie com seu WhatsApp');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        logger.warn({ shouldReconnect }, 'Conexão WhatsApp encerrada');

        if (shouldReconnect) {
          setTimeout(() => this.connect(), 5_000);
        }
      }

      if (connection === 'open') {
        logger.info('✅  WhatsApp conectado com sucesso');
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const raw of messages) {
        if (raw.key.fromMe) continue; // ignorar mensagens enviadas pelo bot

        try {
          const normalized = this.normalizeMessage(raw);
          if (normalized && this.onMessageHandler) {
            await this.onMessageHandler(normalized);
          }
        } catch (err) {
          logger.error({ err, msgId: raw.key.id }, 'Erro ao processar mensagem recebida');
        }
      }
    });
  }

  /** Envia mensagem de texto */
  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('Gateway não inicializado');
    await this.sock.sendMessage(jid, { text });
  }

  /** Envia imagem com legenda */
  async sendImage(jid: string, buffer: Buffer, caption?: string): Promise<void> {
    if (!this.sock) throw new Error('Gateway não inicializado');
    await this.sock.sendMessage(jid, { image: buffer, caption });
  }

  /** Marca mensagem como "lida" */
  async markAsRead(jid: string, msgId: string): Promise<void> {
    if (!this.sock) throw new Error('Gateway não inicializado');
    await this.sock.readMessages([{ remoteJid: jid, id: msgId }]);
  }

  /** Baixa mídia (PDF, áudio) de uma mensagem */
  async downloadMedia(msg: WAMessage): Promise<Buffer> {
    if (!this.sock) throw new Error('Gateway não inicializado');
    const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
    const msgContent = msg.message;

    let mediaType: 'document' | 'audio' | 'image';
    if (msgContent?.documentMessage) mediaType = 'document';
    else if (msgContent?.audioMessage) mediaType = 'audio';
    else if (msgContent?.imageMessage) mediaType = 'image';
    else throw new Error('Tipo de mídia não suportado');

    const stream = await downloadContentFromMessage(
      msgContent[`${mediaType}Message`] as any,
      mediaType
    );

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  // ─── Normalização ─────────────────────────────────────────────────────────

  private normalizeMessage(raw: WAMessage): InboundMessage | null {
    const jid = raw.key.remoteJid;
    if (!jid) return null;

    // Apenas mensagens de usuários individuais (não grupos)
    if (jid.endsWith('@g.us')) return null;

    const phone = jid.replace('@s.whatsapp.net', '');
    const msg = raw.message;
    if (!msg) return null;

    let type: MessageType = 'unknown';
    let text: string | undefined;

    if (msg.conversation || msg.extendedTextMessage?.text) {
      type = 'text';
      text = msg.conversation ?? msg.extendedTextMessage?.text ?? '';
    } else if (msg.audioMessage) {
      type = 'audio';
    } else if (msg.documentMessage) {
      const mime = msg.documentMessage.mimetype ?? '';
      type = mime === 'application/pdf' ? 'pdf' : 'document';
    } else if (msg.imageMessage) {
      type = 'image';
    }

    return {
      id: raw.key.id ?? '',
      jid,
      phone: this.sanitizePhone(phone),
      type,
      text,
      raw,
      timestamp: (raw.messageTimestamp as number) ?? Date.now(),
    };
  }

  /** Remove caracteres inválidos e padroniza o número */
  private sanitizePhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '').replace(/^(\d{2})(\d+)$/, '+$1$2');
  }
}
