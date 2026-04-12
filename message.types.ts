/**
 * src/types/message.types.ts
 */

import type { WAMessage } from '@whiskeysockets/baileys';

export type MessageType = 'text' | 'audio' | 'pdf' | 'document' | 'image' | 'unknown';

export interface InboundMessage {
  id: string;
  jid: string;
  phone: string;        // sanitizado: +5511999999999
  type: MessageType;
  text?: string;
  raw: WAMessage;
  timestamp: number;
}

// ─── Fluxos ──────────────────────────────────────────────────────────────────

export type FlowName =
  | 'ONBOARDING'         // Fluxo 1 — primeiro contato + trial 10 dias
  | 'DAILY_LOG'          // Fluxo 3 — registro diário de gastos
  | 'PLAN_RENEWAL'       // Fluxo 4 — renovação de plano
  | 'INTELLIGENT_PLAN'   // Fluxo 5 — plano pago inteligente
  | 'DOUBT'              // Fluxo 2 — mensagem avulsa de dúvida
  | 'NEGATIVE_SCENARIO'  // Fluxo 7 — cenário financeiro negativo
  | 'PREMIUM_PLAN'       // Fluxo 8 — plano premium
  | 'FREE';              // Estado base (sem fluxo ativo)

export interface FlowContext {
  flow: FlowName;
  step: string;
  data: Record<string, unknown>;
}

// ─── Agente ──────────────────────────────────────────────────────────────────

export type AgentIntent =
  | 'REGISTER_EXPENSE'
  | 'CHECK_BALANCE'
  | 'CHECK_GOAL'
  | 'SEND_REPORT'
  | 'UPLOAD_STATEMENT'
  | 'PLAN_UPGRADE'
  | 'CHANGE_NAME'
  | 'DOUBT'
  | 'GREETING'
  | 'UNKNOWN';

export interface AgentResponse {
  intent: AgentIntent;
  reply: string;
  extractedExpense?: {
    amount: number;
    description: string;
    category?: string;
  };
  suggestedFlowTransition?: FlowName;
}
