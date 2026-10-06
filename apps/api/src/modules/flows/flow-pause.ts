/**
 * O que fazer ao continuar um fluxo pausado (docs/fluxos.md → Pausar o fluxo).
 *
 * - estava rodando → volta a rodar e avança do nó em que parou;
 * - esperando resposta do contato (sem prazo) → volta a esperar; a próxima mensagem segue;
 * - esperando com prazo → volta a esperar e **reagenda** o job: o original pode ter vencido
 *   durante a pausa e sido ignorado. Aguardar/intervalo do Conteúdo = `resume`; tempo limite
 *   de resposta (Salvar/Menu) = `reply-timeout`. Prazo já vencido = agenda para agora.
 */
export type Retomada =
  | { status: 'running' }
  | { status: 'waiting'; job: null }
  | { status: 'waiting'; job: 'resume' | 'reply-timeout'; delayMs: number };

export function planejarRetomada(
  run: { pausedFrom: string | null; waitUntil: Date | null },
  porTempo: boolean,
  agora = Date.now(),
): Retomada {
  if (run.pausedFrom === 'running') return { status: 'running' };
  if (!run.waitUntil) return { status: 'waiting', job: null };
  return { status: 'waiting', job: porTempo ? 'resume' : 'reply-timeout', delayMs: Math.max(0, run.waitUntil.getTime() - agora) };
}
