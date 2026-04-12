# DinDin 💚 — Agente Financeiro Pessoal via WhatsApp

> Chatbot financeiro inteligente que lê extratos, ouve mensagens de voz e orienta o usuário a gastar melhor — sem sofrimento.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| WhatsApp | @whiskeysockets/baileys |
| IA | Anthropic Claude (Sonnet) |
| Banco | PostgreSQL via Prisma ORM |
| Cache / Filas | Redis + BullMQ |
| PDF | pdf-parse + tesseract.js (OCR) |
| Áudio | fluent-ffmpeg + Whisper |
| Testes | Vitest |

---

## Arquitetura de pastas

```
src/
├── config/
│   └── env.ts               # Validação de env com Zod — falha em startup se algo faltar
├── gateway/
│   └── whatsapp.gateway.ts  # Conexão Baileys, normalização de mensagens
├── middleware/
│   ├── rate-limiter.ts      # Sliding window por número (Redis)
│   └── sanitizer.ts         # Sanitização de input + bloqueio de prompt injection
├── flows/
│   ├── flow.engine.ts       # Roteador principal — máquina de estados
│   ├── onboarding.flow.ts   # Fluxo 1 — primeiro contato + trial 10 dias
│   ├── daily-log.flow.ts    # Fluxo 3 — registro diário (modo livre com IA)
│   ├── plan-renewal.flow.ts # Fluxo 4 — conversão pós-trial
│   └── doubt.flow.ts        # Fluxo 2 — menu de dúvidas avulsas
├── agent/
│   └── financial.agent.ts   # Integração Claude: NLU, extração de gastos, respostas
├── services/
│   ├── user/
│   │   └── user.service.ts  # CRUD de usuário, assinatura, estado de fluxo
│   ├── finance/
│   │   └── statement.service.ts  # Parsing de extrato PDF + OCR + análise IA
│   ├── report/
│   │   └── report.service.ts     # Relatórios mensais, progresso de metas
│   └── billing/
│       └── scheduler.service.ts  # Jobs agendados: trial, nudges, reset mensal
├── infra/
│   ├── database/
│   │   └── prisma.client.ts # Singleton Prisma
│   ├── cache/
│   │   └── redis.client.ts  # Singleton Redis (ioredis)
│   └── queue/
│       ├── statement.queue.ts  # Fila BullMQ para PDFs
│       └── audio.queue.ts      # Fila BullMQ para transcrição de áudio
├── types/
│   └── message.types.ts     # Tipos compartilhados (InboundMessage, FlowName, etc.)
├── utils/
│   └── logger.ts            # Pino com redact de PII (LGPD)
└── index.ts                 # Bootstrap da aplicação
```

---

## Setup local

### 1. Pré-requisitos

- Node.js 20+
- Docker (para PostgreSQL e Redis)

### 2. Clone e instale

```bash
git clone https://github.com/seu-org/dindin.git
cd dindin
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com suas credenciais
```

### 4. Suba a infraestrutura local

```bash
docker-compose up -d
```

### 5. Rode as migrations

```bash
npm run db:generate
npm run db:migrate
```

### 6. Inicie em modo dev

```bash
npm run dev
```

Na primeira execução, um QR Code aparece no terminal. Escaneie com o WhatsApp que será o número do bot.

---

## Segurança

| Prática | Implementação |
|---|---|
| Sem segredos no código | Zod valida 100% das envs no startup |
| Rate limiting | Redis sliding window por número de telefone |
| Sanitização de input | Remoção de control chars + bloqueio de prompt injection |
| Validação de schema | Zod em toda entrada/saída de serviços |
| Logs sem PII | Pino redact: phone, text, rawInput mascarados |
| SQL Injection | Prevenido pelo Prisma por design |
| Sessões WA | Armazenadas criptografadas com AES-256 |
| .gitignore | .env, sessions/, *.log nunca commitados |

---

## Fluxos implementados

| # | Fluxo | Arquivo |
|---|---|---|
| 1 | Primeiro contato + trial 10 dias | `onboarding.flow.ts` |
| 2 | Mensagem avulsa de dúvida | `doubt.flow.ts` |
| 3 | Registro diário de gastos | `daily-log.flow.ts` |
| 4 | Renovação de plano pós-trial | `plan-renewal.flow.ts` |
| 5/7/8 | Agendado via scheduler | `scheduler.service.ts` |

---

## Testes

```bash
npm test              # roda todos os testes
npm run test:coverage # com cobertura
```

---

## Roadmap

- [ ] Integração com webhook PIX (confirmação automática de pagamento)
- [ ] Transcrição de áudio via Whisper (worker completo)
- [ ] Dashboard web para visualização dos dados
- [ ] Suporte a múltiplas contas bancárias
- [ ] Exportação de relatório em PDF
