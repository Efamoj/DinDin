/**
 * src/flows/onboarding.flow.ts
 *
 * Fluxo 1 — Primeiro contato + configuração do trial de 10 dias.
 *
 * Passos:
 *   WELCOME → ASK_NAME → ASK_BUDGET → ASK_GOAL → COMPLETE
 */
import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { FinancialAgent } from '../agent/financial.agent.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';
import { prisma } from '../infra/database/prisma.client.js';
import { logger } from '../utils/logger.js';

export class OnboardingFlow {
  constructor(
    private gateway: WhatsAppGateway,
    private agent: FinancialAgent,
    private userService: UserService
  ) {}

  /** Inicia o onboarding para um novo usuário */
  async start(msg: InboundMessage, user: User): Promise<void> {
    await this.gateway.sendText(
      msg.jid,
      [
        `Olá! 👋 Seja bem-vindo(a) ao *DinDin* — seu assistente financeiro pessoal!`,
        ``,
        `Estou aqui para te ajudar a entender para onde vai seu dinheiro e economizar *sem sofrimento* 💚`,
        ``,
        `Você tem *10 dias grátis* para experimentar tudo. Vamos começar?`,
        ``,
        `Primeiro: como você quer que eu te chame? 😊`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_NAME',
      data: {},
    });
  }

  /** Processa mensagens durante o onboarding */
  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    const step = flowState?.step ?? 'ASK_NAME';
    const text = msg.text?.trim() ?? '';

    switch (step) {
      case 'ASK_NAME':
        await this.handleAskName(msg, user, text);
        break;
      case 'ASK_BUDGET':
        await this.handleAskBudget(msg, user, text, flowState);
        break;
      case 'ASK_GOAL':
        await this.handleAskGoal(msg, user, text, flowState);
        break;
      default:
        await this.start(msg, user);
    }
  }

  // ─── Passos do onboarding ───────────────────────────────────────────────

  private async handleAskName(msg: InboundMessage, user: User, text: string): Promise<void> {
    if (!text || text.length < 2) {
      await this.gateway.sendText(msg.jid, 'Me diz seu nome! 😄');
      return;
    }

    // Capitaliza o nome
    const name = text.split(' ')[0]!;
    const displayName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

    await this.userService.updateName(user.id, displayName);

    await this.gateway.sendText(
      msg.jid,
      [
        `Prazer, *${displayName}*! 🎉`,
        ``,
        `Agora me conta: qual é o seu *orçamento mensal* — quanto você tem disponível para gastar no mês?`,
        ``,
        `Pode me dizer assim: _"R$ 3000"_ ou _"2500"_ 💰`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_BUDGET',
      data: { displayName },
    });
  }

  private async handleAskBudget(
    msg: InboundMessage,
    user: User,
    text: string,
    flowState: FlowState | null
  ): Promise<void> {
    const amount = parseMoney(text);
    const ctx = (flowState?.context as Record<string, unknown>) ?? {};

    if (!amount || amount <= 0) {
      await this.gateway.sendText(
        msg.jid,
        `Não entendi 😅 Me diz quanto você tem para gastar no mês. Ex: _"R$ 2000"_`
      );
      return;
    }

    // Salva orçamento
    await prisma.financialProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, monthlyBudget: amount, currentMonthSpent: 0 },
      update: { monthlyBudget: amount },
    });

    await this.gateway.sendText(
      msg.jid,
      [
        `Ótimo! Seu orçamento de *R$ ${amount.toFixed(2)}/mês* foi salvo ✅`,
        ``,
        `Agora, você tem alguma *meta de economia*? Quanto quer guardar por mês?`,
        ``,
        `Se não tiver, é só responder _"não"_ ou _"0"_ 🎯`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_GOAL',
      data: { ...ctx, monthlyBudget: amount },
    });
  }

  private async handleAskGoal(
    msg: InboundMessage,
    user: User,
    text: string,
    flowState: FlowState | null
  ): Promise<void> {
    const ctx = (flowState?.context as Record<string, unknown>) ?? {};
    const savingsGoal = parseMoney(text) ?? 0;

    // Atualiza meta de economia
    await prisma.financialProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, savingsGoalMonthly: savingsGoal, currentMonthSpent: 0 },
      update: { savingsGoalMonthly: savingsGoal },
    });

    const goalText =
      savingsGoal > 0
        ? `Vou te ajudar a guardar *R$ ${savingsGoal.toFixed(2)}* por mês! 💪`
        : `Sem problema! Você pode definir uma meta a qualquer momento.`;

    await this.gateway.sendText(
      msg.jid,
      [
        `Tudo certo! 🎊`,
        ``,
        goalText,
        ``,
        `*Seu trial de 10 dias começa agora!*`,
        ``,
        `A partir de hoje, é só me mandar seus gastos assim:`,
        `→ _"gastei 50 no almoço"_`,
        `→ _"uber 15 reais"_`,
        `→ ou me mandar uma mensagem de voz! 🎙️`,
        ``,
        `Também pode me enviar seu extrato em PDF e eu analiso tudo! 📊`,
        ``,
        `Qualquer dúvida, é só digitar _"ajuda"_ 😊`,
      ].join('\n')
    );

    // Finaliza onboarding → modo diário
    await this.userService.setFlowState(user.id, {
      currentFlow: 'DAILY_LOG',
      step: 'IDLE',
      data: {},
    });

    logger.info({ userId: user.id }, 'Onboarding concluído');
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function parseMoney(text: string): number | null {
  if (/^(não|nao|0|nope|no)$/i.test(text.trim())) return 0;

  // Remove "R$", pontos de milhar, substitui vírgula por ponto
  const cleaned = text.replace(/R\$\s*/gi, '').replace(/\./g, '').replace(',', '.').trim();
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}
