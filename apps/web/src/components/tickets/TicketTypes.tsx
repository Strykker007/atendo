'use client';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { downloadJson } from '@/lib/utils';
import {
  TICKET_FIELD_TYPES, TICKET_FIELD_TYPE_LABEL, TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_TYPE_MAX_FIELDS, TICKET_TYPE_PRESETS,
  type TicketField, type TicketFieldType, type TicketPriority, type TicketType,
} from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useExportTicketTypes, useImportTicketTypes, useTicketWrite, type TicketOptions } from '@/lib/hooks';

const CORES = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

/** Bolinha + nome do tipo (lista, detalhe, formulário). */
export function TipoChip({ type }: { type: { name: string; color: string } | null }) {
  if (!type) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: `${type.color}1f`, color: type.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: type.color }} />{type.name}
    </span>
  );
}

/** Inputs dos campos de um tipo (formulário de novo ticket e edição). */
export function CamposDoTipo({ fields, values, onChange }: { fields: TicketField[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  if (!fields.length) return null;
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-line p-3">
      {fields.map((f) => (
        <div key={f.key} className={f.type === 'longtext' ? 'sm:col-span-2' : undefined}>
        <Field label={`${f.label}${f.required ? ' *' : ''}`}>
          {f.type === 'longtext' ? (
            <textarea className={cn(inputCls, 'min-h-[4rem]')} value={values[f.key] ?? ''} maxLength={1000} required={f.required} onChange={(e) => set(f.key, e.target.value)} />
          ) : f.type === 'select' ? (
            <select className={inputCls} value={values[f.key] ?? ''} required={f.required} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">Escolha…</option>
              {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className={inputCls} value={values[f.key] ?? ''} maxLength={1000} required={f.required}
              type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'phone' ? 'tel' : 'text'}
              onChange={(e) => set(f.key, e.target.value)} />
          )}
        </Field>
        </div>
      ))}
    </div>
  );
}

/** Valores preenchidos, na ordem dos campos do tipo (e os que sobraram de campo removido). */
export function ValoresDoTicket({ fields, values }: { fields: TicketField[]; values: Record<string, string> }) {
  const conhecidos = fields.filter((f) => values[f.key]).map((f) => [f.label, f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(values[f.key]) ? values[f.key].split('-').reverse().join('/') : values[f.key]] as const);
  const sobras = Object.entries(values).filter(([k, v]) => v && !fields.some((f) => f.key === k)).map(([k, v]) => [k.replace(/_/g, ' '), v] as const);
  const todos = [...conhecidos, ...sobras];
  if (!todos.length) return null;
  return (
    <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-line px-3 py-2 text-sm">
      {todos.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-muted">{k}</dt>
          <dd className="text-ink whitespace-pre-wrap break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Tipos de ticket da empresa (docs/tickets.md#tipos-de-ticket): é o que deixa o ticket servir a
 * qualquer negócio — portaria, farmácia, clínica, assistência. Começa por um modelo do nicho e ajusta.
 */
export function TiposModal({ opts, onClose }: { opts: TicketOptions; onClose: () => void }) {
  const w = useTicketWrite();
  const [editando, setEditando] = useState<TicketType | 'novo' | null>(null);
  const tipos = opts.types;
  const exportar = useExportTicketTypes();
  const importar = useImportTicketTypes();
  const arquivo = useRef<HTMLInputElement>(null);
  async function subir(f: File) {
    try {
      const r = await importar.mutateAsync(JSON.parse(await f.text()));
      toast.ok(`${r.created.length} tipo(s) importado(s)${r.skipped.length ? ` · ${r.skipped.length} já existia(m)` : ''}`);
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }
  const salvar = (path: string, body: unknown, ok: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') =>
    w.mutateAsync({ path, method, body }).then(() => toast.ok(ok), toast.err);

  if (editando) return <EditorTipo opts={opts} tipo={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} />;

  return (
    <Modal open onClose={onClose} title="Tipos de ticket" width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted">Cada tipo tem setor, prioridade e prazo padrão e os campos que o seu negócio precisa (unidade, produto, paciente…). O fluxo automático escolhe o tipo e preenche os campos com o que o contato respondeu.</p>

        {tipos.length > 0 && (
          <ul className="rounded-xl border border-line divide-y divide-line">
            {tipos.map((t) => (
              <li key={t.id} className={cn('flex items-center gap-2 px-3 py-2', !t.isActive && 'opacity-60')}>
                <TipoChip type={t} />
                <span className="flex-1 min-w-0 text-[12px] text-muted truncate">
                  {t.fields.length ? t.fields.map((f) => f.label).join(', ') : 'sem campos'}
                  {t.departmentId && ` · ${opts.departments.find((d) => d.id === t.departmentId)?.name ?? 'setor'}`}
                  {t.dueDays && ` · ${t.dueDays}d`}
                  {!t.isActive && ' · desativado'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditando(t)}>Editar</Button>
                <button type="button" className="p-1 text-faint hover:text-danger" title="Apagar (com tickets, só desativa)" onClick={() => confirm(`Apagar o tipo "${t.name}"? Se já houver tickets dele, ele só é desativado.`) && salvar(`/types/${t.id}`, undefined, 'Tipo removido', 'DELETE')}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-xl bg-field p-3 space-y-2">
          <p className="text-[13px] font-semibold text-ink flex items-center gap-1.5"><Sparkles size={14} className="text-accent" /> Começar por um modelo</p>
          <div className="flex flex-wrap gap-1.5">
            {TICKET_TYPE_PRESETS.map((p) => (
              <button key={p.niche} type="button" disabled={w.isPending} title={p.types.map((t) => t.name).join(', ')}
                onClick={() => salvar('/types/preset', { niche: p.niche }, `Tipos de ${p.label.toLowerCase()} adicionados`)}
                className="rounded-full border border-line bg-panel px-3 py-1 text-[12px] hover:border-accent hover:text-accent-ink disabled:opacity-60">
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint">Adiciona os tipos do nicho (os que já existem com o mesmo nome ficam como estão). Depois é só editar.</p>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setEditando('novo')}>Tipo em branco</Button>
            <input ref={arquivo} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subir(f); }} />
            <Button variant="ghost" icon={<Upload size={14} />} loading={importar.isPending} onClick={() => arquivo.current?.click()}>Importar</Button>
            {tipos.length > 0 && (
              <Button variant="ghost" icon={<Download size={14} />} loading={exportar.isPending}
                onClick={() => exportar.mutate(undefined, { onSuccess: ({ bundle, warnings }) => { downloadJson(bundle, `tipos-de-ticket-${new Date().toISOString().slice(0, 10)}.json`); warnings.forEach((w) => toast.ok(w)); }, onError: toast.err })}>
                Exportar
              </Button>
            )}
          </div>
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditorTipo({ opts, tipo, onClose }: { opts: TicketOptions; tipo: TicketType | null; onClose: () => void }) {
  const w = useTicketWrite();
  const [f, setF] = useState({
    name: tipo?.name ?? '', color: tipo?.color ?? CORES[0], departmentId: tipo?.departmentId ?? '', priority: (tipo?.priority ?? 'normal') as TicketPriority,
    dueDays: tipo?.dueDays ?? null as number | null, fields: tipo?.fields ?? ([] as TicketField[]), isActive: tipo?.isActive ?? true,
  });
  const setCampo = (i: number, p: Partial<TicketField>) => setF((x) => ({ ...x, fields: x.fields.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const mover = (i: number, d: -1 | 1) => setF((x) => { const a = [...x.fields]; const [c] = a.splice(i, 1); a.splice(i + d, 0, c); return { ...x, fields: a }; });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, departmentId: f.departmentId || null };
    try {
      await w.mutateAsync({ path: tipo ? `/types/${tipo.id}` : '/types', method: tipo ? 'PATCH' : 'POST', body });
      toast.ok('Tipo salvo');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title={tipo ? `Tipo: ${tipo.name}` : 'Novo tipo de ticket'} width="max-w-2xl">
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <Field label="Nome"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required minLength={2} placeholder="Ex.: Manutenção" /></Field>
          <Field label="Cor">
            <div className="flex gap-1 h-[38px] items-center">
              {CORES.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className={cn('w-6 h-6 rounded-full', f.color === c && 'ring-2 ring-offset-2 ring-offset-panel ring-ink')} style={{ backgroundColor: c }} />)}
            </div>
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Setor padrão">
            <select className={inputCls} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
              <option value="">Nenhum</option>
              {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Prioridade padrão">
            <select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Prazo padrão (dias)">
            <input className={inputCls} type="number" min={1} max={365} value={f.dueDays ?? ''} placeholder="sem prazo" onChange={(e) => setF({ ...f, dueDays: e.target.value ? Math.max(1, Math.min(365, Math.round(Number(e.target.value)))) : null })} />
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Campos</p>
          {f.fields.map((c, i) => (
            <div key={i} className="rounded-lg border border-line p-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <input className={cn(inputCls, 'flex-1 min-w-36')} value={c.label} maxLength={60} placeholder="Nome do campo (ex.: Unidade)" onChange={(e) => setCampo(i, { label: e.target.value })} />
                <select className={cn(inputCls, 'w-40')} value={c.type} onChange={(e) => setCampo(i, { type: e.target.value as TicketFieldType, ...(e.target.value === 'select' && !c.options?.length && { options: [] }) })}>
                  {TICKET_FIELD_TYPES.map((t) => <option key={t} value={t}>{TICKET_FIELD_TYPE_LABEL[t]}</option>)}
                </select>
                <label className="text-[12px] flex items-center gap-1"><input type="checkbox" checked={!!c.required} onChange={(e) => setCampo(i, { required: e.target.checked })} /> obrigatório</label>
                <button type="button" className="p-1 text-faint hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={13} /></button>
                <button type="button" className="p-1 text-faint hover:text-ink disabled:opacity-30" disabled={i === f.fields.length - 1} onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={13} /></button>
                <button type="button" className="p-1 text-faint hover:text-danger" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} aria-label="Tirar campo"><X size={13} /></button>
              </div>
              {c.type === 'select' && (
                <input className={inputCls} value={(c.options ?? []).join(', ')} placeholder="Opções separadas por vírgula (ex.: Salão, Churrasqueira, Quadra)"
                  onChange={(e) => setCampo(i, { options: e.target.value.split(',').map((x) => x.trimStart()) })} />
              )}
              {c.key && tipo && <p className="text-[10.5px] text-faint">No fluxo: <code>{c.key}</code></p>}
            </div>
          ))}
          {f.fields.length < TICKET_TYPE_MAX_FIELDS && (
            <Button type="button" size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setF({ ...f, fields: [...f.fields, { key: '', label: '', type: 'text' }] })}>Campo</Button>
          )}
        </div>

        {tipo && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo (desativado some do formulário e do fluxo, mas os tickets antigos continuam com ele)</label>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={w.isPending}>Salvar tipo</Button>
        </div>
      </form>
    </Modal>
  );
}
