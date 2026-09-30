'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
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

/** Grava áudio pelo navegador e devolve como arquivo, pronto para enviar. */
export function AudioRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // solta o microfone se o componente sair do ar no meio da gravação
  useEffect(() => () => {
    timer.current && clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

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
    const r = new MediaRecorder(stream.current, { mimeType: mime });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      const blob = new Blob(chunks.current, { type: mime });
      // descarta clique acidental: menos de 1s não é mensagem
      if (blob.size < 1200) return;
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      onRecorded(new File([blob], `audio-${Date.now()}.${ext}`, { type: mime }));
    };
    rec.current = r;
    r.start();
    setGravando(true);
    setSegundos(0);
    timer.current = setInterval(() => setSegundos((s) => {
      if (s >= 299) parar(); // teto de 5 min, para não gerar arquivo gigante sem querer
      return s + 1;
    }), 1000);
  }

  function parar(descartar = false) {
    timer.current && clearInterval(timer.current);
    if (descartar) chunks.current = [];
    rec.current?.state !== 'inactive' && rec.current?.stop();
    setGravando(false);
  }

  if (!gravando) {
    return (
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] gap-1" disabled={disabled} icon={<Mic size={13} />} onClick={começar} title="Gravar áudio">
        Áudio
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1">
      <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
      <span className="tnum font-mono text-[11px] text-danger-ink">{mmss(segundos)}</span>
      <button type="button" onClick={() => parar(true)} className="text-danger-ink/70 hover:text-danger-ink p-0.5" title="Descartar"><Trash2 size={13} /></button>
      <button type="button" onClick={() => parar()} className="inline-flex items-center gap-1 rounded-md bg-danger text-white px-2 py-0.5 text-[11px] font-medium" title="Parar e anexar"><Square size={10} /> Parar</button>
    </span>
  );
}
