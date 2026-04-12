/**
 * src/middleware/sanitizer.ts
 *
 * Sanitiza input do usuário antes de qualquer processamento.
 * - Remove caracteres de controle
 * - Trunca mensagens absurdamente longas
 * - Bloqueia tentativas de prompt injection óbvias
 */

const MAX_TEXT_LENGTH = 2000;

// Padrões que indicam tentativa de prompt injection
const INJECTION_PATTERNS = [
  /ignore (previous|all) instructions/i,
  /system prompt/i,
  /você agora é/i,
  /forget everything/i,
  /<\s*script/i,
];

export function sanitizeText(input: string): { safe: boolean; text: string } {
  // Remove caracteres de controle (exceto newline e tab)
  let text = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trunca
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.substring(0, MAX_TEXT_LENGTH);
  }

  // Verifica injection
  const isInjection = INJECTION_PATTERNS.some((p) => p.test(text));
  if (isInjection) {
    return { safe: false, text: '' };
  }

  return { safe: true, text: text.trim() };
}

/** Valida se um número de telefone está no formato esperado */
export function isValidPhone(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}
