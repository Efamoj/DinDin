/**
 * src/services/report/report.service.ts
 *
 * Gera relatórios financeiros para o usuário.
 */

import { prisma } from '../../infra/database/prisma.client.js';

export class ReportService {
  async generateMonthlyReport(userId: string): Promise<string> {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

    const [expenses, profile] = await Promise.all([
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, occurredAt: { gte: firstDay } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.financialProfile.findUnique({ where: { userId } }),
    ]);

    const total = expenses.reduce((acc, e) => acc + (e._sum.amount ?? 0), 0);
    const budget = profile?.monthlyBudget ?? 0;
    const remaining = budget - total;

    const categoryEmojis: Record<string, string> = {
      FOOD: '🍽️', TRANSPORT: '🚗', SHOPPING: '🛍️',
      HEALTH: '💊', ENTERTAINMENT: '🎬', EDUCATION: '📚',
      HOUSING: '🏠', IMPULSE: '⚡', OTHER: '📦',
    };

    const breakdown = expenses
      .sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))
      .map((e) => {
        const pct = total > 0 ? (((e._sum.amount ?? 0) / total) * 100).toFixed(0) : '0';
        const emoji = categoryEmojis[e.category] ?? '📦';
        return `${emoji} ${e.category}: R$ ${(e._sum.amount ?? 0).toFixed(2)} (${pct}%)`;
      })
      .join('\n');

    const lines = [
      `📊 *Relatório — ${now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}*`,
      ``,
      `💸 Total gasto: *R$ ${total.toFixed(2)}*`,
      budget > 0 ? `💰 Orçamento: R$ ${budget.toFixed(2)}` : null,
      budget > 0 ? `${remaining >= 0 ? '✅' : '⚠️'} Saldo: *R$ ${remaining.toFixed(2)}*` : null,
      ``,
      `*Por categoria:*`,
      breakdown || 'Nenhum gasto registrado ainda.',
    ]
      .filter(Boolean)
      .join('\n');

    return lines;
  }

  async getGoalProgress(userId: string): Promise<string> {
    const goals = await prisma.goal.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    if (!goals.length) {
      return `Você ainda não tem metas ativas. Quer criar uma? Me diz quanto quer economizar! 🎯`;
    }

    const lines = goals.map((g) => {
      const pct = g.targetAmount > 0 ? ((g.savedAmount / g.targetAmount) * 100).toFixed(0) : '0';
      const bar = progressBar(parseFloat(pct));
      return `🎯 *${g.title}*\n${bar} ${pct}%\nR$ ${g.savedAmount.toFixed(2)} / R$ ${g.targetAmount.toFixed(2)}`;
    });

    return [`📈 *Suas metas:*`, ``, ...lines].join('\n\n');
  }
}

function progressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
