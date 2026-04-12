// tests/unit/doubt-flow.test.ts
import { describe, it, expect } from 'vitest';
import { DoubtFlow } from '../../src/flows/doubt.flow.js';

describe('DoubtFlow.isDoubtTrigger', () => {
  it('detecta "dúvida"', () => {
    expect(DoubtFlow.isDoubtTrigger('dúvida')).toBe(true);
  });

  it('detecta "ajuda"', () => {
    expect(DoubtFlow.isDoubtTrigger('preciso de ajuda')).toBe(true);
  });

  it('detecta "menu"', () => {
    expect(DoubtFlow.isDoubtTrigger('menu')).toBe(true);
  });

  it('não detecta mensagem de gasto', () => {
    expect(DoubtFlow.isDoubtTrigger('50 almoço')).toBe(false);
  });

  it('não detecta saudação', () => {
    expect(DoubtFlow.isDoubtTrigger('oi tudo bem')).toBe(false);
  });
});
