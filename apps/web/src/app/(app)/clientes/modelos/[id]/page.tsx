'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { ArrowLeft, DoorClosed, Send, GripVertical, Lock, Pencil, Plus, RotateCcw, Shield, Star, Trash2, Upload, Workflow, X } from 'lucide-react';
import { DEFAULT_LOSS_REASONS, DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, SYSTEM_PROFILES, type Permission } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
import { useMe, useTenantTemplate, useUpdateTenantTemplate, type TemplateContent, type TemplateFlow, type TemplateProfile, type TemplateQuickReply, type TemplateSettings, type TemplateTag } from '@/lib/hooks';
import { PALETTE, ColorPopover } from '@/components/ui/ColorSwatches';
import { ApplyToTenantsModal } from './ApplyToTenants';

const ADMIN = SYSTEM_PROFILES.find((p) => p.role === 'tenant_admin')!.name;
/** Gerente e Atendente: sempre listados. Fora do conteúdo = seguem o catálogo. */
const FIXED = SYSTEM_PROFILES.filter((p) => p.role !== 'tenant_admin');
const section = 'rounded-2xl bg-panel border border-line p-4 space-y-3';
/** sem lista própria (nem do formato antigo): as tags de encerramento do catálogo */
const CATALOGO_TAGS: TemplateTag[] = DEFAULT_LOSS_REASONS.map((name) => ({ name, isKanban: false, showOnWon: true, showOnLost: true }));

/** Itens de um arquivo exportado: individual, lote ou o envelope `{portable}`. */
function itemsOf<T>(raw: unknown, kind: string): T[] {
  const o = ((raw as { portable?: unknown })?.portable ?? raw) as { atendo?: string; items?: unknown[] } | null;
  if (o?.atendo === `${kind}-bundle` && Array.isArray(o.items)) return o.items as T[];
  if (o?.atendo === kind) return [o as T];
  throw new Error(kind === 'flow' ? 'Este arquivo não é uma exportação de fluxos.' : 'Este arquivo não é uma exportação de respostas rápidas.');
}

/**
 * Editor do modelo de perfil: tudo com que um cliente novo nasce — permissões padrão de cada
 * perfil, respostas rápidas, fluxos e tags (cor, Kanban, encerramento). Salva de uma vez; vale para os
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
  const [aplicando, setAplicando] = useState(false);
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

  if (me.data && !me.data.systemOwner) return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;
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
      <ApplyToTenantsModal open={aplicando} onClose={() => setAplicando(false)} templateId={id} profiles={tpl.data.content.profiles.map((p) => p.name)} tags={tpl.data.effectiveTags} settings={tpl.data.content.settings} />
      <PageHeader
        title={tpl.data.name}
        subtitle={<>Tudo com que um cliente novo nasce ao ser criado com este modelo. Clientes que já existem só mudam pelo “Aplicar aos clientes”.</>}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => leaveTo('/clientes')}>Clientes</Button>
            {/* lê o modelo salvo: com alteração pendente, aplicaria a versão anterior */}
            <Button variant="ghost" icon={<Send size={15} />} disabled={dirty} title={dirty ? 'Salve o modelo antes de aplicar' : 'Replicar perfis, motivos de encerramento ou tags em clientes que já existem'} onClick={() => setAplicando(true)}>Aplicar aos clientes</Button>
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
            <span><Star size={13} className="inline -mt-0.5 text-warn-ink" /> Modelo padrão <span className="text-muted">— já vem escolhido no “Novo cliente” e é usado quando a criação não diz qual. Só um pode ser o padrão.</span></span>
          </label>
        </div>

        <SettingsSection value={content.settings} onChange={(settings) => edit({ settings })} />
        <ProfilesSection profiles={content.profiles} onChange={(profiles) => edit({ profiles })} />
        <QuickRepliesSection items={content.quickReplies} onChange={(quickReplies) => edit({ quickReplies })} />
        <FlowsSection items={content.flows} onChange={(flows) => edit({ flows })} />
        {/* editar grava `tags` e aposenta o formato antigo (lossReasons); "Voltar ao catálogo" tira as duas */}
        <TagsSection value={content.tags} fallback={content.lossReasons || content.lossReasonColors ? tpl.data.effectiveTags : CATALOGO_TAGS} labels={templateOutcomeLabels(content.settings)} onChange={(tags) => edit({ tags, lossReasons: undefined, lossReasonColors: undefined })} />
      </div>
    </PageShell>
  );
}

/** nomes sugeridos para atendimento sem venda (condomínio, suporte…) */
const SERVICE_LABELS = { wonLabel: 'Resolvido', lostLabel: 'Não resolvido' };

/** O modelo ainda não é uma empresa, então os rótulos vêm do próprio rascunho. */
function templateOutcomeLabels(settings?: TemplateSettings) {
  const service = settings?.salesEnabled === false;
  return {
    won: settings?.wonLabel?.trim() || (service ? SERVICE_LABELS.wonLabel : 'Comprou'),
    lost: settings?.lostLabel?.trim() || (service ? SERVICE_LABELS.lostLabel : 'Não comprou'),
  };
}

/**
 * Configurações → Atendimento com que o cliente nasce: encerramento com ou sem venda, assinatura
 * obrigatória e o nome dos resultados. Sem nada marcado, vale o padrão do sistema.
 */
function SettingsSection({ value, onChange }: { value?: TemplateSettings; onChange: (s: TemplateSettings | undefined) => void }) {
  const s = value ?? {};
  const vendas = s.salesEnabled ?? true;
  const set = (patch: Partial<TemplateSettings>) => {
    const next = { ...s, ...patch };
    (Object.keys(next) as (keyof TemplateSettings)[]).forEach((k) => { if (next[k] === undefined || next[k] === '') delete next[k]; });
    onChange(Object.keys(next).length ? next : undefined);
  };
  // desligar a venda com os nomes vazios já sugere os de atendimento (dá para trocar)
  const alternarVendas = () => set(vendas ? { salesEnabled: false, ...(!s.wonLabel && !s.lostLabel && SERVICE_LABELS) } : { salesEnabled: true, ...(s.wonLabel === SERVICE_LABELS.wonLabel && s.lostLabel === SERVICE_LABELS.lostLabel && { wonLabel: undefined, lostLabel: undefined }) });
  const Switch = ({ on, onToggle, titulo, desc }: { on: boolean; onToggle: () => void; titulo: string; desc: string }) => (
    <div className="flex items-start gap-3">
      <button type="button" role="switch" aria-checked={on} aria-label={titulo} onClick={onToggle} className={`relative mt-0.5 w-9 h-5 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <div className="text-sm"><div className="font-medium text-ink">{titulo}</div><p className="text-xs text-muted">{desc}</p></div>
    </div>
  );
  return (
    <div className={section}>
      <div>
        <h2 className="font-display font-semibold text-ink">Atendimento</h2>
        <p className="text-[12px] text-muted">Como o cliente novo encerra e assina os atendimentos (Configurações → Atendimento). O cliente pode mudar depois. {value ? '' : 'Sem nada definido: padrão do sistema (com venda, assinatura opcional, “Comprou” / “Não comprou”).'}</p>
      </div>
      <Switch on={vendas} onToggle={alternarVendas} titulo="Encerramento com venda"
        desc={vendas ? 'Ligado: o encerramento pede valor e itens da venda (faturamento, ticket médio).' : 'Desligado: atendimento sem venda (condomínio, suporte, serviço público) — só resultado, motivo e tags.'} />
      <Switch on={!!s.requireSignature} onToggle={() => set({ requireSignature: !s.requireSignature })} titulo="Assinatura obrigatória"
        desc={s.requireSignature ? 'Ligado: toda mensagem do atendente sai com o nome dele.' : 'Desligado: cada atendente escolhe no chat.'} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Resultado positivo"><input className={inputCls} value={s.wonLabel ?? ''} maxLength={30} placeholder={vendas ? 'Comprou' : 'Resolvido'} onChange={(e) => set({ wonLabel: e.target.value })} /></Field>
        <Field label="Resultado negativo"><input className={inputCls} value={s.lostLabel ?? ''} maxLength={30} placeholder={vendas ? 'Não comprou' : 'Não resolvido'} onChange={(e) => set({ lostLabel: e.target.value })} /></Field>
      </div>
    </div>
  );
}

/**
 * Perfis com que o cliente nasce, um cartão por perfil — normalmente Administrador, Gerente e
 * Atendente, mais quantos extras o segmento pedir ("Farmacêutico", "Atendente líder"…).
 * Administrador é sempre tudo; os dois perfis operacionais seguem o catálogo até serem editados.
 */
function ProfilesSection({ profiles, onChange }: { profiles: TemplateProfile[]; onChange: (p: TemplateProfile[]) => void }) {
  const [editing, setEditing] = useState<{ original: string | null; systemRole?: 'manager' | 'agent'; name: string; description: string; permissions: Permission[]; system: boolean } | null>(null);
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const cards = [
    ...FIXED.map((f) => {
      const t = profiles.find((p) => p.systemRole === f.role) ?? byName.get(f.name);
      return { name: t?.name ?? f.name, systemRole: f.role as 'manager' | 'agent', description: t?.description ?? '', permissions: t?.permissions ?? DEFAULT_PERMISSIONS[f.role], system: true, catalog: !t };
    }),
    ...profiles.filter((p) => !p.systemRole && !FIXED.some((f) => f.name === p.name)).map((p) => ({ name: p.name, systemRole: undefined, description: p.description ?? '', permissions: p.permissions, system: false, catalog: false })),
  ];

  function submit() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return toast.err('Informe o nome do perfil.');
    if (name !== editing.original && (name === ADMIN || cards.some((c) => c.name === name))) return toast.err('Já existe um perfil com esse nome.');
    const p: TemplateProfile = { name, ...(editing.systemRole && { systemRole: editing.systemRole }), ...(editing.description.trim() && { description: editing.description.trim() }), permissions: editing.permissions };
    // perfil padrão que ainda seguia o catálogo entra no conteúdo a partir desta edição
    const sameProfile = (x: TemplateProfile) => editing.systemRole ? x.systemRole === editing.systemRole || (!x.systemRole && x.name === editing.original) : x.name === editing.original;
    onChange(editing.original && profiles.some(sameProfile) ? profiles.map((x) => (sameProfile(x) ? p : x)) : [...profiles, p]);
    setEditing(null);
  }
  const toggle = (perm: Permission) => editing && setEditing({ ...editing, permissions: editing.permissions.includes(perm) ? editing.permissions.filter((x) => x !== perm) : [...editing.permissions, perm] });

  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Perfis e permissões <span className="text-muted font-normal text-sm">· {cards.length + 1}</span></h2>
          <p className="text-[12px] text-muted">Os perfis que o cliente novo já recebe, cada um com o que pode fazer. Renomeie os dois perfis operacionais para usar o vocabulário do segmento (por exemplo, Porteiro e Supervisor).</p>
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
          <div key={c.systemRole ?? c.name} className="flex items-start gap-3 px-3 py-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-accent-soft text-accent-ink"><Shield size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink flex items-center gap-1.5 flex-wrap">
                {c.name}
                {c.catalog && <span className="text-[10.5px] rounded bg-field text-muted px-1.5 py-0.5">padrão do sistema</span>}
                <span className="text-xs text-muted font-normal">· {c.permissions.length} permiss{c.permissions.length === 1 ? 'ão' : 'ões'}</span>
              </div>
              {c.description && <div className="text-[12px] text-muted">{c.description}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {c.permissions.length === 0 && <span className="text-xs text-muted">Nenhuma permissão — só atende as próprias conversas.</span>}
                {c.permissions.map((perm) => <span key={perm} className="text-[11px] rounded bg-field text-muted px-1.5 py-0.5">{PERMISSIONS[perm]}</span>)}
              </div>
            </div>
            {c.system && !c.catalog && <button title="Voltar ao padrão do sistema" className="text-faint hover:text-accent-ink p-1" onClick={() => onChange(profiles.filter((p) => p.systemRole !== c.systemRole && p.name !== c.name))}><RotateCcw size={14} /></button>}
            <button title="Editar" className="text-faint hover:text-accent-ink p-1" onClick={() => setEditing({ original: c.name, systemRole: c.systemRole, name: c.name, description: c.description, permissions: [...c.permissions], system: c.system })}><Pencil size={14} /></button>
            {!c.system && <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(profiles.filter((p) => p.name !== c.name))}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.original ? `Editar perfil — ${editing.original}` : 'Novo perfil'}>
        {editing && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Nome" hint={editing.system ? 'O nome aparece para o cliente; o papel interno continua o mesmo.' : undefined}>
                <input className={inputCls} value={editing.name} maxLength={60} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Porteiro" />
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
          <p className="text-[12px] text-muted">Entram no cliente novo <b>desligados</b>, para o admin revisar e ligar depois de conectar o número. Para criar ou alterar, monte o fluxo num cliente, exporte na tela Fluxos e importe aqui (mesmo nome substitui). <b>Encerramento</b> marca os que aparecem no modal de encerrar do cliente.</p>
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
              <button
                title={f.showOnClosing ? 'Aparece no encerramento do cliente novo — clique para tirar' : 'Fora do encerramento — clique para mostrar no modal de encerrar'}
                className={cn('flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold', f.showOnClosing ? 'text-accent-ink bg-accent-soft' : 'text-faint hover:text-ink')}
                onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, showOnClosing: !x.showOnClosing } : x)))}
              >
                <DoorClosed size={14} /> Encerramento
              </button>
              <button title="Remover" className="text-faint hover:text-danger p-1" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tags com que o cliente nasce — as mesmas opções da tela de Tags: cor, etapa do Kanban e
 * "aparece no encerramento". A ordem é a das colunas do Kanban. Sem lista própria, o cliente
 * recebe as tags de encerramento do catálogo (ou as do formato antigo do modelo); a primeira
 * edição copia essa lista para o modelo.
 */
function TagsSection({ value, fallback, labels, onChange }: { value?: TemplateTag[]; fallback: TemplateTag[]; labels: { won: string; lost: string }; onChange: (t: TemplateTag[] | undefined) => void }) {
  const list = value ?? fallback;
  const [nomes, setNomes] = useState('');
  const [novaWon, setNovaWon] = useState(false);
  const [novaLost, setNovaLost] = useState(true);
  const [menuEnc, setMenuEnc] = useState(false);
  const [novaKanban, setNovaKanban] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [corDe, setCorDe] = useState<string | null>(null);
  const [corLote, setCorLote] = useState(false);
  const [conflitoDe, setConflitoDe] = useState<string | null>(null);
  // tag removida sai também do "Conflita com" das outras
  const commit = (l: TemplateTag[]) => {
    const nomes = new Set(l.map((t) => t.name));
    onChange(l.map((t) => (t.conflictsWith?.some((n) => !nomes.has(n)) ? { ...t, conflictsWith: t.conflictsWith.filter((n) => nomes.has(n)) } : t)));
    setSel((s) => s.filter((n) => l.some((t) => t.name === n)));
  };
  // o par é simétrico: vale estar na lista de qualquer um dos dois lados
  const opostas = (nome: string) => new Set([...(list.find((t) => t.name === nome)?.conflictsWith ?? []), ...list.filter((t) => t.conflictsWith?.includes(nome)).map((t) => t.name)]);
  function alternarConflito(a: string, b: string, on: boolean) {
    commit(list.map((t) => {
      const outra = t.name === a ? b : t.name === b ? a : null;
      if (!outra) return t;
      const l = (t.conflictsWith ?? []).filter((n) => n !== outra);
      // grava num lado só (o da tag aberta); desligar tira dos dois
      if (on && t.name === a) l.push(b);
      return { ...t, conflictsWith: l.length ? l : undefined };
    }));
  }
  const patch = (names: string[], p: Partial<TemplateTag>) => commit(list.map((t) => (names.includes(t.name) ? { ...t, ...p } : t)));
  // arrastar = ordem das colunas do Kanban do cliente que nascer do modelo
  function onDragEnd(r: DropResult) {
    if (!r.destination || r.destination.index === r.source.index) return;
    const l = [...list];
    const [movida] = l.splice(r.source.index, 1);
    l.splice(r.destination.index, 0, movida);
    commit(l);
  }
  const todas = list.length > 0 && sel.length === list.length;

  function add() {
    const existentes = new Set(list.map((t) => t.name.toLowerCase()));
    const novas = [...new Set(nomes.split(/\r?\n|;/).map((n) => n.trim().slice(0, 40)).filter(Boolean))].filter((n) => !existentes.has(n.toLowerCase()));
    if (!novas.length) return toast.err(nomes.trim() ? 'Essas tags já estão na lista.' : 'Digite o nome da tag.');
    if (list.length + novas.length > 200) return toast.err('No máximo 200 tags no modelo.');
    // cores variadas para começar; cada uma se ajusta clicando na bolinha
    commit([...list, ...novas.map((name, i) => ({ name, color: PALETTE[(list.length + i) % PALETTE.length], isKanban: novaKanban, showOnWon: novaWon, showOnLost: novaLost }))]);
    setNomes('');
  }

  const sw = (on: boolean, onClick: () => void, label: string) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cn('relative w-9 h-5 rounded-full transition-colors', on ? 'bg-ok' : 'bg-line')}>
      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );

  return (
    <div className={section}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-ink">Tags</h2>
          <p className="text-[12px] text-muted">Tags com que o cliente nasce, com cor e etapa do Kanban. As marcadas em {labels.won} / {labels.lost} viram os MOTIVOS de encerramento do cliente novo. Os nomes são definidos acima, em Atendimento. Arraste para ordenar — é a ordem das colunas do Kanban. {value ? 'Lista própria do modelo.' : 'Usando as tags de encerramento do catálogo — editar copia a lista para o modelo.'}</p>
        </div>
        {value && <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => { setSel([]); onChange(undefined); }}>Voltar às do catálogo</Button>}
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs">
          <input type="checkbox" aria-label="Selecionar todas" checked={todas} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !todas; }} onChange={() => setSel(todas ? [] : list.map((t) => t.name))} />
          <span className="text-muted flex-1 min-w-[8rem]">{sel.length ? `${sel.length} selecionada(s)` : `Selecionar todas (${list.length})`}</span>
          {sel.length > 0 && (
            <>
              <div className="relative">
                <Button size="sm" variant="ghost" onClick={() => setMenuEnc((v) => !v)}>Encerramento</Button>
                {menuEnc && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenuEnc(false)} />
                    <div className="absolute left-0 top-full mt-1 z-30 w-60 rounded-lg border border-line bg-panel p-1.5 shadow-lg text-[12.5px]">
                      {([['showOnWon', labels.won], ['showOnLost', labels.lost]] as const).map(([campo, rotulo]) => (
                        <div key={campo} className="flex items-center gap-1 px-1.5 py-1">
                          <span className="flex-1 text-ink font-medium">{rotulo}</span>
                          <button type="button" className="rounded px-2 py-0.5 text-ok hover:bg-ok-soft" onClick={() => { setMenuEnc(false); patch(sel, { [campo]: true }); }}>Mostrar</button>
                          <button type="button" className="rounded px-2 py-0.5 text-muted hover:bg-field" onClick={() => { setMenuEnc(false); patch(sel, { [campo]: false }); }}>Tirar</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => patch(sel, { isKanban: true })}>Pôr no Kanban</Button>
              <Button size="sm" variant="ghost" onClick={() => patch(sel, { isKanban: false })}>Tirar do Kanban</Button>
              <div className="relative">
                <Button size="sm" variant="ghost" onClick={() => setCorLote((v) => !v)}>Cor</Button>
                {corLote && <ColorPopover align="right" onClose={() => setCorLote(false)} onPick={(c) => { setCorLote(false); patch(sel, { color: c }); }} />}
              </div>
              <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 size={13} />} onClick={() => commit(list.filter((t) => !sel.includes(t.name)))}>Remover</Button>
            </>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className="rounded-xl border border-line overflow-hidden">
          <div className="flex items-end gap-2 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint border-b border-line">
            <span className="w-9 shrink-0" />
            <span className="w-5 shrink-0" />
            <span className="flex-1">Tag</span>
            <span className="w-16 text-center">Kanban</span>
            <span className="w-20 text-center leading-tight">{labels.won}</span>
            <span className="w-20 text-center leading-tight">{labels.lost}</span>
            <span className="w-16 text-center leading-tight">Conflita com</span>
            <span className="w-7 shrink-0" />
          </div>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="tags-modelo">
              {(drop) => (
                <div ref={drop.innerRef} {...drop.droppableProps} className="divide-y divide-line">
                  {list.map((t, i) => (
                    <Draggable key={t.name} draggableId={t.name} index={i}>
                      {(drag, snap) => (
                        <div ref={drag.innerRef} {...drag.draggableProps} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm text-ink bg-panel', sel.includes(t.name) && 'bg-accent-soft/40', snap.isDragging && 'shadow-lg rounded-lg ring-1 ring-line')}>
                          <span className="w-9 shrink-0 flex items-center gap-1">
                            <span {...drag.dragHandleProps} title="Arraste para reordenar" className="text-faint hover:text-ink cursor-grab"><GripVertical size={14} /></span>
                            <input type="checkbox" aria-label={`Selecionar ${t.name}`} checked={sel.includes(t.name)} onChange={() => setSel((s) => (s.includes(t.name) ? s.filter((x) => x !== t.name) : [...s, t.name]))} />
                          </span>
                          <div className="relative w-5 shrink-0">
                            <button type="button" onClick={() => setCorDe(corDe === t.name ? null : t.name)} title="Trocar a cor" aria-label={`Cor de ${t.name}`} className="w-4 h-4 rounded-full block border border-line hover:ring-2 hover:ring-line" style={{ background: t.color ?? '#6366f1' }} />
                            {corDe === t.name && <ColorPopover value={t.color} onClose={() => setCorDe(null)} onPick={(c) => { setCorDe(null); patch([t.name], { color: c }); }} />}
                          </div>
                          <span className="flex-1 min-w-0 truncate"><span className="text-[11px] text-white rounded px-1.5 py-0.5" style={{ background: t.color ?? '#6366f1' }}>{t.name}</span></span>
                          <span className="w-16 flex justify-center">{sw(!!t.isKanban, () => patch([t.name], { isKanban: !t.isKanban }), `${t.name} no Kanban`)}</span>
                          <span className="w-20 flex justify-center">{sw(!!t.showOnWon, () => patch([t.name], { showOnWon: !t.showOnWon }), `${t.name} ao encerrar como ${labels.won}`)}</span>
                          <span className="w-20 flex justify-center">{sw(!!t.showOnLost, () => patch([t.name], { showOnLost: !t.showOnLost }), `${t.name} ao encerrar como ${labels.lost}`)}</span>
                          <span className="w-16 flex justify-center">
                            {(() => {
                              const n = opostas(t.name).size;
                              return (
                                <button type="button" onClick={() => setConflitoDe(t.name)} title="Tags que saem quando esta é marcada" aria-label={`Conflitos de ${t.name}`} className={cn('rounded px-1.5 h-6 text-[11.5px] tnum', n ? 'text-accent bg-accent-soft font-medium' : 'text-faint hover:text-ink hover:bg-field')}>
                                  ⇄ {n || '—'}
                                </button>
                              );
                            })()}
                          </span>
                          <button title="Remover" className="w-7 shrink-0 text-faint hover:text-danger p-1" onClick={() => commit(list.filter((_, j) => j !== i))}><X size={13} /></button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {drop.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {conflitoDe && (() => {
        const ops = opostas(conflitoDe);
        // tag marcada só em Comprou/Não comprou vira motivo no cliente novo, não tag: não tem conflito
        const viraTag = (t: TemplateTag) => !!t.isKanban || !(t.showOnWon || t.showOnLost);
        const aberta = list.find((t) => t.name === conflitoDe);
        return (
          <Modal open onClose={() => setConflitoDe(null)} title={`“${conflitoDe}” conflita com`} width="max-w-md">
            <p className="text-xs text-muted mb-2">No cliente novo, marcar <b>{conflitoDe}</b> tira estas tags (e marcar uma delas tira {conflitoDe}). Só as opostas diretas — nunca em cadeia. Até 20.</p>
            {aberta && !viraTag(aberta) && <p className="text-xs text-warn-ink bg-warn-soft rounded-lg px-3 py-2 mb-2">Esta tag vira motivo de encerramento no cliente novo (está só em {labels.won}/{labels.lost}), então os conflitos dela não valem. Ligue o Kanban para ela continuar tag.</p>}
            <div className="max-h-80 overflow-y-auto divide-y divide-line rounded-lg border border-line">
              {list.filter((t) => t.name !== conflitoDe).map((t) => {
                const on = ops.has(t.name);
                const cheio = !on && (ops.size >= 20 || opostas(t.name).size >= 20);
                return (
                  <label key={t.name} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm', cheio ? 'opacity-50' : 'cursor-pointer hover:bg-field')}>
                    <input type="checkbox" checked={on} disabled={cheio} onChange={(e) => alternarConflito(conflitoDe, t.name, e.target.checked)} />
                    <span className="text-[11px] text-white rounded px-1.5 py-0.5" style={{ background: t.color ?? '#6366f1' }}>{t.name}</span>
                    {!viraTag(t) && <span className="text-[11px] text-faint ml-auto">vira motivo — não vale</span>}
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end mt-3"><Button size="sm" onClick={() => setConflitoDe(null)}>Pronto</Button></div>
          </Modal>
        );
      })()}

      <div className="space-y-2">
        <textarea className={cn(inputCls, 'resize-none font-mono text-[13px]')} rows={3} value={nomes} onChange={(e) => setNomes(e.target.value)} placeholder={'Adicionar tags — uma por linha (ou separadas por ;)\nReceita vencida\nAchou caro'} aria-label="Nomes das tags a adicionar" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-muted">Aparecem ao encerrar como:</span>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={novaWon} onChange={(e) => setNovaWon(e.target.checked)} /> {labels.won}</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={novaLost} onChange={(e) => setNovaLost(e.target.checked)} /> {labels.lost}</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={novaKanban} onChange={(e) => setNovaKanban(e.target.checked)} /> Viram etapas do Kanban</label>
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={add}>Adicionar</Button>
        </div>
      </div>
    </div>
  );
}
