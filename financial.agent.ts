/**
 * src/agent/financial.agent.ts
 *
 * Agente de IA principal do DinDin.
 * Usa Claude para:
 *  1. Classificar intenção do usuário
 *  2. Extrair dados de gastos de texto livre / áudio transcrito
 *  3. Gerar respostas empáticas e personalizadas
 *  4. Sugerir estratégias financeiras
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { AgentIntent, AgentResponse } from '../types/message.types.js';
import type { Conversation } from '@prisma/client';

const client = new Anthropic(); // usa ANTHROPIC_API_KEY do ambiente

const SYSTEM_PROMPT = `Você é o DinDin, um agente financeiro pessoal amigável e empático que opera via WhatsApp.
Seu tom é próximo, encorajador e sem julgamentos. Use linguagem informal e brasileira.
Você ajuda o usuário a:
- Registrar gastos (extrai valor e descrição de mensagens livres)
- Entender para onde o dinheiro foi
- Economizar sem sofrimento
- Alcançar sonhos financeiros

REGRAS IMPORTANTES:
1. Nunca invente dados financeiros — baseie-se apenas no contexto fornecido.
2. Se o usuário enviar algo fora do escopo financeiro, redirecione gentilmente.
3. Respostas devem ser curtas (máximo 3 parágrafos) — é WhatsApp, não e-mail.
4. Ao extrair gastos, sempre confirme com o usuário antes de salvar.
5. Nunca mencione que você é um modelo de linguagem da Anthropic ou Claude.

FORMATO DE RESPOSTA (JSON):
Sempre responda APENAS com JSON válido no seguinte formato:
{
  "intent": "<REGISTER_EXPENSE|CHECK_BALANCE|CHECK_GOAL|SEND_REPORT|UPLOAD_STATEMENT|PLAN_UPGRADE|CHANGE_NAME|DOUBT|GREETING|UNKNOWN>",
  "reply": "<mensagem para o usuário>",
  "extractedExpense": {
    "amount": <número ou null>,
    "description": "<texto ou null>",
    "category": "<FOOD|TRANSPORT|SHOPPING|HEALTH|ENTERTAINMENT|EDUCATION|HOUSING|IMPULSE|OTHER ou null>"
  } 
}
O campo extractedExpense deve existir apenas se intent for REGISTER_EXPENSE.`;

export class FinancialAgent {
  private model: string;

  constructor() {
    this.model = env.ANTHROPIC_MODEL;
  }

  /**
   * Processa uma mensagem do usuário com contexto financeiro completo.
   */
  async process(params: {
    userMessage: string;
    userName?: string;
    financialContext: FinancialContext;
    conversationHistory: Pick<Conversation, 'role' | 'content'>[];
  }): Promise<AgentResponse> {
    const { userMessage, userName, financialContext, conversationHistory } = params;

    const contextBlock = this.buildContextBlock(financialContext, userName);

    const messages: Anthropic.MessageParam[] = [
      // Injeta contexto financeiro como primeira mensagem do sistema
      { role: 'user', content: `[CONTEXTO FINANCEIRO ATUAL]\n${contextBlock}` },
      { role: 'assistant', content: 'Entendido. Estou pronto para ajudar com base nesse contexto.' },
      // Histórico recente (últimas 10 mensagens para não estourar contexto)
      ...conversationHistory.slice(-10).map((c) => ({
        role: c.role.toLowerCase() as 'user' | 'assistant',
        content: c.content,
      })),
      // Mensagem atual
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      });

      const rawText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('');

      return this.parseResponse(rawText);
    } catch (err) {
      logger.error({ err }, 'Erro na chamada ao agente de IA');
      return {
        intent: 'UNKNOWN',
        reply: 'Ops! Tive um problema aqui. Pode repetir o que você disse? 😅',
      };
    }
  }

  /**
   * Analisa um extrato financeiro (texto extraído de PDF) e retorna resumo estruturado.
   */
  async analyzeStatement(statementText: string): Promise<StatementAnalysis> {
    const prompt = `Analise o extrato bancário abaixo e retorne APENAS JSON válido com:
{
  "totalSpent": <número>,
  "categories": {
    "FOOD": <número>,
    "TRANSPORT": <número>,
    "SHOPPING": <número>,
    "HEALTH": <número>,
    "ENTERTAINMENT": <número>,
    "OTHER": <número>
  },
  "impulseCount": <número de gastos impulsivos detectados>,
  "savingsOpportunity": <estimativa de quanto poderia economizar>,
  "topMerchants": ["<nome>", ...],
  "observations": "<observação curta e empática>"
}

EXTRATO:
${statementText.substring(0, 8000)}`; // limita tamanho do extrato

    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const rawText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('');

      return JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch (err) {
      logger.error({ err }, 'Erro ao analisar extrato');
      throw new Error('Não consegui processar o extrato. Tente enviar novamente.');
    }
  }

  // ─── Helpers privados ────────────────────────────────────────────────────

  private buildContextBlock(ctx: FinancialContext, userName?: string): string {
    return [
      `Nome do usuário: ${userName ?? 'não informado'}`,
      `Orçamento mensal: R$ ${ctx.monthlyBudget ?? 'não definido'}`,
      `Gasto atual no mês: R$ ${ctx.currentMonthSpent.toFixed(2)}`,
      `Saldo disponível: R$ ${ctx.availableBalance?.toFixed(2) ?? 'não calculado'}`,
      `Meta de economia mensal: R$ ${ctx.savingsGoalMonthly ?? 'não definida'}`,
      `Dias restantes no mês: ${ctx.daysLeftInMonth}`,
      `Limite diário ideal: R$ ${ctx.idealDailyLimit?.toFixed(2) ?? 'não calculado'}`,
      `Nível de risco financeiro: ${ctx.riskLevel}`,
      `Plano ativo: ${ctx.planType}`,
    ].join('\n');
  }

  private parseResponse(raw: string): AgentResponse {
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      return {
        intent: (parsed.intent as AgentIntent) ?? 'UNKNOWN',
        reply: parsed.reply ?? 'Não entendi. Pode repetir?',
        extractedExpense: parsed.extractedExpense?.amount
          ? {
              amount: Number(parsed.extractedExpense.amount),
              description: String(parsed.extractedExpense.description ?? ''),
              category: parsed.extractedExpense.category,
            }
          : undefined,
      };
    } catch {
      // Se o modelo não retornar JSON, trata como resposta de texto livre
      return {
        intent: 'UNKNOWN',
        reply: raw.substring(0, 500),
      };
    }
  }
}

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

export interface FinancialContext {
  monthlyBudget?: number;
  currentMonthSpent: number;
  availableBalance?: number;
  savingsGoalMonthly?: number;
  daysLeftInMonth: number;
  idealDailyLimit?: number;
  riskLevel: string;
  planType: string;
}

export interface StatementAnalysis {
  totalSpent: number;
  categories: Record<string, number>;
  impulseCount: number;
  savingsOpportunity: number;
  topMerchants: string[];
  observations: string;
}
