/**
 * src/flows/plan-renewal.flow.ts
 *
 * Fluxo 4 — Conversão pós-trial / Renovação de plano.
 * Dispara quando os 10 dias gratuitos terminam.
 */

import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';
import { prisma } from '../infra/database/prisma.client.js';
import { env } from '../config/env.js';

export class PlanRenewalFlow {
  constructor(
    private gateway: WhatsAppGateway,
    private userService: UserService
  ) {}

  /** Envia mensagem proativa de conversão ao fim do trial */
  async sendTrialEndMessage(user: User): Promise<void> {
    const name = user.displayName ?? 'você';

    // Calcula economia estimada no período
    const trialStart = new Date();
    trialStart.setDate(trialStart.getDate() - env.FREE_TRIAL_DAYS);

    const savings = await prisma.expense.aggregate({
      where: { userId: user.id, createdAt: { gte: trialStart } },
      _sum: { amount: true },
    });

    const totalSpent = savings._sum.amount ?? 0;
    const estimatedSavings = (totalSpent * 0.12).toFixed(2); // ~12% de saving estimado
    const projectedMonthly = (parseFloat(estimatedSavings) * 3).toFixed(2);

    await this.gateway.sendText(
      user.phone.replace('+', '') + '@s.whatsapp.net',
      [
        `Finalizamos hoje seu teste gratuito de 10 dias, *${name}*! 🎉`,
        ``,
        `Mas olha só uma coisa importante…`,
        `Nesse período, juntos conseguimos economizar *R$ ${estimatedSavings}*. Agora imagina manter esse acompanhamento por um mês inteiro. A economia pode chegar perto de *R$ ${projectedMonthly}* — e ainda com mais previsibilidade e controle dos seus gastos.`,
        ``,
        `Pra continuar evoluindo, pensei no *Plano Inteligente* pra você:`,
        `💚 *R$ ${env.PLAN_MONTHLY_PRICE_BRL}/mês*`,
        `💚 *R$ ${env.PLAN_QUARTERLY_PRICE_BRL}/trimestre* (você economiza R$ 5)`,
        ``,
        `Muitas vezes uma única decisão melhor no mês já paga o plano inteiro 😉`,
        ``,
        `Quer continuar juntos nessa?`,
        `Responda: *1* Quero mensal | *2* Quero trimestral | *3* Deixa eu pensar`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'PLAN_RENEWAL',
      step: 'AWAIT_CHOICE',
      data: { estimatedSavings, projectedMonthly },
    });
  }

  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    const step = flowState?.step ?? 'AWAIT_CHOICE';
    const ctx = (flowState?.context as Record<string, unknown>) ?? {};

    switch (step) {
      case 'AWAIT_CHOICE':
        await this.handlePlanChoice(msg, user, ctx);
        break;

      case 'AWAIT_PAYMENT_CONFIRM':
        await this.handlePaymentConfirm(msg, user, ctx);
        break;
    }
  }

  private async handlePlanChoice(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    const text = msg.text?.trim() ?? '';

    if (text === '1' || text.toLowerCase().includes('mensal')) {
      await this.sendPaymentInstructions(msg, user, 'INTELLIGENT', ctx);
    } else if (text === '2' || text.toLowerCase().includes('trimestral')) {
      await this.sendPaymentInstructions(msg, user, 'QUARTERLY', ctx);
    } else if (text === '3' || text.toLowerCase().includes('pensar')) {
      await this.gateway.sendText(
        msg.jid,
        `Claro, sem pressão! Quando quiser continuar é só me chamar. Estarei por aqui 💚\n\nEnquanto isso, você ainda pode registrar seus gastos normalmente.`
      );
      await this.userService.setFlowState(user.id, { currentFlow: 'FREE', step: 'IDLE', data: {} });
    } else {
      await this.gateway.sendText(
        msg.jid,
        `Responda *1* para mensal, *2* para trimestral ou *3* para pensar mais 😊`
      );
    }
  }

  private async sendPaymentInstructions(
    msg: InboundMessage,
    user: User,
    plan: 'INTELLIGENT' | 'QUARTERLY',
    ctx: Record<string, unknown>
  ) {
    const price = plan === 'INTELLIGENT' ? env.PLAN_MONTHLY_PRICE_BRL : env.PLAN_QUARTERLY_PRICE_BRL;

    await this.gateway.sendText(
      msg.jid,
      [
        `Que ótima notícia! Fico feliz de verdade em continuar com você nessa. 🥳`,
        ``,
        `Antes de ativar seu plano, só preciso alinhar dois pontos rápidos:`,
        `• O pagamento é feito via *PIX*`,
        `• O acesso fica vinculado a este número`,
        ``,
        `*Chave PIX:* \`${env.PIX_KEY}\``,
        `*Valor:* R$ ${price}`,
        ``,
        `Após o pagamento, me manda o *comprovante* aqui e ativo seu plano na hora! ✅`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'PLAN_RENEWAL',
      step: 'AWAIT_PAYMENT_CONFIRM',
      data: { ...ctx, selectedPlan: plan },
    });
  }

  private async handlePaymentConfirm(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    // Em produção: integrar com webhook PIX para confirmação automática
    // Por ora: aprovação manual / comprovante como imagem
    if (msg.type === 'image' || msg.type === 'pdf') {
      const plan = (ctx.selectedPlan as 'INTELLIGENT' | 'QUARTERLY') ?? 'INTELLIGENT';

      // Salva txId provisional — em produção, vem do webhook PIX
      const txId = `manual_${Date.now()}`;
      await this.userService.activatePaidPlan(user.id, plan, txId);

      await this.gateway.sendText(
        msg.jid,
        `✅ *Plano ativado com sucesso!*\n\nBem-vindo ao próximo nível, ${user.displayName ?? 'você'}! 🚀\n\nContinue registrando seus gastos normalmente. Agora tenho ainda mais ferramentas pra te ajudar a alcançar seus sonhos! 💚`
      );

      await this.userService.setFlowState(user.id, { currentFlow: 'DAILY_LOG', step: 'IDLE', data: {} });
    } else {
      await this.gateway.sendText(
        msg.jid,
        `Me envia o comprovante do PIX como imagem ou PDF pra eu confirmar! 📄`
      );
    }
  }
}
