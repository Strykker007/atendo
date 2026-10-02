'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * Melhor formato disponível para áudio de voz. O WhatsApp usa ogg/opus; o Chrome grava
 * webm/opus e o Safari mp4. Pedimos ogg primeiro e caímos no que o navegador aceitar —
 * a conversão final fica com o provider.
 */
function pickMime() {
  const candidatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidatos.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Quantas barrinhas a onda mostra. */
const BARRAS = 28;

/**
 * Grava áudio pelo navegador e devolve como arquivo.
 *
 * Fica no lugar do botão de enviar, como no WhatsApp: com o campo vazio aparece o microfone,
 * e assim que se digita algo o botão vira o de enviar. Quem decide isso é o chat — aqui só
 * avisamos quando a gravação começa e termina, para ele esconder o campo de texto.
 */
export function AudioRecorder({ onRecorded, disabled, onRecordingChange }: { onRecorded: (file: File) => void; disabled?: boolean; onRecordingChange?: (gravando: boolean) => void }) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [niveis, setNiveis] = useState<number[]>(() => Array(BARRAS).fill(0));

  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  /**
   * Descarte real. `stop()` ainda dispara um último `dataavailable` DEPOIS de limparmos os
   * pedaços — era por isso que "descartar" mandava o áudio assim mesmo. Quem decide é esta
   * marca, lida dentro do `onstop`.
   */
  const descartado = useRef(false);

  function soltarTudo() {
    timer.current && clearInterval(timer.current);
    raf.current && cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    audioCtx.current?.close().catch(() => undefined);
    timer.current = null;
    raf.current = null;
    stream.current = null;
    audioCtx.current = null;
  }

  // solta o microfone se o componente sair do ar no meio da gravação
  useEffect(() => () => soltarTudo(), []);

  /** Onda sonora a partir do microfone — reage à voz, não é animação decorativa. */
  function ouvirNivel(src: MediaStream) {
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(src).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let ultimo = 0;

    const tick = () => {
      raf.current = requestAnimationFrame(tick);
      const agora = performance.now();
      if (agora - ultimo < 60) return; // ~16 quadros/s já parece contínuo e poupa bateria
      ultimo = agora;

      analyser.getByteTimeDomainData(buf);
      // energia do trecho (RMS): silêncio fica perto de 0, voz sobe
      let soma = 0;
      for (const v of buf) soma += (v - 128) ** 2;
      const rms = Math.sqrt(soma / buf.length) / 128;
      const altura = Math.min(1, rms * 3.2);
      setNiveis((n) => [...n.slice(1), altura]);
    };
    tick();
  }

  async function começar() {
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      return toast.err(new Error('Seu navegador não permite gravar áudio. Use o botão de arquivo.'));
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast.err(new Error('Permissão de microfone negada. Libere nas configurações do navegador.'));
    }

    chunks.current = [];
    descartado.current = false;
    const r = new MediaRecorder(stream.current, { mimeType: mime });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const pedaços = chunks.current;
      chunks.current = [];
      soltarTudo();
      if (descartado.current) return; // o usuário jogou fora: nada é anexado
      const blob = new Blob(pedaços, { type: mime });
      // descarta clique acidental: menos de 1s não é mensagem
      if (blob.size < 1200) return;
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      onRecorded(new File([blob], `audio-${Date.now()}.${ext}`, { type: mime }));
    };

    rec.current = r;
    r.start();
    setGravando(true);
    onRecordingChange?.(true);
    setSegundos(0);
    setNiveis(Array(BARRAS).fill(0));
    ouvirNivel(stream.current);
    timer.current = setInterval(() => setSegundos((s) => {
      if (s >= 299) parar(); // teto de 5 min, para não gerar arquivo gigante sem querer
      return s + 1;
    }), 1000);
  }

  function parar(descartar = false) {
    descartado.current = descartar;
    timer.current && clearInterval(timer.current);
    timer.current = null;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    else soltarTudo();
    setGravando(false);
    onRecordingChange?.(false);
  }

  if (!gravando) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="w-9 h-9 rounded-full p-0 border-0 bg-transparent text-muted hover:text-ink"
        disabled={disabled}
        icon={<Mic size={18} />}
        onClick={começar}
        title="Gravar áudio"
      />
    );
  }

  return (
    <span className="flex flex-1 items-center gap-2 rounded-xl bg-danger-soft px-2.5 py-1.5">
      <button type="button" onClick={() => parar(true)} className="text-danger-ink/70 hover:text-danger-ink p-0.5" title="Descartar gravação">
        <Trash2 size={14} />
      </button>

      <span className="tnum font-mono text-[11px] text-danger-ink shrink-0">{mmss(segundos)}</span>

      {/* onda sonora: cada barra é um instante recente, a mais nova à direita */}
      <span className="flex flex-1 items-center justify-end gap-[2px] h-6 overflow-hidden" aria-hidden>
        {niveis.map((n, i) => (
          <span
            key={i}
            className="w-[2px] rounded-full bg-danger/70 transition-[height] duration-75"
            style={{ height: `${Math.max(10, n * 100)}%` }}
          />
        ))}
      </span>

      <button type="button" onClick={() => parar()} className="inline-flex items-center gap-1 rounded-md bg-danger text-white px-2 py-0.5 text-[11px] font-medium" title="Encerrar e anexar">
        <Send size={11} /> Pronto
      </button>
    </span>
  );
}
