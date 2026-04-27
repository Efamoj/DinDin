/**
 * src/services/user/user.service.ts
 *
 * CRUD de usuário, gerenciamento de estado de fluxo e assinatura.
 */
import { prisma } from '../../infra/database/prisma.client.js';
import { logger } from '../../utils/logger.js';
import type { User, FlowState } from '@prisma/client';

export interface FlowStateInput {
  currentFlow: string;
  step: string;
  data: Record<string, unknown>;
}

export class UserService {
  /**
   * Busca usuário pelo telefone ou cria um novo se não existir.
   */
  async findOrCreate(phone: string): Promise<User> {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) return existing;

    logger.info({ phone: '[REDACTED]' }, 'Novo usuário criado');
    return prisma.user.create({
      data: {
        phone,
        subscription: {
          create: {
            plan: 'TRIAL',
            status: 'TRIAL',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 dias
          },
        },
      },
    });
  }

  /**
   * Atualiza o nome de exibição do usuário.
   */
  async updateName(userId: string, displayName: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { displayName },
    });
  }

  /**
   * Retorna o estado atual do fluxo do usuário.
   */
  async getFlowState(userId: string): Promise<FlowState | null> {
    return prisma.flowState.findUnique({ where: { userId } });
  }

  /**
   * Atualiza (ou cria) o estado do fluxo do usuário.
   */
  async setFlowState(userId: string, state: FlowStateInput): Promise<FlowState> {
    return prisma.flowState.upsert({
      where: { userId },
      create: {
        userId,
        currentFlow: state.currentFlow,
        step: state.step,
        context: state.data,
      },
      update: {
        currentFlow: state.currentFlow,
        step: state.step,
        context: state.data,
      },
    });
  }

  /**
   * Verifica se o trial do usuário ainda está ativo.
   */
  async isTrialActive(userId: string): Promise<boolean> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) return false;
    if (sub.status !== 'TRIAL') return sub.status === 'ACTIVE';
    return sub.expiresAt > new Date();
  }

  /**
   * Verifica se o usuário tem assinatura ativa (paga ou trial).
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) return false;
    if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') return false;
    return sub.expiresAt > new Date();
  }

  /**
   * Retorna todos os usuários com trial ou assinatura expirando em X dias.
   */
  async getUsersExpiringIn(days: number): Promise<User[]> {
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const dayStart = new Date(target);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(target);
    dayEnd.setHours(23, 59, 59, 999);

    const subs = await prisma.subscription.findMany({
      where: {
        expiresAt: { gte: dayStart, lte: dayEnd },
        status: { in: ['TRIAL', 'ACTIVE'] },
      },
      include: { user: true },
    });

    return subs.map((s) => s.user);
  }

  /**
   * Expira assinaturas vencidas e retorna os usuários afetados.
   */
  async expireOverdueSubscriptions(): Promise<User[]> {
    const expired = await prisma.subscription.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: { in: ['TRIAL', 'ACTIVE'] },
      },
      include: { user: true },
    });

    if (expired.length > 0) {
      await prisma.subscription.updateMany({
        where: { id: { in: expired.map((s) => s.id) } },
        data: { status: 'EXPIRED' },
      });
    }

    return expired.map((s) => s.user);
  }
}
