/**
 * src/middleware/sanitizer.ts
 *
 * Sanitização de input do usuário.
 * - Remove caracteres de controle
 * - Bloqueia tentativas de prompt injection
 * - Valida formato de número de telefone
 */

// Padrões que indicam tentativa de prompt injection ou bypass
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a\s+)?/i,
  /act\s+as\s+(if\s+)?/i,
  /forget\s+(all\s+)?your\s+(previous\s+)?(instructions|training)/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /\<\|im_start\|\>/i,
  /\<\|system\|\>/i,
  /DAN\s+mode/i,
  /jailbreak/i,
];

// Máximo de caracteres por mensagem (evita DoS na chamada à API)
const MAX_MESSAGE_LENGTH = 2000;

export interface SanitizeResult {
  safe: boolean;
  text: string;
  reason?: string;
}

/**
 * Sanitiza o texto de entrada do usuário.
 * Retorna { safe: false } se detectar conteúdo malicioso.
 */
export function sanitizeText(raw: string): SanitizeResult {
  // 1. Trunca se muito longo
  let text = raw.substring(0, MAX_MESSAGE_LENGTH);

  // 2. Remove caracteres de controle (exceto \n e \t)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Normaliza espaços extras
  text = text.replace(/\s{3,}/g, '  ').trim();

  // 4. Verifica padrões de prompt injection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, text, reason: 'prompt_injection' };
    }
  }

  return { safe: true, text };
}

/**
 * Valida se o número de telefone tem formato esperado.
 * Aceita apenas números internacionais: +55XXXXXXXXXX
 */
export function isValidPhone(phone: string): boolean {
  // Formato: + seguido de 7-15 dígitos
  return /^\+\d{7,15}$/.test(phone);
}
