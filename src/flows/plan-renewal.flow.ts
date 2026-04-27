/**
 * src/flows/plan-renewal.flow.ts
 *
 * Fluxo 4 — Renovação de plano após expiração do trial.
 * Apresenta opções de plano e gera chave PIX para pagamento.
 */
import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';
import { prisma } from '../infra/database/prisma.client.js';
import { logger } from '../utils/logger.js';

const PLANS = {
  '1': { name: 'Inteligente', price: 15, months: 1, plan: 'INTELLIGENT' as const },
  '2': { name: 'Trimestral', price: 40, months: 3, plan: 'QUARTERLY' as const },
} as const;

// Chave PIX do negócio (deve vir de variável de ambiente em produção)
const PIX_KEY = process.env.PIX_KEY ?? 'dindin@pagamentos.com';

export class PlanRenewalFlow {
  constructor(
    private gateway: WhatsAppGateway,
    private userService: UserService
  ) {}

  /** Inicia o fluxo de renovação (chamado pelo scheduler quando trial expira) */
  async start(msg: InboundMessage, user: User): Promise<void> {
    await this.sendPlanMenu(msg.jid, user.displayName ?? 'você');
    await this.userService.setFlowState(user.id, {
      currentFlow: 'PLAN_RENEWAL',
      step: 'AWAIT_PLAN_CHOICE',
      data: {},
    });
  }

  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    const step = flowState?.step ?? 'AWAIT_PLAN_CHOICE';
    const text = msg.text?.trim() ?? '';

    switch (step) {
      case 'AWAIT_PLAN_CHOICE':
        await this.handlePlanChoice(msg, user, text);
        break;
      case 'AWAIT_PAYMENT_CONFIRMATION':
        await this.handlePaymentConfirmation(msg, user, text, flowState);
        break;
      default:
        await this.sendPlanMenu(msg.jid, user.displayName ?? 'você');
    }
  }

  // ─── Passos do fluxo ─────────────────────────────────────────────────────

  private async sendPlanMenu(jid: string, name: string): Promise<void> {
    await this.gateway.sendText(
      jid,
      [
        `${name}, seu período de avaliação terminou 🕐`,
        ``,
        `Mas a boa notícia: você pode continuar com o DinDin por um preço justo! 💚`,
        ``,
        `📋 *Escolha seu plano:*`,
        ``,
        `*1.* 💚 Plano Inteligente — *R$ 15/mês*`,
        `   Registro ilimitado, alertas diários, relatórios mensais`,
        ``,
        `*2.* 💎 Plano Trimestral — *R$ 40/trimestre*`,
        `   Mesmos benefícios + economia de R$ 5`,
        ``,
        `Responda com *1* ou *2* para continuar! 😊`,
      ].join('\n')
    );
  }

  private async handlePlanChoice(msg: InboundMessage, user: User, text: string): Promise<void> {
    const plan = PLANS[text as keyof typeof PLANS];

    if (!plan) {
      await this.gateway.sendText(
        msg.jid,
        `Responde com *1* (Inteligente - R$15/mês) ou *2* (Trimestral - R$40/trim) para escolher seu plano! 😊`
      );
      return;
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.months);

    // Gera um ID de transação PIX fictício (em produção, integraria com API de pagamento)
    const pixTxId = `DINDIN-${user.id.substring(0, 8).toUpperCase()}-${Date.now()}`;

    await this.gateway.sendText(
      msg.jid,
      [
        `Ótima escolha! 🎉 *${plan.name} — R$ ${plan.price}*`,
        ``,
        `Faça o pagamento via PIX:`,
        ``,
        `🔑 *Chave PIX:* \`${PIX_KEY}\``,
        `💰 *Valor:* R$ ${plan.price},00`,
        `📝 *Descrição:* DinDin ${plan.name}`,
        ``,
        `Após pagar, me manda o *comprovante* ou escreve *"paguei"* que eu libero seu acesso! ✅`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'PLAN_RENEWAL',
      step: 'AWAIT_PAYMENT_CONFIRMATION',
      data: { planKey: text, pixTxId, expiresAt: expiresAt.toISOString() },
    });

    logger.info({ userId: user.id, plan: plan.name, pixTxId }, 'PIX gerado para renovação');
  }

  private async handlePaymentConfirmation(
    msg: InboundMessage,
    user: User,
    text: string,
    flowState: FlowState | null
  ): Promise<void> {
    const ctx = (flowState?.context as Record<string, unknown>) ?? {};
    const CONFIRMATION_WORDS = ['paguei', 'pago', 'paguei!', 'fiz', 'realizei', 'ok', 'feito'];

    const confirmed = CONFIRMATION_WORDS.some((w) => text.toLowerCase().includes(w));

    if (!confirmed && msg.type !== 'image' && msg.type !== 'document') {
      await this.gateway.sendText(
        msg.jid,
        [
          `Ainda não recebi a confirmação do seu pagamento 😊`,
          ``,
          `Após pagar, escreve *"paguei"* ou me manda o comprovante!`,
          `Se tiver algum problema, digita *"ajuda"* 🙏`,
        ].join('\n')
      );
      return;
    }

    // Em produção: verificar via API de pagamento usando pixTxId
    // Por ora: ativa manualmente mediante confirmação do usuário
    const planKey = ctx.planKey as keyof typeof PLANS;
    const plan = PLANS[planKey] ?? PLANS['1'];
    const expiresAt = ctx.expiresAt ? new Date(ctx.expiresAt as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        plan: plan.plan,
        status: 'ACTIVE',
        expiresAt,
        pixTxId: ctx.pixTxId as string,
      },
      update: {
        plan: plan.plan,
        status: 'ACTIVE',
        expiresAt,
        pixTxId: ctx.pixTxId as string,
      },
    });

    await this.gateway.sendText(
      msg.jid,
      [
        `🎊 *Acesso liberado!* Seja bem-vindo(a) ao plano ${plan.name}!`,
        ``,
        `Seu acesso está ativo até *${expiresAt.toLocaleDateString('pt-BR')}* ✅`,
        ``,
        `Continue me mandando seus gastos que vou te ajudar a cada dia! 💚`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'DAILY_LOG',
      step: 'IDLE',
      data: {},
    });

    logger.info({ userId: user.id, plan: plan.name }, 'Assinatura ativada');
  }
}
