'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useAgents, useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment, type Department } from '@/lib/hooks';

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b', '#f97316'];

type Draft = { id?: string; name: string; description: string; color: string; isActive: boolean; parentId: string; userIds: string[] };

/** Lista em árvore (pai, depois os filhos recuados) com a profundidade de cada um. */
function emArvore(lista: Department[]): { d: Department; nivel: number }[] {
  const ids = new Set(lista.map((d) => d.id));
  const filhos = (pai: string | null) => lista.filter((d) => (d.parentId && ids.has(d.parentId) ? d.parentId : null) === pai);
  const out: { d: Department; nivel: number }[] = [];
  const visto = new Set<string>();
  const descer = (pai: string | null, nivel: number) => {
    for (const d of filhos(pai)) {
      if (visto.has(d.id)) continue;
      visto.add(d.id);
      out.push({ d, nivel });
      descer(d.id, nivel + 1);
    }
  };
  descer(null, 0);
  return out;
}

/** O próprio departamento e todos abaixo dele: não podem ser escolhidos como "acima" (seria ciclo). */
function abaixoDe(lista: Department[], id: string): Set<string> {
  const out = new Set([id]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const d of lista) if (d.parentId && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); mudou = true; }
  }
  return out;
}

/**
 * Departamentos (Vendas, Suporte, Balcão…): separam a fila. Quem participa de algum
 * departamento passa a ver só as conversas dele(s) e as sem departamento. Com hierarquia, o
 * gestor (vê toda a equipe) vê também os departamentos abaixo do dele, nunca os de cima.
 * Ver docs/departamentos.md#hierarquia.
 */
export function DepartmentsSection() {
  const departments = useDepartments();
  const agents = useAgents();
  const create = useCreateDepartment();
  const update = useUpdateDepartment();
  const remove = useDeleteDepartment();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const lista = departments.data ?? [];
  // participantes possíveis: equipe ativa + quem já está no departamento (para poder tirar)
  const pessoas = (agents.data ?? []).filter((a) => a.isActive || editing?.userIds.includes(a.id));

  function abrir(d?: Department) {
    setEditing(d
      ? { id: d.id, name: d.name, description: d.description ?? '', color: d.color, isActive: d.isActive, parentId: d.parentId ?? '', userIds: d.users.map((u) => u.user.id) }
      : { name: '', description: '', color: PALETTE[lista.length % PALETTE.length], isActive: true, parentId: '', userIds: [] });
  }

  async function salvar() {
    if (!editing) return;
    // participantes não vão daqui: quem é de qual setor se define na tela única de Acesso (Equipe)
    const body = { name: editing.name.trim(), description: editing.description.trim() || null, color: editing.color, isActive: editing.isActive, parentId: editing.parentId || null };
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, ...body });
      else await create.mutateAsync(body);
      toast.ok('Departamento salvo');
      setEditing(null);
    } catch (e) {
      toast.err(e);
    }
  }

  function alternarAtivo(d: Department) {
    update.mutateAsync({ id: d.id, isActive: !d.isActive }).then(() => toast.ok(d.isActive ? 'Departamento desativado' : 'Departamento ativado')).catch(toast.err);
  }

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold text-ink">Departamentos</h2>
          <p className="text-sm text-muted">
            Separe a fila por área (Vendas, Suporte, Balcão…). Quem participa de um departamento vê só as conversas dele e as sem departamento.
            Coloque um departamento abaixo de outro para montar a hierarquia: o gestor de cima vê os de baixo, o de baixo não vê os de cima.
            Só o administrador da conta vê todos. Fluxos podem direcionar a conversa (blocos Distribuidor e Ação).
          </p>
        </div>
        <Button onClick={() => abrir()} icon={<Plus size={16} />}>Novo departamento</Button>
      </div>

      {departments.isLoading && <div className="h-12 rounded-lg bg-field animate-pulse" />}
      {!departments.isLoading && lista.length === 0 && <p className="text-sm text-muted rounded-lg bg-field px-3 py-3">Nenhum departamento ainda. Sem departamentos, toda a equipe vê a mesma fila.</p>}

      <ul className="divide-y divide-line">
        {emArvore(lista).map(({ d, nivel }) => (
          <li key={d.id} className={cn('flex items-center gap-3 py-2.5', !d.isActive && 'opacity-60')} style={{ paddingLeft: nivel ? Math.min(nivel, 4) * 20 : undefined }}>
            {nivel > 0 && <span className="text-faint -mr-1 shrink-0" aria-hidden>└</span>}
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color }}><Building2 size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink truncate">{d.name}{!d.isActive && <span className="ml-1.5 text-[11px] font-normal text-muted">(desativado)</span>}</div>
              <div className="text-xs text-muted truncate">
                {d.users.length ? d.users.map((u) => u.user.name).join(', ') : 'Nenhum participante'} · {d._count.conversations} conversa(s) aberta(s)
                {d.description && <> · {d.description}</>}
              </div>
            </div>
            {/* liga/desliga direto na lista */}
            <button
              type="button"
              role="switch"
              aria-checked={d.isActive}
              onClick={() => alternarAtivo(d)}
              title={d.isActive ? 'Desativar' : 'Ativar'}
              className={cn('relative w-9 h-5 rounded-full transition-colors shrink-0', d.isActive ? 'bg-accent' : 'bg-line')}
            >
              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', d.isActive ? 'left-[18px]' : 'left-0.5')} />
            </button>
            <button onClick={() => abrir(d)} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field" title="Editar"><Pencil size={15} /></button>
            <button onClick={() => setDeleting(d)} className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-field" title="Excluir"><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar departamento' : 'Novo departamento'}>
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} className="space-y-3">
            <Field label="Nome"><input className={inputCls} value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Vendas" required autoFocus /></Field>
            <Field label="Descrição (opcional)"><input className={inputCls} value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Orçamentos e novos contatos" /></Field>
            <Field label="Fica abaixo de" hint="O gestor do departamento de cima vê este; quem é só deste não vê o de cima.">
              <select className={inputCls} value={editing.parentId} onChange={(e) => setEditing({ ...editing, parentId: e.target.value })}>
                <option value="">Nenhum (topo)</option>
                {lista.filter((d) => !editing.id || !abaixoDe(lista, editing.id).has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Cor">
              <div className="flex flex-wrap gap-2 pt-1">
                {PALETTE.map((c) => (
                  <button type="button" key={c} onClick={() => setEditing({ ...editing, color: c })} className="w-7 h-7 rounded-full transition" style={{ background: c, boxShadow: editing.color === c ? `0 0 0 2px var(--color-panel, white), 0 0 0 4px ${c}` : undefined }} aria-label={c} />
                ))}
              </div>
            </Field>
            {/* só leitura: delegação de acesso fica num lugar só — Equipe → Acesso (docs/18-perfis-de-acesso.md#tela-de-acesso) */}
            <Field label="Participantes" hint="Quem participa recebe as conversas deste departamento e só enxerga as daqui (e as dos departamentos abaixo, se for gestor) e as sem departamento.">
              <div className="rounded-lg border border-line px-3 py-2 text-sm">
                {editing.userIds.length
                  ? <span className="text-ink">{pessoas.filter((a) => editing.userIds.includes(a.id)).map((a) => a.name).join(', ')}</span>
                  : <span className="text-muted">Ninguém ainda.</span>}
                <p className="mt-1 text-[12px] text-muted">Para incluir ou tirar alguém, abra <Link href="/equipe" className="underline">Equipe</Link> → <b>Acesso</b> da pessoa. Todo acesso é definido lá.</p>
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Departamento ativo</label>
            {!editing.isActive && <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Desativado, ele some dos seletores (fluxos, transferência e filtro). As conversas que já estão nele continuam nele.</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" loading={create.isPending || update.isPending} loadingText="Salvando…" disabled={!editing.name.trim()}>Salvar</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir departamento"
        text={`Excluir "${deleting?.name}"? ${lista.some((d) => d.parentId === deleting?.id) ? 'Os departamentos abaixo dele vão para o topo. ' : ''}${deleting?._count.conversations ? `As ${deleting._count.conversations} conversa(s) aberta(s) dele ficam sem departamento e passam a aparecer para toda a equipe. ` : ''}Fluxos que apontam para ele passam a avisar a equipe (o Distribuidor segue por "Ninguém disponível"). Para só parar de usar, prefira desativar.`}
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try { await remove.mutateAsync(deleting.id); toast.ok('Departamento excluído'); } catch (e) { toast.err(e); throw e; }
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
