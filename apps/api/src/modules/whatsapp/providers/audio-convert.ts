import { spawn } from 'node:child_process';
import type { MediaPayload } from './provider.interface';

/** Áudio que a Cloud API aceita (erro `#100 Param file must be a file with one of the following types`). */
const META_AUDIO = new Set(['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus']);

const baseMime = (mime: string) => mime.split(';')[0].trim().toLowerCase();

/**
 * Áudio para a API oficial (docs/meta-cadastro-incorporado.md#áudio). O Chrome grava `audio/webm`
 * (opus), que a Meta recusa; a Evolution converte sozinha, a Meta não. Fora da lista, vira ogg/opus
 * mono — o formato da nota de voz do WhatsApp. Formato aceito passa direto (só tira o `;codecs=`).
 */
export async function audioForMeta(media: MediaPayload): Promise<MediaPayload> {
  const mime = baseMime(media.mimeType);
  if (META_AUDIO.has(mime)) return { ...media, mimeType: mime };
  const data = await ffmpegToOggOpus(media.data);
  const name = (media.fileName ?? 'audio').replace(/\.[a-z0-9]+$/i, '');
  return { ...media, data, mimeType: 'audio/ogg', fileName: `${name}.ogg` };
}

function ffmpegToOggOpus(input: Buffer, timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // re-encode (não só copia o stream): garante mono/opus mesmo com gravação estranha; voz curta é rápido
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-map_metadata', '-1', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Conversão do áudio demorou demais.')); }, timeoutMs);
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'Conversão de áudio indisponível no servidor (ffmpeg não instalado).' : `ffmpeg: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`Não foi possível converter o áudio para a API oficial${err ? `: ${err.trim().slice(0, 200)}` : ''}.`));
    });
    // stdin fechado cedo (ffmpeg morreu) não pode derrubar o processo
    p.stdin.on('error', () => undefined);
    p.stdin.end(input);
  });
}
