import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** O que acompanha um log do começo ao fim de uma requisição ou de um job. */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  /** quando o dono do sistema está "entrando como" um cliente */
  impersonatorId?: string;
  /** job da fila, quando o trabalho não veio de uma requisição HTTP */
  job?: { queue: string; name: string; id?: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

export const currentContext = () => storage.getStore();

/** Roda `fn` com um contexto próprio; tudo que for logado dentro herda os campos. */
export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return storage.run({ requestId: ctx.requestId ?? randomUUID(), ...ctx }, fn);
}

/** Completa o contexto atual (ex.: tenant/usuário só conhecidos depois do guard de auth). */
export function enrichContext(patch: Partial<RequestContext>) {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, patch);
}

export const newRequestId = () => randomUUID();
