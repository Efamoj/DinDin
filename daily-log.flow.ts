/**
 * src/flows/daily-log.flow.ts
 *
 * Fluxo 3 — Registro diário de gastos (modo livre com IA)
 * Também lida com áudio (transcreve antes de processar).
 */

import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { FinancialAgent } from '../agent/financial.agent.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';
import { prisma } from '../infra/database/prisma.client.js';
import { logger } from '../utils/logger.js';

export class DailyLogFlow {
  constructor(
    private gateway: WhatsAppGateway,
    private agent: FinancialAgent,
    private userService: UserService
  ) {}

  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    let text = msg.text ?? '';

    // ── Áudio: transcreve antes de processar ──────────────────────────────
    if (msg.type === 'audio') {
      text = await this.transcribeAudio(msg, user.id);
      if (!text) {
        await this.gateway.sendText(
          msg.jid,
          'Não consegui entender o áudio 😅 Pode me dizer por texto também? Ex: *"50 almoço"*'
        );
        return;
      }
    }

    // ── PDF de extrato ────────────────────────────────────────────────────
    if (msg.type === 'pdf') {
      const { StatementQueue } = await import('../infra/queue/statement.queue.js');
      await StatementQueue.add('process-statement', { userId: user.id, jid: msg.jid, messageId: msg.id });
      await this.gateway.sendText(msg.jid, '⏳ Já estou analisando seu extrato!');
      return;
    }

    if (!text) return;

    // ── Busca contexto financeiro e histórico ─────────────────────────────
    const [profile, history] = await Promise.all([
      prisma.financialProfile.findUnique({ where: { userId: user.id } }),
      prisma.conversation.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const daysLeft = daysRemainingInMonth();
    const availableBalance = profile?.monthlyBudget
      ? profile.monthlyBudget - (profile.currentMonthSpent ?? 0)
      : undefined;

    const idealDailyLimit =
      availableBalance && daysLeft > 0
        ? (availableBalance - (profile?.savingsGoalMonthly ?? 0)) / daysLeft
        : undefined;

    // ── Chama o agente de IA ──────────────────────────────────────────────
    const agentResponse = await this.agent.process({
      userMessage: text,
      userName: user.displayName ?? undefined,
      financialContext: {
        monthlyBudget: profile?.monthlyBudget ?? undefined,
        currentMonthSpent: profile?.currentMonthSpent ?? 0,
        availableBalance,
        savingsGoalMonthly: profile?.savingsGoalMonthly ?? undefined,
        daysLeftInMonth: daysLeft,
        idealDailyLimit,
        riskLevel: profile?.riskLevel ?? 'MEDIUM',
        planType: 'TRIAL',
      },
      conversationHistory: history.map((h) => ({ role: h.role, content: h.content })),
    });

    // ── Registra gasto se detectado ───────────────────────────────────────
    if (agentResponse.intent === 'REGISTER_EXPENSE' && agentResponse.extractedExpense) {
      const { amount, description, category } = agentResponse.extractedExpense;

      await prisma.$transaction([
        prisma.expense.create({
          data: {
            userId: user.id,
            amount,
            description,
            category: (category as any) ?? 'OTHER',
            source: msg.type === 'audio' ? 'AUDIO' : 'MANUAL',
          },
        }),
        prisma.financialProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, currentMonthSpent: amount },
          update: { currentMonthSpent: { increment: amount } },
        }),
      ]);
    }

    // ── Salva no histórico de conversa ────────────────────────────────────
    await prisma.conversation.createMany({
      data: [
        { userId: user.id, role: 'USER', content: text },
        { userId: user.id, role: 'ASSISTANT', content: agentResponse.reply },
      ],
    });

    // ── Envia resposta ────────────────────────────────────────────────────
    await this.gateway.sendText(msg.jid, agentResponse.reply);

    // ── Alerta de limite diário (80%) ─────────────────────────────────────
    await this.checkDailyLimitAlert(user, msg.jid, idealDailyLimit);
  }

  private async transcribeAudio(msg: InboundMessage, userId: string): Promise<string> {
    try {
      const audioBuffer = await (this.gateway as any).downloadMedia(msg.raw);
      // Importa worker de transcrição (Whisper via queue)
      const { AudioQueue } = await import('../infra/queue/audio.queue.js');
      const job = await AudioQueue.add('transcribe', { userId, audioBuffer: audioBuffer.toString('base64') });
      // Para MVP: retorna placeholder — em produção, aguarda o job via polling ou webhook
      return '';
    } catch (err) {
      logger.error({ err, userId }, 'Erro na transcrição de áudio');
      return '';
    }
  }

  private async checkDailyLimitAlert(user: User, jid: string, idealDailyLimit?: number) {
    if (!idealDailyLimit) return;

    // Gastos de hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySpent = await prisma.expense.aggregate({
      where: { userId: user.id, occurredAt: { gte: today } },
      _sum: { amount: true },
    });

    const spent = todaySpent._sum.amount ?? 0;
    const percentage = (spent / idealDailyLimit) * 100;

    if (percentage >= 80 && percentage < 100) {
      await this.gateway.sendText(
        jid,
        `⚠️ *Opa!* Você já usou *${percentage.toFixed(0)}%* do seu limite diário hoje.\n\nFique de olho para não ultrapassar e manter sua meta no trilho! 💪`
      );
    } else if (percentage >= 100) {
      await this.gateway.sendText(
        jid,
        `🚨 Você passou do seu limite diário hoje. Mas calma — um dia não define o mês! Amanhã é uma nova chance. 💚`
      );
    }
  }
}

function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}
