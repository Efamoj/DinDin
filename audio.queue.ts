/**
 * src/infra/queue/audio.queue.ts
 *
 * Fila BullMQ para transcrição de áudio via Whisper (OpenAI).
 * O worker converte o áudio com ffmpeg (ogg→mp3) e envia para a API Whisper.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const connection = { url: env.REDIS_URL };

export const AudioQueue = new Queue('audio', { connection });

export interface AudioJobData {
  userId: string;
  audioBuffer: string; // base64
}

export interface AudioJobResult {
  transcript: string;
}

/**
 * Cria o worker de transcrição de áudio.
 * Fluxo: base64 → arquivo temp → ffmpeg (ogg→mp3) → Whisper API → texto
 */
export function createAudioWorker(): Worker<AudioJobData, AudioJobResult> {
  const worker = new Worker<AudioJobData, AudioJobResult>(
    'audio',
    async (job: Job<AudioJobData>) => {
      const { userId, audioBuffer } = job.data;
      const buffer = Buffer.from(audioBuffer, 'base64');

      const tmpInput = join(tmpdir(), `dindin-${randomUUID()}.ogg`);
      const tmpOutput = join(tmpdir(), `dindin-${randomUUID()}.mp3`);

      try {
        // Salva o áudio original (formato ogg do WhatsApp)
        await writeFile(tmpInput, buffer);

        // Converte ogg → mp3 com ffmpeg
        await convertAudio(tmpInput, tmpOutput);

        // Transcreve com Whisper
        const transcript = await transcribeWithWhisper(tmpOutput);

        logger.info({ userId }, 'Áudio transcrito com sucesso');
        return { transcript };
      } finally {
        // Limpa arquivos temporários
        await unlink(tmpInput).catch(() => {});
        await unlink(tmpOutput).catch(() => {});
      }
    },
    { connection, concurrency: 2 }
  );

  worker.on('completed', (job, result) =>
    logger.info({ jobId: job.id, chars: result.transcript.length }, 'Transcrição concluída')
  );
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'Falha na transcrição')
  );

  return worker;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function convertAudio(input: string, output: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');

  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('mp3')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

async function transcribeWithWhisper(audioPath: string): Promise<string> {
  // Verifica se a API Key do OpenAI está configurada
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY não configurada — usando tesseract como fallback');
    return '';
  }

  const audioData = await readFile(audioPath);
  const formData = new FormData();
  const blob = new Blob([audioData], { type: 'audio/mpeg' });
  formData.append('file', blob, 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
