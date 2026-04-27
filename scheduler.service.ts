/**
 * src/services/billing/scheduler.service.ts
 *
 * Jobs agendados usando BullMQ repeat.
 * - Trial expirando em 1 dia → aviso
 * - Trial expirado → inicia fluxo de renovação
 * - Reset mensal de gastos
 * - Nudge de sexta-feira
 * - Relatório mensal automático
 */
import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { UserService } from '../user/user.service.js';
import { ReportService } from '../report/report.service.js';
import { prisma } from '../../infra/database/prisma.client.js';
import type { WhatsAppGateway } from '../../gateway/whatsapp.gateway.js';

const connection = { url: env.REDIS_URL };

type ScheduledJobType =
  | 'check-expiring-trials'
  | 'expire-subscriptions'
  | 'monthly-reset'
  | 'friday-nudge'
  | 'monthly-report';

export class SchedulerService {
  private queue: Queue;
  private worker: Worker | null = null;
  private userService: UserService;
  private reportService: ReportService;

  constructor(private gateway: WhatsAppGateway) {
    this.queue = new Queue('scheduler', { connection });
    this.userService = new UserService();
    this.reportService = new ReportService();
  }

  /** Registra os jobs recorrentes */
  async registerJobs(): Promise<void> {
    const jobs: { name: ScheduledJobType; cron: string; desc: string }[] = [
      { name: 'check-expiring-trials', cron: '0 9 * * *',    desc: 'Verifica trials expirando amanhã (9h)' },
      { name: 'expire-subscriptions',  cron: '5 0 * * *',    desc: 'Expira assinaturas vencidas (meia-noite)' },
      { name: 'monthly-reset',          cron: '0 1 1 * *',    desc: 'Reset de gastos mensais (1° dia do mês)' },
      { name: 'friday-nudge',           cron: '0 18 * * 5',   desc: 'Nudge de sexta-feira (18h)' },
      { name: 'monthly-report',         cron: '0 8 28 * *',   desc: 'Relatório mensal automático (dia 28)' },
    ];

    for (const job of jobs) {
      await this.queue.add(job.name, {}, { repeat: { pattern: job.cron }, jobId: job.name });
      logger.info({ job: job.name, cron: job.cron }, job.desc);
    }
  }

  /** Inicia o worker que processa os jobs agendados */
  startWorker(): void {
    this.worker = new Worker<{}, void, ScheduledJobType>(
      'scheduler',
      async (job: Job<{}, void, ScheduledJobType>) => {
        logger.info({ jobName: job.name }, `Executando job agendado: ${job.name}`);

        switch (job.name) {
          case 'check-expiring-trials':
            await this.checkExpiringTrials();
            break;
          case 'expire-subscriptions':
            await this.expireSubscriptions();
            break;
          case 'monthly-reset':
            await this.monthlyReset();
            break;
          case 'friday-nudge':
            await this.fridayNudge();
            break;
          case 'monthly-report':
            await this.sendMonthlyReports();
            break;
        }
      },
      { connection }
    );

    this.worker.on('failed', (job, err) =>
      logger.error({ jobName: job?.name, err }, 'Job agendado falhou')
    );
  }

  // ─── Implementações dos jobs ───────────────────────────────────────────────

  private async checkExpiringTrials(): Promise<void> {
    const users = await this.userService.getUsersExpiringIn(1);

    for (const user of users) {
      if (!user.phone) continue;
      // Envia aviso de trial expirando
      // Usa JID do WhatsApp (phone sem + + @s.whatsapp.net)
      const jid = user.phone.replace('+', '') + '@s.whatsapp.net';
      await this.gateway.sendText(
        jid,
        [
          `Oi, ${user.displayName ?? 'você'}! 👋`,
          ``,
          `Seu período de avaliação do *DinDin* termina *amanhã* ⏰`,
          ``,
          `Para continuar tendo seu assistente financeiro, escolha um plano:`,
          `💚 *Inteligente* — R$ 15/mês`,
          `💎 *Trimestral* — R$ 40/trimestre`,
          ``,
          `Responde *"quero continuar"* e eu te mostro como é fácil! 😊`,
        ].join('\n')
      );
    }

    logger.info({ count: users.length }, 'Avisos de trial expirado enviados');
  }

  private async expireSubscriptions(): Promise<void> {
    const expired = await this.userService.expireOverdueSubscriptions();

    for (const user of expired) {
      if (!user.phone) continue;
      const jid = user.phone.replace('+', '') + '@s.whatsapp.net';

      await this.gateway.sendText(
        jid,
        [
          `Oi, ${user.displayName ?? 'você'}! Seu acesso ao DinDin expirou hoje 😢`,
          ``,
          `Mas não se preocupa — seus dados estão guardados!`,
          `Para continuar, é só escolher um plano. Responde *"planos"* que te mostro as opções 💚`,
        ].join('\n')
      );

      // Coloca usuário no fluxo de renovação
      await this.userService.setFlowState(user.id, {
        currentFlow: 'PLAN_RENEWAL',
        step: 'AWAIT_PLAN_CHOICE',
        data: {},
      });
    }

    logger.info({ count: expired.length }, 'Assinaturas expiradas processadas');
  }

  private async monthlyReset(): Promise<void> {
    // Reseta gasto do mês atual para todos os perfis
    await prisma.financialProfile.updateMany({
      data: { currentMonthSpent: 0 },
    });
    logger.info('Reset mensal de gastos realizado');
  }

  private async fridayNudge(): Promise<void> {
    // Busca usuários com assinatura ativa
    const subs = await prisma.subscription.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    const messages = [
      `Sexta-feira chegou! 🎉 Cuidado com os gastos do fim de semana — eles costumam surpreender!`,
      `Fim de semana à vista! 🌟 Que tal checar seus gastos desta semana antes de sair por aí?`,
      `Sexta-feira! 💚 Lembra de registrar seus gastos do final de semana. Eu fico de olho com você!`,
    ];

    for (const sub of subs) {
      if (!sub.user.phone) continue;
      const jid = sub.user.phone.replace('+', '') + '@s.whatsapp.net';
      const msg = messages[Math.floor(Math.random() * messages.length)]!;
      await this.gateway.sendText(jid, msg).catch(() => {}); // não deixa um erro travar os outros
    }

    logger.info({ count: subs.length }, 'Nudge de sexta-feira enviado');
  }

  private async sendMonthlyReports(): Promise<void> {
    const subs = await prisma.subscription.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    for (const sub of subs) {
      if (!sub.user.phone) continue;
      const jid = sub.user.phone.replace('+', '') + '@s.whatsapp.net';

      try {
        const report = await this.reportService.generateMonthlyReport(sub.userId);
        await this.gateway.sendText(
          jid,
          `🗓️ *Relatório automático do mês:*\n\n${report}\n\nContinue assim! 💚`
        );
      } catch (err) {
        logger.error({ err, userId: sub.userId }, 'Erro ao enviar relatório mensal');
      }
    }

    logger.info({ count: subs.length }, 'Relatórios mensais enviados');
  }
}
