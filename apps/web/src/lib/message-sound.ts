'use client';
/**
 * Som de mensagem nova. Gerado com Web Audio (dois tons curtos) em vez de um arquivo: não
 * depende de asset, não tem atraso de download e não vira 404 se o caminho mudar.
 *
 * O navegador só libera áudio depois de um gesto da pessoa na página (clique, tecla). Até lá
 * o `AudioContext` nasce suspenso; o primeiro gesto o retoma e daí em diante o som sai mesmo
 * com a aba em segundo plano.
 */
let ctx: AudioContext | null = null;
let lastAt = 0;
/** várias mensagens em sequência (contato mandando picado, várias conversas juntas) tocam uma vez */
const MIN_GAP_MS = 1500;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Chamar uma vez na montagem do app: destrava o áudio no primeiro gesto. */
export function unlockMessageSound() {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') c.resume().catch(() => undefined);
  };
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  return () => events.forEach((e) => window.removeEventListener(e, unlock));
}

/** Toca para testar (Configurações): o clique já é o gesto que libera o áudio, e não tem intervalo mínimo. */
export async function previewMessageSound() {
  const c = context();
  if (c && c.state === 'suspended') await c.resume().catch(() => undefined);
  lastAt = 0;
  playMessageSound();
}

export function playMessageSound() {
  const now = Date.now();
  if (now - lastAt < MIN_GAP_MS) return;
  const c = context();
  if (!c || c.state !== 'running') return;
  lastAt = now;
  const t0 = c.currentTime;
  // "plim" de dois tons, ~0,35 s
  [[880, 0], [1320, 0.12]].forEach(([freq, delay]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + delay;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.25);
  });
}
