'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowDown, ArrowUp, Lock, Pencil, Plus, RotateCcw, Shield, Star, Trash2, Upload, Workflow, X } from 'lucide-react';
import { DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, SYSTEM_PROFILES, type Permission } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
import { useMe, useTenantTemplate, useUpdateTenantTemplate, type TemplateContent, type TemplateFlow, type TemplateProfile, type TemplateQuickReply } from '@/lib/hooks';

const ADMIN = SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name;
/** Gerente e Atendente: sempre listados. Fora do conteúdo = seguem o catálogo. */
const FIXED = SYSTEM_PROFILES.filter((p) => p.role !== 'tenant_admin');
const section = 'rounded-2xl bg-panel border border-line p-4 space-y-3';

/** Itens de um arquivo exportado: individual, lote ou o envelope `{portable}`. */
function itemsOf<T>(raw: unknown, kind: string): T[] {
  const o = ((raw as { portable?: unknown })?.portable ?? raw) as { atendo?: string; items?: unknown[] } | null;
  if (o?.atendo === `${kind}-bundle` && Array.isArray(o.items)) return o.items as T[];
  if (o?.atendo === kind) return [o as T];
  throw new Error(kind === 'flow' ? 'Este arquivo não é uma exportação de fluxos.' : 'Este arquivo não é uma exportação de respostas rápidas.');
}

/**
 * Editor do modelo de perfil: tudo com que um cliente novo nasce — permissões padrão de cada
 * perfil, respostas rápidas, fluxos e motivos de não compra. Salva de uma vez; vale para os
 * próximos clientes criados com o modelo (os já criados não mudam).
 */
export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const tpl = useTenantTemplate(id);
  const save = useUpdateTenantTemplate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [content, setContent] = useState<TemplateContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const { modal, leaveTo } = useUnsavedGuard(dirty);

  // carrega o rascunho uma vez por modelo (refetch em segundo plano não apaga o que está sendo editado)
  const loaded = useRef('');
  useEffect(() => {
    if (!tpl.data || loaded.current === tpl.data.id) return;
    loaded.current = tpl.data.id;
    setName(tpl.data.name);
    setDescription(tpl.data.description ?? '');
    setIsDefault(tpl.data.isDefault);
    setContent(tpl.data.content);
  }, [tpl.data]);

  if (me.data && me.data.role !== 'super_admin') return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;
  if (!tpl.data || !content) return <PageShell><SkeletonRows rows={4} /></PageShell>;

  const edit = (patch: Partial<TemplateContent>) => { setContent({ ...content, ...patch }); setDirty(true); };

  async function onSave() {
    try {
      await save.mutateAsync({ id, name, description, isDefault, content: content! });
      setDirty(false);
      toast.ok('Modelo salvo — vale para os próximos clientes');
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-6xl">
      {modal}
      <PageHeader
        title={tpl.data.name}
        subtitle={<>Tudo com que um cliente novo nasce ao ser criado com este modelo. {tpl.data.tenants ? `${tpl.data.tenants} cliente(s) já foram criados com ele — eles não mudam.` : ''}</>}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => leaveTo('/clientes')}>Clientes</Button>
            <Button onClick={onSave} loading={save.isPending} disabled={!dirty} loadingText="Salvando…">Salvar</Button>
          </div>
        }
      />

      <div className="space-y-4 mt-4">
        <div className={section}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nome"><input className={inputCls} value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
            <Field label="Descrição"><input className={inputCls} value={description} maxLength={300} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder="Balcão + entrega" /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); setDirty(true); }} />
            <span><Star size={13} className="inline -mt-0.5 text-warn-ink" /> Modelo padrão <span className="text-muted">— já vem escolhido no "Novo cliente" e é usado quando a criação não diz qual. Só um pode ser o padrão.</span></span>
          </label>
        </div>

        <ProfilesSection profiles={content.profiles} onChange={(profiles) => edit({ profiles })} />
        <QuickRepliesSection items={content.quickReplies} onChange={(quickReplies) => edit({ quickReplies })} />
        <FlowsSection items={content.flows} onChange={(flows) => edit({ flows })} />
        <LossReasonsSection value={content.lossReasons} fallback={tpl.data.effectiveLossReasons} onChange={(lossReasons) => edit({ lossReasons })} />
      </div>
    </PageShell>
  );
}

/**
 * Perfis com que o cliente nasce, um cartão por perfil — normalmente Administrador, Gerente e
 * Atendente, mais quantos extras o segmento pedir ("Farmacêutico", "Atendente líder"…).
 * Administrador é sempre tudo; Gerente e Atendente seguem o catálogo do sistema até serem editados.
 */
function ProfilesSection({ profiles, onChange }: { profiles: TemplateProfile[]; onChange: (p: TemplateProfile[]) => void }) {
  const [editing, setEditing] = useState<{ original: string | null; name: string; description: string; permissions: Permission[]; system: boolean } | null>(null);
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const cards = [
    ...FIXED.map((f) => {
      const t = byName.get(f.name);
      return { name: f.name, description: t?.description ?? '', permissions: t?.permissions ?? DEFAULT_PERMISSIONS[f.role], system: true, catalog: !t };
    }),
    ...profiles.filter((p) => !FIXED.some((f) => f.name === p.name)).map((p) => ({ name: p.name, description: p.description ?? '', permissions: p.permissions, system: false, catalog: false })),
  ];

  function submit() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return toast.err('Informe o nome do perfil.');
    if (name !== editing.original && (name === ADMIN || cards.some((c) => c.name === name))) return toast.err('Já existe um perfil com esse nome.');
    const p: TemplateProfile = { name, ...(editing.description.trim() && { description: editing.description.trim() }), permissions: editing.permissions };
    // perfil padrão que ainda seguia o catálogo entra no conteúdo a partir desta edição
    onChange(editing.original && byName.has(editing.original) ? profiles.map((x) => (x.name === editing.original ? p : x)) : [...profiles, p]);
    setEditing(null);
  }
  const toggle = (perm: Permission) => editing && setEditing({ ...editing, permissions: editing.permissions.includes(perm) ? editing.permissions.filter((x) => x !== perm) : [...editing.permissions, perm] });

  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Perfis e permissões <span className="text-muted font-normal text-sm">· {cards.length + 1}</span></h2>
          <p className="text-[12px] text-muted">Os perfis que o cliente novo já recebe, cada um com o que pode fazer. A equipe dele é vinculada a eles (admin → Administrador, gerente → Gerente, atendente → Atendente; os extras, o admin atribui na Equipe).</p>
        </div>
        <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setEditing({ original: null, name: '', description: '', permissions: [], system: false })}>Novo perfil</Button>
      </div>

      <div className="rounded-xl border border-line divide-y divide-line">
        <div className="flex items-start gap-3 px-3 py-2.5">
          <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent-ink"><Shield size={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink flex items-center gap-1.5">{ADMIN} <Lock size={12} className="text-faint" /></div>
            <div className="text-[12px] text-muted">Acesso total — o admin da conta sempre pode tudo (senão o cliente ficaria sem como ajustar a própria equipe).</div>
          </div>
        </div>
        {cards.map((c) => (
          <div key={c.name} className="flex items-start gap-3 px-3 py-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent-ink"><Shield size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink flex items-center gap-1.5 flex-wrap">
                {c.name}
                {c.system && <Lock size={12} className="text-faint" />}
                {c.catalog && <span className="text-[10.5px] rounded bg-field text-muted px-1.5 py-0.5">padrão do sistema</span>}
                <span className="text-xs text-muted font-normal">· {c.permissions.length} permiss{c.permissions.length === 1 ? 'ão' : 'ões'}</span>
              </div>
              {c.description && <div className="text-[12px] text-muted">{c.description}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {c.permissions.length === 0 && <span className="text-xs text-muted">Nenhuma permissão — só atende as próprias conversas.</span>}
                {c.permissions.map((perm) => <span key={perm} className="text-[11px] rounded bg-field text-muted px-1.5 py-0.5">{PERMISSIONS[perm]}</span>)}
              </div>
            </div>
            {c.system && !c.catalog && <button title="Voltar ao padrão do sistema" className="text-faint hover:text-accent-ink p-1" onClick={() => onChange(profiles.filter((p) => p.name !== c.name))}><RotateCcw size={14} /></button>}
            <button title="Editar" className="text-faint hover:text-accent-ink p-1" onClick={() => setEditing({ original: c.name, name: c.name, description: c.description, permissions: [...c.permissions], system: c.system })}><Pencil size={14} /></button>
            {!c.system && <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(profiles.filter((p) => p.name !== c.name))}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.original ? `Editar perfil — ${editing.original}` : 'Novo perfil'}>
        {editing && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Nome" hint={editing.system ? 'Perfis padrão não são renomeados.' : undefined}>
                <input className={inputCls} value={editing.name} maxLength={60} required disabled={editing.system} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Farmacêutico" />
              </Field>
              <Field label="Descrição (opcional)"><input className={inputCls} value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            </div>
            {!editing.original && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                Começar com as permissões de:
                {cards.map((c) => <button key={c.name} type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-field text-ink" onClick={() => setEditing({ ...editing, permissions: [...c.permissions] })}>{c.name}</button>)}
              </div>
            )}
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {PERMISSION_GROUPS.map((g) => (
                <div key={g.label} className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">{g.label}</div>
                  {g.items.map((perm) => (
                    <label key={perm} className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                      <input type="checkbox" className="mt-0.5" checked={editing.permissions.includes(perm)} onChange={() => toggle(perm)} />
                      <span>{PERMISSIONS[perm]}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit">OK</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function QuickRepliesSection({ items, onChange }: { items: TemplateQuickReply[]; onChange: (i: TemplateQuickReply[]) => void }) {
  const [editing, setEditing] = useState<{ index: number | null; folder: string; title: string; body: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const folders = [...new Set(items.map((r) => r.folder))];

  async function onImport(f: File) {
    try {
      const add = itemsOf<TemplateQuickReply>(JSON.parse(await f.text()), 'quick-reply');
      onChange([...items, ...add]);
      toast.ok(`${add.length} resposta(s) adicionada(s) — salve para gravar`);
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }
  function submit() {
    if (!editing) return;
    const r: TemplateQuickReply = { atendo: 'quick-reply', version: 1, folder: editing.folder.trim() || 'Geral', title: editing.title.trim(), body: editing.body };
    onChange(editing.index === null ? [...items, r] : items.map((x, i) => (i === editing.index ? r : x)));
    setEditing(null);
  }

  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Respostas rápidas <span className="text-muted font-normal text-sm">· {items.length}</span></h2>
          <p className="text-[12px] text-muted">Sem anexos (áudio, foto, PDF): o cliente reenvia os dele.</p>
        </div>
        <div className="flex gap-2">
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
          <Button variant="ghost" size="sm" icon={<Upload size={14} />} onClick={() => file.current?.click()}>Importar JSON</Button>
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setEditing({ index: null, folder: folders[0] ?? '', title: '', body: '' })}>Nova resposta</Button>
        </div>
      </div>
      {!items.length && <p className="text-sm text-muted">Nenhuma resposta. Crie aqui ou importe a exportação da tela Respostas de um cliente.</p>}
      {folders.map((folder) => (
        <div key={folder}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-1">{folder}</div>
          <div className="rounded-xl border border-line divide-y divide-line">
            {items.map((r, i) => r.folder !== folder ? null : (
              <div key={i} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.title}</div>
                  <div className="text-[12px] text-muted line-clamp-2 whitespace-pre-line">{r.body}</div>
                </div>
                <button title="Editar" className="text-faint hover:text-accent-ink p-1" onClick={() => setEditing({ index: i, folder: r.folder, title: r.title, body: r.body })}><Pencil size={14} /></button>
                <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.index === null ? 'Nova resposta' : 'Editar resposta'}>
        {editing && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Pasta"><input className={inputCls} list="tpl-folders" value={editing.folder} maxLength={60} onChange={(e) => setEditing({ ...editing, folder: e.target.value })} placeholder="Geral" /></Field>
              <Field label="Título"><input className={inputCls} value={editing.title} maxLength={80} required onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            </div>
            <datalist id="tpl-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
            <Field label="Texto" hint="Aceita variáveis: {{contact.name}}, {{agent.name}}…"><textarea className={cn(inputCls, 'min-h-[120px]')} value={editing.body} maxLength={4096} required onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit">OK</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/**
 * Fluxos não são editados aqui — o editor de fluxos precisa de etiquetas, números e departamentos
 * reais. Monte num cliente (pode ser um de testes), exporte na tela Fluxos e importe aqui.
 */
function FlowsSection({ items, onChange }: { items: TemplateFlow[]; onChange: (i: TemplateFlow[]) => void }) {
  const file = useRef<HTMLInputElement>(null);
  async function onImport(f: File) {
    try {
      const add = itemsOf<TemplateFlow>(JSON.parse(await f.text()), 'flow');
      // mesmo nome = substitui (reimportar a versão nova do fluxo é o caso comum)
      const names = new Set(add.map((x) => x.name));
      onChange([...items.filter((x) => !names.has(x.name)), ...add]);
      toast.ok(`${add.length} fluxo(s) adicionado(s) — salve para gravar`);
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }
  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Fluxos <span className="text-muted font-normal text-sm">· {items.length}</span></h2>
          <p className="text-[12px] text-muted">Entram no cliente novo <b>desligados</b>, para o admin revisar e ligar depois de conectar o número. Para criar ou alterar, monte o fluxo num cliente, exporte na tela Fluxos e importe aqui (mesmo nome substitui).</p>
        </div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
        <Button variant="ghost" size="sm" icon={<Upload size={14} />} onClick={() => file.current?.click()}>Importar JSON</Button>
      </div>
      {!items.length && <p className="text-sm text-muted">Nenhum fluxo.</p>}
      {!!items.length && (
        <div className="rounded-xl border border-line divide-y divide-line">
          {items.map((f, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Workflow size={15} className="text-faint shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{f.name}</div>
                {f.description && <div className="text-[12px] text-muted truncate">{f.description}</div>}
              </div>
              <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Motivos de não compra. Sem lista própria, o cliente nasce com os do catálogo. */
function LossReasonsSection({ value, fallback, onChange }: { value?: string[]; fallback: string[]; onChange: (v: string[] | undefined) => void }) {
  const [novo, setNovo] = useState('');
  const list = value ?? fallback;
  const move = (i: number, d: number) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; onChange(l); };
  function add() {
    const m = novo.trim();
    if (!m) return;
    if (list.some((x) => x.toLowerCase() === m.toLowerCase())) return toast.err('Esse motivo já está na lista.');
    if (list.length >= 30) return toast.err('No máximo 30 motivos.');
    onChange([...list, m]);
    setNovo('');
  }
  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Motivos de não compra</h2>
          <p className="text-[12px] text-muted">Chips do encerramento "Não comprou", nesta ordem. {value ? 'Lista própria do modelo.' : 'Usando os do catálogo do sistema.'}</p>
        </div>
        {value && <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => onChange(undefined)}>Usar os do catálogo</Button>}
      </div>
      <div className="rounded-xl border border-line divide-y divide-line">
        {list.map((m, i) => (
          <div key={m} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
            <span className="flex-1">{m}</span>
            <button title="Subir" disabled={i === 0} className="text-faint hover:text-ink disabled:opacity-30 p-1" onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
            <button title="Descer" disabled={i === list.length - 1} className="text-faint hover:text-ink disabled:opacity-30 p-1" onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
            <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={13} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input className={cn(inputCls, 'max-w-xs')} value={novo} maxLength={200} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Receita vencida" />
        <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={add}>Adicionar</Button>
      </div>
    </div>
  );
}
