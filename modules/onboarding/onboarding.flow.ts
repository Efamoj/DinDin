/**
 * src/flows/onboarding.flow.ts
 *
 * Fluxo 1 — Primeiro contato e teste gratuito de 10 dias
 * Baseado no fluxograma macro do DinDin.
 */

import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { FinancialAgent } from '../agent/financial.agent.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';

type Step =
  | 'ASK_NAME'
  | 'ASK_BUDGET_OR_STATEMENT'
  | 'ASK_BUDGET_AMOUNT'
  | 'PROCESS_STATEMENT'
  | 'ASK_SAVINGS_GOAL'
  | 'CONFIRM_TRIAL';

export class OnboardingFlow {
  constructor(
    private gateway: WhatsAppGateway,
    private agent: FinancialAgent,
    private userService: UserService
  ) {}

  /** Inicia o onboarding para um usuário novo */
  async start(msg: InboundMessage, user: User): Promise<void> {
    await this.gateway.sendText(
      msg.jid,
      `Oi! Que bom te ver por aqui. 👋\n\nEu sou o *DinDin*, seu agente financeiro pessoal!\n\nVou te ajudar a entender para onde seu dinheiro está indo, quanto você ainda pode gastar com segurança e como economizar sem sofrimento para alcançarmos seu grande sonho! 🎯\n\nAqui você pode registrar seus gastos por mensagem, áudio ou enviando seu extrato.\n\nPara começar... como posso te chamar?`
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_NAME',
      data: {},
    });
  }

  /** Processa cada passo do onboarding */
  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    const step = (flowState?.step ?? 'ASK_NAME') as Step;
    const ctx = (flowState?.context as Record<string, unknown>) ?? {};

    switch (step) {
      case 'ASK_NAME':
        await this.handleAskName(msg, user, ctx);
        break;

      case 'ASK_BUDGET_OR_STATEMENT':
        await this.handleBudgetOrStatement(msg, user, ctx);
        break;

      case 'ASK_BUDGET_AMOUNT':
        await this.handleBudgetAmount(msg, user, ctx);
        break;

      case 'PROCESS_STATEMENT':
        await this.handleProcessStatement(msg, user, ctx);
        break;

      case 'ASK_SAVINGS_GOAL':
        await this.handleAskSavingsGoal(msg, user, ctx);
        break;

      case 'CONFIRM_TRIAL':
        await this.handleConfirmTrial(msg, user, ctx);
        break;
    }
  }

  // ─── Handlers de cada passo ───────────────────────────────────────────────

  private async handleAskName(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    const name = msg.text?.trim();
    if (!name || name.length < 2) {
      await this.gateway.sendText(msg.jid, 'Não consegui pegar seu nome. Como posso te chamar?');
      return;
    }

    await this.userService.updateName(user.id, name);

    await this.gateway.sendText(
      msg.jid,
      `Prazer, *${name}*! 🤝\n\nTem interesse em fazer um *teste gratuito de 10 dias*?\n\nNesse período vou te ajudar a entender seus gastos e mostrar quanto você pode economizar. Sem precisar de cartão de crédito.`
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'CONFIRM_TRIAL',
      data: { name },
    });
  }

  private async handleConfirmTrial(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    const text = msg.text?.toLowerCase() ?? '';
    const confirmed = text.includes('sim') || text.includes('quero') || text.includes('vamos');

    if (!confirmed) {
      await this.gateway.sendText(
        msg.jid,
        `Sem problema! Se mudar de ideia é só me chamar. Estarei por aqui! 😊`
      );
      await this.userService.setFlowState(user.id, { currentFlow: 'FREE', step: 'IDLE', data: {} });
      return;
    }

    // Cria trial de 10 dias
    await this.userService.createTrialSubscription(user.id);

    await this.gateway.sendText(
      msg.jid,
      `Arrasou! 🎉 Seu teste começa agora!\n\nPosso iniciar a explicação de como funciona nossa parceria?\n\nResponda *sim* para continuar.`
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_BUDGET_OR_STATEMENT',
      data: ctx,
    });
  }

  private async handleBudgetOrStatement(
    msg: InboundMessage,
    user: User,
    ctx: Record<string, unknown>
  ) {
    const text = msg.text?.toLowerCase() ?? '';

    if (text.includes('sim') || text.includes('quero') || text.includes('claro')) {
      await this.gateway.sendText(
        msg.jid,
        `Perfeito! Para eu te ajudar melhor, me conta:\n\n*1.* Quanto você tem para gastar esse mês?\n*2.* Prefere me enviar seu extrato bancário?\n\nResponda *1* ou *2* 👇`
      );
      await this.userService.setFlowState(user.id, {
        currentFlow: 'ONBOARDING',
        step: 'ASK_BUDGET_OR_STATEMENT',
        data: { ...ctx, waitingChoice: true },
      });
      return;
    }

    if (msg.text === '1' || text.includes('quanto')) {
      await this.gateway.sendText(msg.jid, `Me conta! Quanto você tem para gastar ainda esse mês? 💰`);
      await this.userService.setFlowState(user.id, {
        currentFlow: 'ONBOARDING',
        step: 'ASK_BUDGET_AMOUNT',
        data: ctx,
      });
    } else if (msg.text === '2' || text.includes('extrato') || msg.type === 'pdf') {
      await this.gateway.sendText(
        msg.jid,
        `Ótimo! Me envia uma *foto do extrato* ou um *PDF*. Vou analisar tudo pra você! 📄`
      );
      await this.userService.setFlowState(user.id, {
        currentFlow: 'ONBOARDING',
        step: 'PROCESS_STATEMENT',
        data: ctx,
      });
      // Se já veio PDF junto, processa imediatamente
      if (msg.type === 'pdf') {
        await this.handleProcessStatement(msg, user, ctx);
      }
    }
  }

  private async handleBudgetAmount(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    // Extrai número da mensagem (ex: "2500" ou "R$ 2.500,00")
    const amount = extractAmount(msg.text ?? '');

    if (!amount || amount <= 0) {
      await this.gateway.sendText(
        msg.jid,
        `Hmm, não consegui entender o valor. Pode me dizer quanto você tem para gastar? Ex: *2500*`
      );
      return;
    }

    await this.userService.updateBudget(user.id, amount);

    await this.gateway.sendText(
      msg.jid,
      `Anotado! Você tem *R$ ${amount.toFixed(2)}* para gastar esse mês. 💪\n\nVocê deseja economizar alguma quantia esse mês?`
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_SAVINGS_GOAL',
      data: { ...ctx, budget: amount },
    });
  }

  private async handleProcessStatement(
    msg: InboundMessage,
    user: User,
    ctx: Record<string, unknown>
  ) {
    if (msg.type !== 'pdf' && msg.type !== 'image') {
      await this.gateway.sendText(msg.jid, 'Aguardando seu extrato... Me envia o PDF ou foto! 📄');
      return;
    }

    await this.gateway.sendText(msg.jid, '⏳ Analisando seu extrato... um instante!');

    // O processamento real é feito pelo StatementService via fila
    const { StatementQueue } = await import('../infra/queue/statement.queue.js');
    await StatementQueue.add('process-statement', {
      userId: user.id,
      jid: msg.jid,
      messageId: msg.id,
    });

    await this.userService.setFlowState(user.id, {
      currentFlow: 'ONBOARDING',
      step: 'ASK_SAVINGS_GOAL',
      data: ctx,
    });
  }

  private async handleAskSavingsGoal(msg: InboundMessage, user: User, ctx: Record<string, unknown>) {
    const text = msg.text?.toLowerCase() ?? '';
    const wantsSavings = text.includes('sim') || text.includes('quero') || text.includes('yes');
    const noSavings = text.includes('não') || text.includes('nao') || text.includes('no');

    if (wantsSavings) {
      await this.gateway.sendText(msg.jid, `Quanto você quer guardar esse mês? Me diz o valor! 🎯`);
      // Próxima mensagem salva a meta
      await this.userService.setFlowState(user.id, {
        currentFlow: 'DAILY_LOG',
        step: 'SAVE_GOAL',
        data: ctx,
      });
    } else if (noSavings) {
      await this.finishOnboarding(msg, user, ctx);
    } else {
      // Tenta extrair valor direto
      const amount = extractAmount(msg.text ?? '');
      if (amount) {
        await this.userService.createGoal(user.id, amount);
        await this.finishOnboarding(msg, user, ctx);
      } else {
        await this.gateway.sendText(
          msg.jid,
          `Deseja economizar alguma quantia esse mês?\n\nResponda *sim* ou *não* 👇`
        );
      }
    }
  }

  private async finishOnboarding(
    msg: InboundMessage,
    user: User,
    ctx: Record<string, unknown>
  ) {
    const name = user.displayName ?? 'você';

    await this.gateway.sendText(
      msg.jid,
      `Tudo pronto, *${name}*! 🚀\n\nAgora é só me chamar sempre que gastar algo. É bem simples:\n\n✉️ *"30 almoço"*\n✉️ *"50 bolsa nova"*\n✉️ *"75,99 cinema"*\n\nDepois disso eu já te conto quanto ainda pode gastar e como está indo na sua meta. Vamos nessa? 💚`
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'DAILY_LOG',
      step: 'IDLE',
      data: {},
    });
  }
}

// ─── Utilitário ───────────────────────────────────────────────────────────────

function extractAmount(text: string): number | null {
  const cleaned = text
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const match = cleaned.match(/(\d+(\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : null;
}
