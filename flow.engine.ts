/**
 * src/flows/flow.engine.ts
 *
 * Motor de fluxos — máquina de estados que orquestra os 8 fluxos do DinDin.
 * Cada fluxo é um módulo separado; o engine roteia baseado no estado persistido.
 */

import { checkRateLimit } from '../middleware/rate-limiter.js';
import { sanitizeText, isValidPhone } from '../middleware/sanitizer.js';
import { logger } from '../utils/logger.js';
import type { InboundMessage } from '../types/message.types.js';
import type { WhatsAppGateway } from '../gateway/whatsapp.gateway.js';
import { UserService } from '../services/user/user.service.js';
import { OnboardingFlow } from './onboarding.flow.js';
import { DailyLogFlow } from './daily-log.flow.js';
import { PlanRenewalFlow } from './plan-renewal.flow.js';
import { DoubtFlow } from './doubt.flow.js';
import { FinancialAgent } from '../agent/financial.agent.js';

export class FlowEngine {
  private onboarding: OnboardingFlow;
  private dailyLog: DailyLogFlow;
  private planRenewal: PlanRenewalFlow;
  private doubt: DoubtFlow;
  private agent: FinancialAgent;
  private userService: UserService;

  constructor(private gateway: WhatsAppGateway) {
    this.agent = new FinancialAgent();
    this.userService = new UserService();
    this.onboarding = new OnboardingFlow(gateway, this.agent, this.userService);
    this.dailyLog = new DailyLogFlow(gateway, this.agent, this.userService);
    this.planRenewal = new PlanRenewalFlow(gateway, this.userService);
    this.doubt = new DoubtFlow(gateway, this.agent, this.userService);
  }

  /**
   * Ponto de entrada para toda mensagem recebida.
   */
  async handle(msg: InboundMessage): Promise<void> {
    // ── Segurança: valida telefone ────────────────────────────────────────
    if (!isValidPhone(msg.phone)) {
      logger.warn({ phone: 'INVALID' }, 'Número inválido ignorado');
      return;
    }

    // ── Segurança: rate limiting ──────────────────────────────────────────
    const allowed = await checkRateLimit(msg.phone);
    if (!allowed) {
      await this.gateway.sendText(
        msg.jid,
        '⏳ Calma aí! Você está enviando mensagens muito rápido. Aguarde um instante.'
      );
      return;
    }

    // ── Segurança: sanitização do texto ───────────────────────────────────
    if (msg.text) {
      const { safe, text } = sanitizeText(msg.text);
      if (!safe) {
        logger.warn({ phone: msg.phone }, 'Tentativa de prompt injection bloqueada');
        await this.gateway.sendText(msg.jid, 'Não entendi sua mensagem. Pode tentar de outro jeito?');
        return;
      }
      msg.text = text;
    }

    // ── Marca como lida ───────────────────────────────────────────────────
    await this.gateway.markAsRead(msg.jid, msg.id);

    try {
      // ── Obtém ou cria usuário ─────────────────────────────────────────
      const user = await this.userService.findOrCreate(msg.phone);

      // ── Roteia para o fluxo correto ───────────────────────────────────
      const flowState = await this.userService.getFlowState(user.id);
      const currentFlow = flowState?.currentFlow ?? 'FREE';

      logger.debug({ phone: msg.phone, currentFlow, step: flowState?.step }, 'Roteando mensagem');

      switch (currentFlow) {
        case 'ONBOARDING':
          await this.onboarding.handle(msg, user, flowState);
          break;

        case 'DAILY_LOG':
        case 'FREE':
          // Usuário cadastrado sem fluxo ativo → modo livre com IA
          await this.dailyLog.handle(msg, user, flowState);
          break;

        case 'PLAN_RENEWAL':
          await this.planRenewal.handle(msg, user, flowState);
          break;

        case 'DOUBT':
          await this.doubt.handle(msg, user, flowState);
          break;

        default:
          // Novo usuário → inicia onboarding
          if (!user.displayName) {
            await this.onboarding.start(msg, user);
          } else {
            await this.dailyLog.handle(msg, user, flowState);
          }
      }
    } catch (err) {
      logger.error({ err, phone: msg.phone }, 'Erro no FlowEngine');
      await this.gateway.sendText(
        msg.jid,
        'Poxa, algo deu errado aqui do meu lado. Já vou verificar! Tenta de novo em instantes? 🙏'
      );
    }
  }
}
