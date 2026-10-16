'use client';
import { useMemo, useState } from 'react';
import { Plus, X, Play, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { HTTP_MAX_MAPPINGS, WEBHOOK_DEFAULT_TIMEOUT_SEC, WEBHOOK_MAX_TIMEOUT_SEC, WEBHOOK_METHODS, suggestVarName, type HttpMapping, type HttpNode, type WebhookHeader } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useTestHttp, type HttpTestResult } from '@/lib/hooks';
import { TextWithVars, type FlowVar } from './TextWithVars';

const shortId = () => crypto.randomUUID().slice(0, 8);
const varName = (v: string) => v.replace(/[^\w]/g, '_').toLowerCase();
const KIND_LABEL: Record<HttpTestResult['paths'][number]['kind'], string> = { text: 'texto', number: 'número', boolean: 'sim/não', null: 'vazio', list: 'lista', object: 'objeto' };

/**
 * Painel do bloco "API externa" (docs/fluxos.md#api-externa): requisição, **Testar** (chamada de
 * verdade pelo servidor, com valores de exemplo) e os campos da resposta → variáveis. Os caminhos
 * vêm da resposta do teste: um clique em "+ usar" cria o mapeamento com um nome sugerido.
 */
export function HttpPanel({ data, set, vars }: { data: HttpNode['data']; set: (patch: Record<string, unknown>) => void; vars: FlowVar[] }) {
  const method = data.method ?? 'GET';
  const headers = data.headers ?? [];
  const mappings = data.mappings ?? [];
  const test = useTestHttp();
  const [sample, setSample] = useState<Record<string, string>>({});
  const [verCorpo, setVerCorpo] = useState(false);
  const res = test.data;

  const updH = (id: string, p: Partial<WebhookHeader>) => set({ headers: headers.map((h) => (h.id === id ? { ...h, ...p } : h)) });
  const updM = (id: string, p: Partial<HttpMapping>) => set({ mappings: mappings.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const usados = new Set(mappings.map((m) => m.path.trim()));
  function usar(path: string) {
    if (mappings.length >= HTTP_MAX_MAPPINGS) return;
    // nome sugerido sem repetir os que já existem no bloco
    const taken = new Set([...mappings.map((m) => m.varName), data.statusVar, data.responseVar].filter(Boolean));
    const base = suggestVarName(path);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
    set({ mappings: [...mappings, { id: shortId(), path, varName: name }] });
  }

  // variáveis do fluxo usadas na requisição: no teste ainda não existem, então pedem um exemplo
  const precisa = useMemo(() => {
    const texto = [data.url, data.body, ...headers.map((h) => h.value)].join(' ');
    const doFluxo = new Set(vars.filter((v) => v.source === 'question' || v.source === 'menu' || v.source === 'action').map((v) => v.key));
    const conhecidas = new Set(vars.map((v) => v.key));
    const nomes = [...texto.matchAll(/\{\{\s*([a-zA-Z_][\w]*)\s*(?:\|\|[^}]*)?\}\}/g)].map((m) => m[1]);
    return [...new Set(nomes)].filter((n) => doFluxo.has(n) || !conhecidas.has(n));
  }, [data.url, data.body, headers, vars]);

  const erroTeste = test.error instanceof ApiError ? test.error.message : test.error ? 'Não deu para testar agora.' : null;

  return (
    <div className="min-w-0 max-w-full space-y-3 break-all">
      <details open className="min-w-0 space-y-2"><summary className="cursor-pointer font-semibold">Requisição</summary>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
        <Field label="Método">
          <select className={`${inputCls} min-w-0 max-w-full`} value={method} onChange={(e) => set({ method: e.target.value })}>{WEBHOOK_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </Field>
        <Field label="URL"><TextWithVars value={data.url ?? ''} onChange={(v) => set({ url: v.trim() })} vars={vars} placeholder="https://api.exemplo.com/clientes/{{cpf}}" /></Field>
      </div>
      <Field label="Tempo limite (s)"><input type="number" min={1} max={WEBHOOK_MAX_TIMEOUT_SEC} className={`${inputCls} min-w-0 max-w-full`} value={data.timeoutSec ?? WEBHOOK_DEFAULT_TIMEOUT_SEC} onChange={(e) => set({ timeoutSec: Math.min(WEBHOOK_MAX_TIMEOUT_SEC, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
      </details>
      <details className="min-w-0 space-y-2"><summary className="cursor-pointer font-semibold">Headers</summary>
      <Field label="Headers" hint="Ex.: Authorization: Bearer …. Valores aceitam {{variáveis}}. Authorization, X-Api-Key e nomes com token/secret não vão na exportação.">
        <div className="space-y-1.5">
          {headers.map((h) => (
            <div key={h.id} className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] items-start gap-1.5">
              <input className={`${inputCls} min-w-0`} value={h.key} placeholder="Nome" onChange={(e) => updH(h.id, { key: e.target.value.replace(/[^\w!#$%&'*+.^`|~-]/g, '') })} />
              <TextWithVars multiline={false} value={h.value} vars={vars} placeholder="Valor" onChange={(v) => updH(h.id, { value: v })} />
              <button aria-label="Remover header" onClick={() => set({ headers: headers.filter((x) => x.id !== h.id) })} className="text-faint hover:text-danger p-1"><X size={14} /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ headers: [...headers, { id: shortId(), key: '', value: '' }] })}>Adicionar header</Button>
        </div>
      </Field>
      </details>
      {method !== 'GET' && method !== 'DELETE' && (
        <details className="min-w-0 space-y-2"><summary className="cursor-pointer font-semibold">Corpo</summary>
        <Field label="Corpo (opcional)" hint="Em JSON, as {{variáveis}} entram já escapadas.">
          <TextWithVars value={data.body ?? ''} onChange={(v) => set({ body: v || undefined })} vars={vars} placeholder={'{"cpf": "{{cpf}}", "nome": "{{contact.name}}"}'} />
        </Field></details>
      )}


      {/* ---- teste ---- */}
      <details className="min-w-0 rounded-lg border border-line p-3 space-y-2"><summary className="cursor-pointer font-semibold">Teste</summary>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Testar a chamada</div>
          <Button size="sm" icon={<Play size={12} />} loading={test.isPending} loadingText="Chamando…" disabled={!data.url} onClick={() => test.mutate({ data: data as Record<string, unknown>, vars: sample })}>Testar</Button>
        </div>
        {precisa.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted">Valores de exemplo para o teste (no fluxo vêm das variáveis):</p>
            {precisa.map((n) => (
              <div key={n} className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] items-start gap-1.5">
                <code className="text-[11px] font-mono text-ink min-w-0 truncate">{`{{${n}}}`}</code>
                <input className={`${inputCls} min-w-0 max-w-full`} value={sample[n] ?? ''} onChange={(e) => setSample((s) => ({ ...s, [n]: e.target.value }))} placeholder="exemplo" />
              </div>
            ))}
          </div>
        )}
        <p className="text-[10.5px] text-faint">A chamada é feita de verdade, pelo servidor, com um contato de teste. Não grava nada no fluxo.</p>
        {erroTeste && <p className="text-xs text-danger-ink">{erroTeste}</p>}
        {res && (
          <div className="space-y-2">
            <div className={cn('flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[12px]', res.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger-ink')}>
              {res.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
              <span>{res.ok ? `Respondeu ${res.status} — sairia por Sucesso` : `${res.error ?? 'Falhou'} — sairia por Erro`}{res.status && !res.isJson && res.body ? ' · resposta não é JSON' : ''}</span>
            </div>
            {res.paths.length > 0 && (
              <div>
                <div className="text-[11px] text-muted mb-1">Campos da resposta — clique em <b>usar</b> para guardar numa variável:</div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-line divide-y divide-line">
                  {res.paths.map((p) => (
                    <div key={p.path} className="flex items-center gap-2 px-2 py-1 text-[11.5px]">
                      <code className="font-mono text-ink truncate flex-1 min-w-0" title={p.path}>{p.path}</code>
                      <span className="text-faint truncate max-w-[40%]" title={p.preview}>{p.kind === 'list' ? p.preview : p.preview || <i>{KIND_LABEL[p.kind]}</i>}</span>
                      {usados.has(p.path)
                        ? <span className="text-[10.5px] text-ok shrink-0">em uso</span>
                        : <button type="button" className="text-[11px] font-medium text-accent hover:underline shrink-0 disabled:text-faint" disabled={mappings.length >= HTTP_MAX_MAPPINGS} onClick={() => usar(p.path)}>+ usar</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {res.body && (
              <div>
                <button type="button" className="flex items-center gap-1 text-[11px] text-muted hover:text-ink" onClick={() => setVerCorpo((v) => !v)}>{verCorpo ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Ver resposta</button>
                {verCorpo && <pre className="mt-1 min-w-0 max-w-full max-h-48 overflow-auto rounded-md bg-field p-2 text-[10.5px] font-mono text-ink whitespace-pre-wrap break-all">{res.body}</pre>}
              </div>
            )}
          </div>
        )}
      </details>

      {/* ---- mapeamentos ---- */}
      <details className="min-w-0 rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2"><summary className="cursor-pointer font-semibold">Resposta / Mapeamentos</summary>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Guardar da resposta em variáveis</div>
        {mappings.length === 0 && <p className="text-[11px] text-muted">Teste a chamada e clique em <b>usar</b> nos campos, ou escreva o caminho: <code className="font-mono">cliente.nome</code>, <code className="font-mono">itens[0].preco</code>.</p>}
        {mappings.map((m) => {
          const lido = res?.ok ? res.vars[m.varName] : undefined;
          return (
            <div key={m.id} className="space-y-0.5">
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] items-start gap-1.5">
                <input className={`${inputCls} font-mono text-[12px]`} value={m.path} placeholder="cliente.nome" aria-label="Caminho na resposta" onChange={(e) => updM(m.id, { path: e.target.value })} />
                <span className="text-faint text-xs">→</span>
                <input className={`${inputCls} min-w-0 font-mono text-[12px]`} value={m.varName} placeholder="nome" aria-label="Variável" onChange={(e) => updM(m.id, { varName: varName(e.target.value) })} />
                <button aria-label="Remover campo" onClick={() => set({ mappings: mappings.filter((x) => x.id !== m.id) })} className="text-faint hover:text-danger p-1"><X size={14} /></button>
              </div>
              {lido !== undefined && (
                <div className="text-[10.5px] text-muted pl-1 truncate">
                  {res?.missing.includes(m.path) ? <span className="text-warn-ink">não veio na resposta (fica vazia)</span> : <>no teste: <span className="text-ink">{lido || '(vazio)'}</span></>}
                </div>
              )}
            </div>
          );
        })}
        {mappings.length < HTTP_MAX_MAPPINGS && <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ mappings: [...mappings, { id: shortId(), path: '', varName: '' }] })}>Adicionar campo</Button>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 pt-1">
          <Field label="Status HTTP em" hint="200, 404… (0 = não respondeu)"><input className={`${inputCls} min-w-0 max-w-full`} value={data.statusVar ?? ''} onChange={(e) => set({ statusVar: varName(e.target.value) || undefined })} placeholder="api_status" /></Field>
          <Field label="Resposta inteira em" hint="Até 2.000 caracteres"><input className={`${inputCls} min-w-0 max-w-full`} value={data.responseVar ?? ''} onChange={(e) => set({ responseVar: varName(e.target.value) || undefined })} placeholder="api_resposta" /></Field>
        </div>
      </details>

      <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">
        Use as variáveis nos blocos seguintes, ex.: <code className="font-mono">{'Olá {{nome}}, seu pedido está {{status_pedido}}'}</code>, ou numa <b>Condição</b>.
        A saída <b>Erro</b> vale para: fora do ar, tempo esgotado, endereço interno, resposta diferente de 2xx ou resposta que não é JSON (com campos a ler) — nesse caso as variáveis ficam vazias. Sem a saída Erro ligada, segue pela Sucesso.
      </p>
    </div>
  );
}
