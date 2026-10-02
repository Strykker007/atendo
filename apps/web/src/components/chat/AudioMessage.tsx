'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Áudio com onda sonora, como no WhatsApp.
 *
 * A onda é **real**: o arquivo é decodificado no navegador e cada barra é o pico daquele
 * trecho. Desenhar barras aleatórias seria mais barato e pareceria igual, mas mentiria sobre
 * o conteúdo — num áudio com silêncio no meio a pessoa veria movimento onde não há som.
 *
 * A decodificação só acontece no primeiro play: numa conversa com dezenas de áudios, decodificar
 * tudo ao abrir travaria a aba por segundos.
 */

const BARRAS = 42;

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/**
 * Picos por trecho (0..1) e a duração real.
 *
 * A duração vem daqui porque áudio gravado pelo navegador (webm/ogg do MediaRecorder) quase
 * nunca traz duração no cabeçalho: `audio.duration` fica NaN, o progresso nunca anda e o
 * tempo mostra 0:00. O buffer decodificado sabe exatamente quanto dura.
 */
async function extrairPicos(url: string, barras: number): Promise<{ picos: number[]; duracao: number }> {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  // OfflineAudioContext, não AudioContext: o segundo abre a saída de som do sistema e, criado
  // enquanto o <audio> acabou de começar, troca a sessão de áudio e silencia a reprodução —
  // era por isso que o primeiro play não saía e o segundo funcionava (aí os picos já existiam
  // e nenhum contexto era criado). O offline só processa, nunca toca nada.
  const ctx = new OfflineAudioContext(1, 1, 44_100);
  const audio = await ctx.decodeAudioData(buf);
  const dados = audio.getChannelData(0);
  const porBarra = Math.floor(dados.length / barras) || 1;
  const picos: number[] = [];
  for (let i = 0; i < barras; i++) {
    let max = 0;
    for (let j = 0; j < porBarra; j++) max = Math.max(max, Math.abs(dados[i * porBarra + j] ?? 0));
    picos.push(max);
  }
  const maior = Math.max(...picos, 0.01);
  return { picos: picos.map((p) => p / maior), duracao: audio.duration };
}

export function AudioMessage({ src, mine }: { src: string; mine?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [picos, setPicos] = useState<number[] | null>(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const decodificando = useRef(false);

  // decodifica uma vez, no primeiro play
  useEffect(() => {
    if (!tocando || picos || decodificando.current) return;
    decodificando.current = true;
    extrairPicos(src, BARRAS)
      .then(({ picos: p, duracao: d }) => {
        setPicos(p);
        // só assume se o elemento não souber: um arquivo com duração no cabeçalho é mais confiável
        setDuracao((atual) => (Number.isFinite(atual) && atual > 0 ? atual : d));
      })
      // sem a onda o áudio continua tocando: formato que o navegador não decodifica, link
      // expirado, ou arquivo grande demais não podem quebrar a mensagem
      .catch(() => setPicos([]));
  }, [tocando, picos, src]);

  const progresso = duracao > 0 ? atual / duracao : 0;
  const barras = picos?.length ? picos : Array(BARRAS).fill(0.35);

  async function alternar() {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) return a.pause();
    try {
      await a.play();
    } catch {
      // a primeira tentativa pode falhar com a mídia ainda não carregada; recarregar a fonte
      // e tentar de novo é melhor do que o botão ficar mudo e o usuário achar que quebrou
      a.load();
      await a.play().catch(() => undefined);
    }
  }

  /** Clicar na onda pula para aquele ponto. */
  function buscar(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duracao || !Number.isFinite(a.duration)) return; // sem duração no elemento, pular daria NaN
    const { left, width } = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(duracao, Math.max(0, ((e.clientX - left) / width) * duracao));
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px] max-w-[280px] mb-1">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setAtual(0); }}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuracao(e.currentTarget.duration)}
        className="hidden"
      />

      <button
        type="button"
        onClick={alternar}
        title={tocando ? 'Pausar' : 'Ouvir'}
        className={cn('w-8 h-8 rounded-full grid place-items-center shrink-0', mine ? 'bg-white/20 text-white' : 'bg-accent-soft text-accent-ink')}
      >
        {tocando ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div onClick={buscar} className="flex items-center gap-[2px] h-7 cursor-pointer" role="presentation">
          {barras.map((p, i) => {
            const passou = i / barras.length <= progresso;
            return (
              <span
                key={i}
                className={cn(
                  'flex-1 rounded-full transition-colors',
                  mine ? (passou ? 'bg-white' : 'bg-white/35') : passou ? 'bg-accent' : 'bg-muted/30',
                )}
                style={{ height: `${Math.max(12, p * 100)}%` }}
              />
            );
          })}
        </div>
        <div className={cn('tnum font-mono text-[10px]', mine ? 'text-white/70' : 'text-faint')}>
          {mmss(tocando || atual > 0 ? atual : duracao)}
        </div>
      </div>
    </div>
  );
}
