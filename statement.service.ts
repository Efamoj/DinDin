/**
 * src/services/finance/statement.service.ts
 *
 * Processa extratos bancários em PDF ou imagem.
 * Pipeline: download → parse PDF (texto) → OCR fallback → IA analisa → salva
 */

import pdfParse from 'pdf-parse';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../infra/database/prisma.client.js';
import { FinancialAgent } from '../../agent/financial.agent.js';
import type { WhatsAppGateway } from '../../gateway/whatsapp.gateway.js';

export class StatementService {
  private agent: FinancialAgent;

  constructor(private gateway: WhatsAppGateway) {
    this.agent = new FinancialAgent();
  }

  /**
   * Processa um PDF de extrato recebido via WhatsApp.
   * Retorna o resumo textual para ser enviado ao usuário.
   */
  async processPdfBuffer(userId: string, pdfBuffer: Buffer): Promise<string> {
    // ── 1. Verifica se já processamos esse exato extrato ─────────────────
    const hash = createHash('sha256').update(pdfBuffer).digest('hex');
    const profile = await prisma.financialProfile.findUnique({ where: { userId } });

    if (profile?.lastStatementHash === hash) {
      return 'Parece que você já me enviou esse extrato antes! Deseja enviar um diferente?';
    }

    // ── 2. Extrai texto do PDF ────────────────────────────────────────────
    let text = '';
    try {
      const parsed = await pdfParse(pdfBuffer);
      text = parsed.text;
    } catch (err) {
      logger.warn({ err, userId }, 'pdf-parse falhou, tentando OCR');
      text = await this.ocrFallback(pdfBuffer);
    }

    if (!text || text.trim().length < 50) {
      return 'Não consegui ler seu extrato 😕 Tente enviar uma versão diferente ou me diga os gastos manualmente.';
    }

    // ── 3. Analisa com IA ─────────────────────────────────────────────────
    const analysis = await this.agent.analyzeStatement(text);

    // ── 4. Persiste dados ──────────────────────────────────────────────────
    await prisma.$transaction([
      prisma.financialProfile.upsert({
        where: { userId },
        create: {
          userId,
          currentMonthSpent: analysis.totalSpent,
          lastStatementHash: hash,
        },
        update: {
          currentMonthSpent: analysis.totalSpent,
          lastStatementHash: hash,
        },
      }),
      // Salva gastos por categoria como expenses
      ...Object.entries(analysis.categories)
        .filter(([, v]) => v > 0)
        .map(([category, amount]) =>
          prisma.expense.create({
            data: {
              userId,
              amount,
              description: `Extrato — ${category}`,
              category: category as any,
              source: 'STATEMENT',
            },
          })
        ),
    ]);

    // ── 5. Formata resposta ────────────────────────────────────────────────
    return this.formatAnalysisMessage(analysis);
  }

  private formatAnalysisMessage(analysis: Awaited<ReturnType<FinancialAgent['analyzeStatement']>>): string {
    const categoryEmojis: Record<string, string> = {
      FOOD: '🍽️ Alimentação',
      TRANSPORT: '🚗 Transporte',
      SHOPPING: '🛍️ Compras',
      HEALTH: '💊 Saúde',
      ENTERTAINMENT: '🎬 Entretenimento',
      EDUCATION: '📚 Educação',
      OTHER: '📦 Outros',
    };

    const categoriesText = Object.entries(analysis.categories)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => {
        const pct = ((v / analysis.totalSpent) * 100).toFixed(0);
        return `${categoryEmojis[k] ?? k}: ${pct}%`;
      })
      .join('\n');

    return [
      `📊 *Fiz uma leitura do seu extrato!*`,
      ``,
      `Seu dinheiro este mês foi para:`,
      categoriesText,
      ``,
      `⚠️ Gastos impulsivos detectados: *${analysis.impulseCount} ocorrências*`,
      `💡 Oportunidade de economia: *R$ ${analysis.savingsOpportunity.toFixed(2)}*`,
      ``,
      `_${analysis.observations}_`,
    ].join('\n');
  }

  /** OCR usando tesseract.js para imagens/PDFs escaneados */
  private async ocrFallback(buffer: Buffer): Promise<string> {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('por'); // português
      const { data } = await worker.recognize(buffer);
      await worker.terminate();
      return data.text;
    } catch (err) {
      logger.error({ err }, 'OCR fallback também falhou');
      return '';
    }
  }
}
