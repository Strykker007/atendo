'use client';
/**
 * Sons do painel: "plim" de mensagem nova e o alarme de atendimento transferido para você.
 * Gerados no navegador (sem arquivo): não dependem de asset, não têm atraso de download e não
 * viram 404 se o caminho mudar.
 *
 * O navegador só libera áudio depois de um gesto da pessoa na página (clique, tecla). Até lá
 * o `AudioContext` nasce suspenso; o primeiro gesto o retoma e daí em diante o som sai mesmo
 * com a aba em segundo plano. Quando o Web Audio não está rodando (Safari "interrupted",
 * contexto que não retomou), cai num `<audio>` com o mesmo som em WAV — que também é o caminho
 * do "Testar som": tocado dentro do clique, sai sempre.
 */
type Kind = 'message' | 'alarm';

/** [frequência Hz, início s, duração s] de cada tom */
const TONES: Record<Kind, [number, number, number][]> = {
  // "plim" de dois tons, ~0,35 s
  message: [[880, 0, 0.22], [1320, 0.12, 0.22]],
  // alarme: três pares agudos, ~1,6 s — diferente do plim, para não passar despercebido
  alarm: [0, 0.55, 1.1].flatMap((t): [number, number, number][] => [[988, t, 0.18], [1480, t + 0.2, 0.25]]),
};
const VOLUME: Record<Kind, number> = { message: 0.25, alarm: 0.45 };

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
    // 'interrupted' (Safari) também precisa de resume
    if (c && c.state !== 'running') c.resume().catch(() => undefined);
  };
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  return () => events.forEach((e) => window.removeEventListener(e, unlock));
}

function playWebAudio(c: AudioContext, kind: Kind) {
  // um respiro antes do 1º tom: agendar exatamente em `currentTime` às vezes perde o ataque
  const t0 = c.currentTime + 0.02;
  for (const [freq, delay, dur] of TONES[kind]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + delay;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(VOLUME[kind], start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }
}

/** O mesmo som em WAV (PCM 16 bits mono), para o `<audio>`. Gerado uma vez por tipo. */
const wavUrls: Partial<Record<Kind, string>> = {};
function wavUrl(kind: Kind) {
  if (wavUrls[kind]) return wavUrls[kind]!;
  const rate = 22_050;
  const total = Math.max(...TONES[kind].map(([, s, d]) => s + d)) + 0.05;
  const n = Math.ceil(total * rate);
  const pcm = new Float32Array(n);
  for (const [freq, start, dur] of TONES[kind]) {
    const a = Math.floor(start * rate);
    const len = Math.floor(dur * rate);
    for (let i = 0; i < len && a + i < n; i++) {
      // ataque de 10 ms e decaimento exponencial, como no Web Audio
      const t = i / rate;
      const env = Math.min(1, t / 0.01) * Math.exp((-5 * t) / dur);
      pcm[a + i] += Math.sin(2 * Math.PI * freq * t) * env * VOLUME[kind];
    }
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  wavUrls[kind] = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return wavUrls[kind]!;
}

function playElement(kind: Kind) {
  try {
    const el = new Audio(wavUrl(kind));
    void el.play().catch(() => undefined);
  } catch {
    /* sem áudio no navegador */
  }
}

function play(kind: Kind) {
  const c = context();
  if (c && c.state === 'running') playWebAudio(c, kind);
  else playElement(kind);
}

/**
 * Toca para testar (Configurações). Antes, esperava o `resume()` do contexto e só tocava se ele
 * voltasse "running" — no Safari e com o contexto criado antes do clique ele não voltava, e o
 * botão ficava mudo. Agora o som sai pelo `<audio>` dentro do próprio clique (o gesto libera) e o
 * contexto é retomado junto, para as próximas mensagens.
 */
export function previewMessageSound(kind: Kind = 'message') {
  const c = context();
  if (c && c.state !== 'running') c.resume().catch(() => undefined);
  lastAt = 0;
  playElement(kind);
}

export function playMessageSound() {
  const now = Date.now();
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  play('message');
}

/** Alarme de atendimento transferido para você — sem intervalo mínimo com o plim. */
export function playTransferAlarm() {
  lastAt = Date.now();
  play('alarm');
}
