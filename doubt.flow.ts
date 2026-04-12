/**
 * src/flows/doubt.flow.ts
 *
 * Fluxo 2 — Mensagem avulsa de dúvida.
 * Ativado quando usuário digita "dúvida", "ajuda", "menu" etc.
 */

import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import type { FinancialAgent } from '../agent/financial.agent.js';
import type { UserService } from '../services/user/user.service.js';
import type { InboundMessage } from '../types/message.types.js';
import type { User, FlowState } from '@prisma/client';
import { ReportService } from '../services/report/report.service.js';

const TRIGGER_KEYWORDS = ['dúvida', 'duvida', 'ajuda', 'help', 'menu', 'opções', 'opcoes', '?'];

export class DoubtFlow {
  private reportService: ReportService;

  constructor(
    private gateway: WhatsAppGateway,
    private agent: FinancialAgent,
    private userService: UserService
  ) {
    this.reportService = new ReportService();
  }

  /** Verifica se a mensagem é um trigger de dúvida */
  static isDoubtTrigger(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return TRIGGER_KEYWORDS.some((k) => lower.includes(k));
  }

  async handle(msg: InboundMessage, user: User, flowState: FlowState | null): Promise<void> {
    const step = flowState?.step ?? 'MENU';

    if (step === 'MENU' || DoubtFlow.isDoubtTrigger(msg.text ?? '')) {
      await this.sendMenu(msg, user);
      return;
    }

    // Processa escolha do menu
    await this.handleMenuChoice(msg, user, flowState);
  }

  private async sendMenu(msg: InboundMessage, user: User): Promise<void> {
    await this.gateway.sendText(
      msg.jid,
      [
        `Olá, ${user.displayName ?? 'você'}! Como posso te ajudar? 😊`,
        ``,
        `*1.* 📊 Relatório de gastos`,
        `*2.* 🎯 Andamento da meta de economia`,
        `*3.* 💳 Planejamento de parcelamento`,
        `*4.* 📋 Ver planos disponíveis`,
        `*5.* 🆘 Falar com a equipe`,
        `*6.* ✏️ Alterar meu nome no bot`,
        ``,
        `Responda com o número da opção!`,
      ].join('\n')
    );

    await this.userService.setFlowState(user.id, {
      currentFlow: 'DOUBT',
      step: 'AWAIT_CHOICE',
      data: {},
    });
  }

  private async handleMenuChoice(msg: InboundMessage, user: User, flowState: FlowState | null) {
    const choice = msg.text?.trim();

    switch (choice) {
      case '1':
        await this.sendReport(msg, user);
        break;

      case '2':
        await this.sendGoalProgress(msg, user);
        break;

      case '3':
        await this.gateway.sendText(
          msg.jid,
          `Me diz o valor total da compra que você quer parcelar e em quantas vezes! Ex: *"R$ 1200 em 12x"* 💳`
        );
        await this.userService.setFlowState(user.id, {
          currentFlow: 'DOUBT',
          step: 'INSTALLMENT_PLANNING',
          data: {},
        });
        break;

      case '4':
        await this.sendPlanOptions(msg);
        break;

      case '5':
        await this.gateway.sendText(
          msg.jid,
          `Vou acionar nossa equipe! Em breve alguém entrará em contato com você. 🙌\n\nSe preferir, pode descrever aqui o que está acontecendo que eu tento ajudar!`
        );
        await this.userService.setFlowState(user.id, { currentFlow: 'DAILY_LOG', step: 'IDLE', data: {} });
        break;

      case '6':
        await this.gateway.sendText(msg.jid, `Como você quer que eu te chame? 😊`);
        await this.userService.setFlowState(user.id, {
          currentFlow: 'DOUBT',
          step: 'CHANGE_NAME',
          data: {},
        });
        break;

      default:
        await this.gateway.sendText(
          msg.jid,
          `Não entendi 😅 Responde com o número da opção (1 a 6) ou me manda sua dúvida que tento responder!`
        );
    }
  }

  private async sendReport(msg: InboundMessage, user: User) {
    const report = await this.reportService.generateMonthlyReport(user.id);
    await this.gateway.sendText(msg.jid, report);
    await this.userService.setFlowState(user.id, { currentFlow: 'DAILY_LOG', step: 'IDLE', data: {} });
  }

  private async sendGoalProgress(msg: InboundMessage, user: User) {
    const progress = await this.reportService.getGoalProgress(user.id);
    await this.gateway.sendText(msg.jid, progress);
    await this.userService.setFlowState(user.id, { currentFlow: 'DAILY_LOG', step: 'IDLE', data: {} });
  }

  private async sendPlanOptions(msg: InboundMessage) {
    await this.gateway.sendText(
      msg.jid,
      [
        `📋 *Planos disponíveis:*`,
        ``,
        `🆓 *Trial 10 dias* — Gratuito`,
        `Experimente todas as funcionalidades sem compromisso`,
        ``,
        `💚 *Plano Inteligente — R$ 15/mês*`,
        `Acompanhamento completo, alertas e relatórios`,
        ``,
        `💎 *Plano Trimestral — R$ 40/trimestre*`,
        `Mesmos benefícios + economia de R$ 5`,
        ``,
        `Quer ativar algum? Me diz qual! 😊`,
      ].join('\n')
    );
    await this.userService.setFlowState(user.id, { currentFlow: 'DAILY_LOG', step: 'IDLE', data: {} });
  }
}
