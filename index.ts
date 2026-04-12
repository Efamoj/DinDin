/**
 * src/index.ts
 *
 * Entry point — inicializa todos os serviços na ordem correta.
 */

import './config/env.js'; // Valida env imediatamente
import { logger } from './utils/logger.js';
import { WhatsAppGateway } from './gateway/whatsapp.gateway.js';
import { FlowEngine } from './flows/flow.engine.js';
import { SchedulerService } from './services/billing/scheduler.service.js';
import { StatementService } from './services/finance/statement.service.js';
import { createStatementWorker } from './infra/queue/statement.queue.js';
import { redis } from './infra/cache/redis.client.js';
import { prisma } from './infra/database/prisma.client.js';
import { DoubtFlow } from './flows/doubt.flow.js';

async function bootstrap() {
  logger.info('🚀 Iniciando DinDin...');

  // ── 1. Conecta infra ───────────────────────────────────────────────────
  await redis.connect();
  await prisma.$connect();
  logger.info('Banco de dados e cache conectados');

  // ── 2. Inicializa gateway WhatsApp ────────────────────────────────────
  const gateway = new WhatsAppGateway();
  const flowEngine = new FlowEngine(gateway);
  const statementService = new StatementService(gateway);

  // ── 3. Worker de processamento de extratos ────────────────────────────
  createStatementWorker(async (userId, jid, _msgId) => {
    // Baixa o PDF da mensagem WA e processa
    // Em produção: buscar mensagem do armazenamento temporário
    logger.info({ userId }, 'Processando extrato em fila');

    // Placeholder — o buffer real vem do MediaStore
    const result = await statementService.processPdfBuffer(userId, Buffer.alloc(0));
    await gateway.sendText(jid, result);
  });

  // ── 4. Scheduler de jobs proativos ────────────────────────────────────
  const scheduler = new SchedulerService(gateway);
  await scheduler.registerJobs();
  scheduler.startWorker();
  logger.info('Scheduler iniciado');

  // ── 5. Registra handler de mensagens ─────────────────────────────────
  gateway.onMessage(async (msg) => {
    // Atalho rápido para palavras de dúvida (não passa pelo flow engine completo)
    if (msg.type === 'text' && msg.text && DoubtFlow.isDoubtTrigger(msg.text)) {
      // O flow engine lida com o roteamento correto
    }
    await flowEngine.handle(msg);
  });

  // ── 6. Conecta ao WhatsApp ────────────────────────────────────────────
  await gateway.connect();

  // ── 7. Graceful shutdown ──────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando DinDin...');
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Exceção não capturada');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Promise rejeitada não tratada');
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao iniciar');
  process.exit(1);
});
