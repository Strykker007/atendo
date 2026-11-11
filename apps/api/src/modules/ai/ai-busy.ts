import { ServiceUnavailableException } from '@nestjs/common';

/**
 * A IA está no limite do fornecedor (plano grátis do Gemini: pedidos por minuto/dia por modelo).
 * Não é erro da chave: dá para tentar de novo depois de `retryAfterMs`. O bloco IA em modo Agente
 * reagenda a rodada em vez de entregar a conversa para humano (docs/15-ia.md#gemini-e-o-plano-grátis).
 */
export class AiBusyError extends ServiceUnavailableException {
  constructor(
    readonly retryAfterMs: number,
    /** acabou a cota do dia (volta à meia-noite do Pacífico) — não vale ficar reagendando */
    readonly daily: boolean,
  ) {
    super(
      daily
        ? 'O limite diário do plano grátis da IA acabou. Volta a funcionar depois da meia-noite (horário do Pacífico, ~4h/5h de Brasília).'
        : `A IA está no limite de pedidos por minuto do plano grátis. Tente de novo em ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
  }
}

/** Cota estourada lida do corpo de erro do Google: diária ou por minuto, e quanto esperar. */
export function parseGeminiQuota(json: unknown, now = new Date()): { daily: boolean; retryAfterMs: number } {
  const text = JSON.stringify(json ?? '');
  const daily = /PerDay|per day|daily/i.test(text);
  if (daily) return { daily: true, retryAfterMs: msUntilPacificMidnight(now) };
  // RetryInfo.retryDelay ("51s") ou a frase "Please retry in 51.2s"
  const m = text.match(/retryDelay\W+(\d+(?:\.\d+)?)s/i) ?? text.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  const secs = m ? Number(m[1]) : 60;
  return { daily: false, retryAfterMs: Math.min(10 * 60_000, Math.max(5_000, Math.ceil(secs * 1000))) };
}

/** A cota diária do Google renova à meia-noite de Los Angeles (com horário de verão). */
export function msUntilPacificMidnight(now = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value) % 24]),
  ) as Record<'hour' | 'minute' | 'second', number>;
  const passed = (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000;
  // +1 min de folga para não bater no limite no segundo da virada
  return 86_400_000 - passed + 60_000;
}

/** Ordem de tentativa: o modelo escolhido e depois os outros da lista (cada um tem cota própria no Google). */
export function modelChain(chosen: string, list: readonly string[]): string[] {
  return [chosen, ...list.filter((m) => m !== chosen)];
}
