/**
 * src/services/user/user.service.ts
 *
 * Todas as operações relacionadas ao usuário:
 * criação, atualização de perfil, estado de fluxo, assinatura.
 */

import { prisma } from '../../infra/database/prisma.client.js';
import { env } from '../../config/env.js';
import type { User, FlowState } from '@prisma/client';

interface FlowStateInput {
  currentFlow: string;
  step: string;
  data: Record<string, unknown>;
}

export class UserService {
  /** Busca usuário pelo telefone ou cria um novo */
  async findOrCreate(phone: string): Promise<User> {
    return prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });
  }

  async updateName(userId: string, name: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: name },
    });
  }

  async updateBudget(userId: string, amount: number): Promise<void> {
    await prisma.financialProfile.upsert({
      where: { userId },
      create: { userId, monthlyBudget: amount },
      update: { monthlyBudget: amount },
    });
  }

  async createGoal(userId: string, amount: number, title = 'Meta do mês'): Promise<void> {
    // Atualiza meta mensal no perfil
    await prisma.financialProfile.upsert({
      where: { userId },
      create: { userId, savingsGoalMonthly: amount },
      update: { savingsGoalMonthly: amount },
    });

    // Cria o registro de meta
    await prisma.goal.create({
      data: {
        userId,
        title,
        targetAmount: amount,
      },
    });
  }

  // ─── Estado de fluxo ──────────────────────────────────────────────────────

  async getFlowState(userId: string): Promise<FlowState | null> {
    return prisma.flowState.findUnique({ where: { userId } });
  }

  async setFlowState(userId: string, state: FlowStateInput): Promise<void> {
    await prisma.flowState.upsert({
      where: { userId },
      create: { userId, ...state },
      update: state,
    });
  }

  // ─── Assinaturas ──────────────────────────────────────────────────────────

  async createTrialSubscription(userId: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.FREE_TRIAL_DAYS);

    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan: 'TRIAL',
        status: 'TRIAL',
        expiresAt,
      },
      update: {
        plan: 'TRIAL',
        status: 'TRIAL',
        expiresAt,
        startedAt: new Date(),
      },
    });
  }

  async activatePaidPlan(
    userId: string,
    plan: 'INTELLIGENT' | 'QUARTERLY' | 'PREMIUM',
    pixTxId: string
  ): Promise<void> {
    const months = plan === 'QUARTERLY' ? 3 : 1;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, plan, status: 'ACTIVE', expiresAt, pixTxId },
      update: { plan, status: 'ACTIVE', expiresAt, pixTxId, startedAt: new Date() },
    });
  }

  async getActiveSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['TRIAL', 'ACTIVE'] },
        expiresAt: { gt: new Date() },
      },
    });
  }

  /** Retorna usuários com trial expirando hoje (para job de conversão) */
  async getUsersWithExpiringTrial(): Promise<User[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subs = await prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        expiresAt: { gte: today, lte: tomorrow },
      },
      include: { user: true },
    });

    return subs.map((s) => s.user);
  }

  /** Marca assinaturas expiradas como EXPIRED */
  async expireOldSubscriptions(): Promise<number> {
    const result = await prisma.subscription.updateMany({
      where: {
        status: { in: ['TRIAL', 'ACTIVE'] },
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }
}
