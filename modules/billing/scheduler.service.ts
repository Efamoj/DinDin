/**
 * src/services/billing/scheduler.service.ts
 *
 * Jobs agendados (cron-like via BullMQ repeatable jobs):
 * - Alerta de sexta-feira (Fluxo comportamental)
 * - Verificação de limite diário sem gastos
 * - Expiração de trial → disparo do Fluxo 4
 * - Rotação de saldo mensal no 1º dia
 */

import { Queue, Worker } from 'bullmq';
import { redis } from '../../infra/cache/redis.client.js';
import { prisma } from '../../infra/database/prisma.client.js';
import { UserService } from '../user/user.service.js';
import { PlanRenewalFlow } from '../../flows/plan-renewal.flow.js';
import { logger } from '../../utils/logger.js';
import type { WhatsAppGateway } from '../../gateway/whatsapp.gateway.js';

const schedulerQueue = new Queue('scheduler', {
  connection: redis,
});

export class SchedulerService {
  private userService = new UserService();

  constructor(private gateway: WhatsAppGateway) {}

  /** Registra todos os jobs recorrentes */
  async registerJobs(): Promise<void> {
    // Remove jobs anteriores para evitar duplicatas
    await schedulerQueue.obliterate({ force: true });

    // Verifica trials expirando — a cada hora
    await schedulerQueue.add(
      'check-expiring-trials',
      {},
      { repeat: { pattern: '0 * * * *' } }
    );

    // Alerta de sexta-feira — sextas às 10h
    await schedulerQueue.add(
      'friday-nudge',
      {},
      { repeat: { pattern: '0 10 * * 5' } }
    );

    // Sem gastos registrados hoje — alerta às 21h
    await schedulerQueue.add(
      'no-expense-reminder',
      {},
      { repeat: { pattern: '0 21 * * *' } }
    );

    // Reset de saldo mensal — 1º de cada mês às 00:01
    await schedulerQueue.add(
      'monthly-reset',
      {},
      { repeat: { pattern: '1 0 1 * *' } }
    );

    logger.info('Scheduler jobs registrados');
  }

  /** Inicializa o worker que processa os jobs */
  startWorker(): Worker {
    return new Worker(
      'scheduler',
      async (job) => {
        logger.debug({ jobName: job.name }, 'Executando job agendado');

        switch (job.name) {
          case 'check-expiring-trials':
            await this.handleExpiringTrials();
            break;

          case 'friday-nudge':
            await this.handleFridayNudge();
            break;

          case 'no-expense-reminder':
            await this.handleNoExpenseReminder();
            break;

          case 'monthly-reset':
            await this.handleMonthlyReset();
            break;
        }
      },
      { connection: redis }
    );
  }

  // ─── Handlers dos jobs ────────────────────────────────────────────────────

  private async handleExpiringTrials(): Promise<void> {
    const users = await this.userService.getUsersWithExpiringTrial();
    const renewalFlow = new PlanRenewalFlow(this.gateway, this.userService);

    for (const user of users) {
      try {
        await renewalFlow.sendTrialEndMessage(user);
        logger.info('Mensagem de trial enviada');
      } catch (err) {
        logger.error({ err }, 'Erro ao enviar mensagem de trial expirando');
      }
    }

    // Expira assinaturas vencidas
    const expired = await this.userService.expireOldSubscriptions();
    if (expired > 0) logger.info({ count: expired }, 'Assinaturas expiradas');
  }

  private async handleFridayNudge(): Promise<void> {
    // Busca usuários ativos com dados de comportamento de sexta
    const users = await prisma.user.findMany({
      where: {
        subscription: {
          status: { in: ['TRIAL', 'ACTIVE'] },
          expiresAt: { gt: new Date() },
        },
      },
      include: { financialProfile: true },
    });

    for (const user of users) {
      try {
        // Calcula média de gastos nas últimas sextas
        const lastFridays = getPreviousFridays(4);
        const avgSpend = await prisma.expense.aggregate({
          where: {
            userId: user.id,
            occurredAt: { in: lastFridays.map((d) => d) },
          },
          _avg: { amount: true },
        });

        const avg = avgSpend._avg.amount ?? 0;
        if (avg < 10) continue; // não há padrão relevante

        const jid = user.phone.replace('+', '') + '@s.whatsapp.net';
        const idealDaily = user.financialProfile?.monthlyBudget
          ? ((user.financialProfile.monthlyBudget - (user.financialProfile.savingsGoalMonthly ?? 0)) / 30).toFixed(2)
          : null;

        await this.gateway.sendText(
          jid,
          [
            `Eiii, ${user.displayName ?? 'você'}!! chegou a sexta… 🎉`,
            ``,
            `Eu preciso te contar uma coisa. Normalmente você gasta cerca de *R$ ${avg.toFixed(2)}* nas sextas-feiras.`,
            ``,
            `Hoje é um ótimo dia pra testar algo diferente e cuidar mais do seu dinheiro — sem deixar de aproveitar! 😊`,
            ``,
            idealDaily ? `Pra hoje, o ideal seria manter seus gastos em até *R$ ${idealDaily}*.` : null,
            ``,
            `Depois me conta como foi, combinado? 💚`,
          ]
            .filter(Boolean)
            .join('\n')
        );
      } catch (err) {
        logger.error({ err }, 'Erro no friday nudge');
      }
    }
  }

  private async handleNoExpenseReminder(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Usuários ativos que não registraram nada hoje
    const usersWithoutExpenses = await prisma.user.findMany({
      where: {
        subscription: { status: { in: ['TRIAL', 'ACTIVE'] }, expiresAt: { gt: new Date() } },
        expenses: { none: { occurredAt: { gte: today } } },
        displayName: { not: null }, // já concluiu onboarding
      },
    });

    for (const user of usersWithoutExpenses) {
      try {
        const jid = user.phone.replace('+', '') + '@s.whatsapp.net';
        await this.gateway.sendText(
          jid,
          `Oi, ${user.displayName}! 👋 Você não registrou nenhum gasto hoje.\n\nMesmo que não tenha gasto nada, me conta como foi o dia! E se gastou algo, é só me dizer o valor e o que foi 😊`
        );
      } catch (err) {
        logger.error({ err }, 'Erro no reminder de gasto');
      }
    }
  }

  private async handleMonthlyReset(): Promise<void> {
    // Zera currentMonthSpent para todos os usuários no início do mês
    await prisma.financialProfile.updateMany({
      data: { currentMonthSpent: 0 },
    });
    logger.info('Reset mensal de gastos executado');
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function getPreviousFridays(count: number): Date[] {
  const fridays: Date[] = [];
  const d = new Date();
  while (fridays.length < count) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() === 5) fridays.push(new Date(d));
  }
  return fridays;
}
