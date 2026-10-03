'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { chaveDe, gravarOnda, lerOnda, type Onda } from '@/lib/wave-cache';

/**
 * Áudio com onda sonora, como no WhatsApp.
 *
 * A onda é **real**: o arquivo é decodificado no navegador e cada barra é o pico daquele
 * trecho. Desenhar barras aleatórias seria mais barato e pareceria igual, mas mentiria sobre
 * o conteúdo — num áudio com silêncio no meio a pessoa veria movimento onde não há som.
 *
 * A onda aparece **antes** de tocar, como no WhatsApp: a decodificação começa junto com a
 * mensagem, não no play. Para não engasgar um histórico com dezenas de áudios, passa por uma
 * fila de duas por vez e o resultado fica em cache.
 *
 * Decodificar antes do play também evita o problema inverso: criar contexto de áudio com a
 * reprodução em andamento silenciava o primeiro play.
 */

const BARRAS = 42;

/**
 * Dois níveis de cache. O da memória evita recalcular entre renders; o do navegador
 * (`wave-cache`) evita recalcular entre aberturas da conversa e entre sessões — era o que
 * fazia a onda ser reconstruída do zero toda vez que se voltava para a mesma conversa.
 */
const cache = new Map<string, Onda>();

function doCache(src: string): Onda | null {
  const chave = chaveDe(src);
  const memoria = cache.get(chave);
  if (memoria) return memoria;
  const salvo = lerOnda(src);
  if (salvo) cache.set(chave, salvo);
  return salvo;
}

/**
 * Fila com duas decodificações por vez. Sem limite, abrir uma conversa com 30 áudios dispara
 * 30 downloads e 30 decodificações simultâneas, e a aba engasga justamente quando a pessoa
 * está lendo as mensagens.
 */
let rodando = 0;
const espera: (() => void)[] = [];
/** Decodificações em andamento, por arquivo. */
const emVoo = new Map<string, Promise<Onda>>();
async function comVaga<T>(fn: () => Promise<T>): Promise<T> {
  if (rodando >= 2) await new Promise<void>((r) => espera.push(r));
  rodando++;
  try {
    return await fn();
  } finally {
    rodando--;
    espera.shift()?.();
  }
}

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

/**
 * Uma decodificação por arquivo, compartilhada por quem precisar.
 *
 * Em desenvolvimento o React monta o componente duas vezes; com uma trava por instância, a
 * segunda montagem desistia e o resultado da primeira era descartado — a onda ficava lisa
 * para sempre. Compartilhando a promessa, as duas montagens recebem o mesmo resultado.
 */
function obterPicos(src: string) {
  const chave = chaveDe(src);
  const pronto = doCache(src);
  if (pronto) return Promise.resolve(pronto);

  let p = emVoo.get(chave);
  if (!p) {
    p = comVaga(() => extrairPicos(src, BARRAS)).then(
      (r) => { cache.set(chave, r); gravarOnda(src, r); emVoo.delete(chave); return r; },
      (e) => { emVoo.delete(chave); throw e; },
    );
    emVoo.set(chave, p);
  }
  return p;
}

export function AudioMessage({ src, mine }: { src: string; mine?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [picos, setPicos] = useState<number[] | null>(() => doCache(src)?.picos ?? null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(() => doCache(src)?.duracao ?? 0);

  // a onda já nasce pronta: decodifica junto com a mensagem, sem esperar o play.
  // Tentei disparar por IntersectionObserver para economizar, mas ele reporta "fora da tela"
  // para mensagens visíveis dentro da área rolável do chat — e a onda ficava lisa para sempre.
  useEffect(() => {
    if (picos) return;
    let vivo = true;

    void obterPicos(src)
      .then(({ picos: p, duracao: d }) => {
        if (!vivo) return;
        setPicos(p);
        // só assume se o elemento não souber: arquivo com duração no cabeçalho é mais confiável
        setDuracao((atual) => (Number.isFinite(atual) && atual > 0 ? atual : d));
      })
      // sem a onda o áudio continua tocando: formato que o navegador não decodifica, link
      // expirado ou arquivo grande demais não podem quebrar a mensagem
      .catch(() => vivo && setPicos([]));

    return () => { vivo = false; };
  }, [picos, src]);

  const progresso = duracao > 0 ? atual / duracao : 0;
  const barras = picos?.length ? picos : Array(BARRAS).fill(0.35);

  /**
   * Tocar só depois de ter dados.
   *
   * `preload="metadata"` baixa só o cabeçalho: no primeiro clique o elemento costuma estar em
   * `readyState` 1 (tem duração, não tem som). Chamar `play()` aí começa a reprodução sem
   * áudio audível, e a tentativa anterior — `load()` + `play()` de novo — piorava, porque
   * `load()` cancela a reprodução que tinha acabado de começar. Agora espera o `canplay`.
   *
   * O limite de 4s existe para o botão não ficar preso se o evento nunca vier (mídia que o
   * navegador não decodifica): nesse caso o erro aparece escrito, em vez de silêncio.
   */
  async function alternar() {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) return a.pause();
    setErro(null);
    if (a.readyState < 2) {
      setCarregando(true);
      await new Promise<void>((resolve) => {
        let feito = false;
        const pronto = () => { if (feito) return; feito = true; a.removeEventListener('canplay', pronto); resolve(); };
        a.addEventListener('canplay', pronto);
        if (a.readyState === 0) a.load();
        setTimeout(pronto, 4000);
      });
      setCarregando(false);
    }
    try {
      await a.play();
    } catch (e) {
      setErro('Não foi possível tocar este áudio.');
      // eslint-disable-next-line no-console
      console.warn('[áudio] falha ao tocar', e);
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
        onError={() => setErro('Áudio indisponível — tente baixar.')}
        className="hidden"
      />

      <button
        type="button"
        onClick={alternar}
        title={tocando ? 'Pausar' : 'Ouvir'}
        className={cn('w-8 h-8 rounded-full grid place-items-center shrink-0', mine ? 'bg-white/20 text-white' : 'bg-accent-soft text-accent-ink')}
      >
        {carregando ? <Loader2 size={14} className="animate-spin" /> : tocando ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
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
      {erro && <span className="text-[10.5px] text-danger shrink-0">{erro}</span>}
    </div>
  );
}
