import { env } from '../../../config/env';
import { providerError } from './retry';

/**
 * Transcrição de áudio (docs/transcricao-de-audio.md): `/audio/transcriptions` no formato da
 * OpenAI — serve para a OpenAI e para o Groq. Fica fora do `AiProvider` porque cobra por minuto,
 * não por token, e tem chave própria (a IA de texto pode estar no Anthropic ou no Ollama).
 */

/** limite do arquivo na OpenAI e no Groq (plano gratuito do Groq: 25 MB também) */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export const transcribeOn = () => !!env.AI_TRANSCRIBE_API_KEY;

/** o fornecedor descobre o formato pela extensão do nome do arquivo */
const EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac' };
const extOf = (mime: string) => EXT[mime.split(';')[0].trim().toLowerCase()] ?? 'ogg';

/**
 * Áudio de voz do WhatsApp (opus) fica perto de 16 kbit/s = 2 KB por segundo. Só usado quando o
 * fornecedor não diz a duração — o custo é estimativa, não fatura.
 */
const BYTES_PER_SECOND = 2000;

export const transcribeCostUsd = (seconds: number) => (seconds / 60) * env.AI_TRANSCRIBE_PRICE_PER_MIN;

export async function transcribeAudio(audio: Buffer, mime: string, timeoutMs = 60_000): Promise<{ text: string; seconds: number; model: string }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime.split(';')[0] }), `audio.${extOf(mime)}`);
  form.append('model', env.AI_TRANSCRIBE_MODEL);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  const res = await fetch(`${env.AI_TRANSCRIBE_BASE_URL.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AI_TRANSCRIBE_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(providerError(json).message ?? `transcrição ${res.status}`);
  // OpenAI manda `usage.seconds` (modelos por duração); Groq e whisper-1 podem mandar `duration`
  const seconds = Number(json.usage?.seconds ?? json.duration ?? json.x_groq?.duration) || audio.length / BYTES_PER_SECOND;
  return { text: String(json.text ?? '').trim(), seconds, model: env.AI_TRANSCRIBE_MODEL };
}
