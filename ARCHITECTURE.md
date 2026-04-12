# DinDin — Arquitetura do Projeto

## Stack Principal
- **Runtime:** Node.js 20+
- **WhatsApp:** @whiskeysockets/baileys
- **IA:** Anthropic Claude API (claude-sonnet)
- **Banco de dados:** PostgreSQL (via Prisma ORM)
- **Cache / Sessões:** Redis
- **PDF Parser:** pdf-parse + tesseract.js (OCR para extratos escaneados)
- **Áudio:** @ffmpeg-installer + whisper (transcrição de voz)
- **Filas:** BullMQ (processamento assíncrono)
- **Segurança:** helmet, rate-limiter-flexible, zod, bcryptjs
- **Logs:** winston + pino
- **Testes:** vitest

## Diagrama de Camadas

```
WhatsApp (Baileys)
       │
  [Gateway Layer]        ← recebe eventos raw do WA
       │
  [Middleware Layer]     ← rate-limit, sanitização, autenticação de sessão
       │
  [Flow Engine]          ← máquina de estados (fluxos 1-8 do fluxograma)
       │
  [AI Agent]             ← Claude: NLU, classificação, geração de resposta
       │
  [Domain Services]      ← Finance, User, Goal, Report, Billing
       │
  [Infra Layer]          ← Postgres, Redis, BullMQ, Storage
```

## Princípios de Segurança Aplicados
- Nenhuma credencial em código — apenas variáveis de ambiente via `.env` + `zod` schema validation
- Sessões Baileys criptografadas em disco (AES-256)
- Sanitização de todo input de usuário antes de atingir a IA ou o banco
- Rate limiting por número de telefone (Redis sliding window)
- Validação de schema com Zod em toda entrada/saída de serviços
- Logs sem PII (dados pessoais são mascarados)
- Prisma impede SQL Injection por design
- Segredos nunca logados
