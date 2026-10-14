'use client';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useRolloutTenantTemplate, useTenants, type TemplateRolloutResult, type TemplateTag } from '@/lib/hooks';

/**
 * "Aplicar aos clientes" (docs/20-modelos-de-perfil.md → Aplicar aos clientes).
 *
 * O modelo só é lido na criação do cliente; isto leva partes dele (perfis escolhidos, motivos
 * Comprou / Não comprou, tags que faltam) para quem já existe. Sempre passa pela prévia: o dono
 * vê cliente por cliente o que muda antes de gravar.
 */
export function ApplyToTenantsModal({ open, onClose, templateId, profiles, tags }: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  /** perfis que o modelo ajusta (nomes) */
  profiles: string[];
  /** tags efetivas do modelo salvo */
  tags: TemplateTag[];
}) {
  const tenants = useTenants();
  const rollout = useRolloutTenantTemplate();
  const ativos = (tenants.data ?? []).filter((t) => t.isActive);

  const [perfis, setPerfis] = useState<string[]>([]);
  const [motivos, setMotivos] = useState(false);
  const [substituir, setSubstituir] = useState(false);
  const [comTags, setComTags] = useState(false);
  const [todos, setTodos] = useState(true);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [previa, setPrevia] = useState<TemplateRolloutResult[] | null>(null);

  const motivosModelo = tags.filter((t) => t.showOnWon || t.showOnLost);
  const ganhos = motivosModelo.filter((t) => t.showOnWon).length;
  const perdas = motivosModelo.filter((t) => t.showOnLost).length;
  const tagsModelo = tags.filter((t) => t.isKanban || !(t.showOnWon || t.showOnLost));
  const filtrados = useMemo(() => ativos.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())), [ativos, q]);

  const body = () => ({
    id: templateId,
    ...(!todos && { tenantIds: escolhidos }),
    ...(perfis.length && { profiles: perfis }),
    ...(motivos && { closeReasons: true, replaceCloseReasons: substituir }),
    ...(comTags && { tags: true }),
  });
  const algo = perfis.length > 0 || motivos || comTags;
  const alvo = todos ? ativos.length : escolhidos.length;
  // mudou a escolha: a prévia antiga não vale mais
  const mexer = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPrevia(null); };

  async function verPrevia() {
    try { setPrevia(await rollout.mutateAsync({ ...body(), dryRun: true })); } catch (e) { toast.err(e); }
  }
  async function aplicar() {
    try {
      const r = await rollout.mutateAsync(body());
      const mudaram = r.filter(temMudanca).length;
      toast.ok(`Aplicado: ${mudaram} de ${r.length} cliente(s) tiveram mudanças`);
      setPrevia(null);
      onClose();
    } catch (e) { toast.err(e); }
  }

  const comMudanca = previa?.filter(temMudanca) ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Aplicar aos clientes" width="max-w-3xl">
      <div className="space-y-5 text-sm">
        <p className="text-muted">Leva o que está <b className="text-ink">salvo</b> neste modelo para clientes que já existem. Nada é apagado: perfis e tags nunca são removidos, e motivo fora do padrão só é desativado (o histórico e os relatórios continuam com o nome).</p>

        <section className="space-y-2">
          <h3 className="font-medium text-ink">O que aplicar</h3>
          {profiles.length ? (
            <div className="rounded-xl border border-line p-3 space-y-1.5">
              <p className="text-xs text-muted">Perfis — as permissões do modelo substituem as do perfil de mesmo nome (o que não existir é criado). Administrador nunca muda.</p>
              {profiles.map((p) => (
                <Check key={p} checked={perfis.includes(p)} onChange={mexer((v: boolean) => setPerfis((l) => (v ? [...l, p] : l.filter((x) => x !== p))))}>{p}</Check>
              ))}
            </div>
          ) : (
            <p className="text-xs text-faint">Este modelo não ajusta nenhum perfil (Gerente e Atendente seguem o catálogo) — nada de perfil para aplicar.</p>
          )}
          <div className="rounded-xl border border-line p-3 space-y-1.5">
            <Check checked={motivos} disabled={!motivosModelo.length} onChange={mexer(setMotivos)}>
              Motivos de encerramento <span className="text-muted">— {motivosModelo.length ? `${ganhos} em Comprou, ${perdas} em Não comprou` : 'nenhuma tag do modelo marcada Comprou / Não comprou'}</span>
            </Check>
            {motivos && (
              <div className="pl-6 space-y-1">
                <p className="text-xs text-muted">Mesmo nome (ignorando maiúsculas) = atualiza o resultado e a cor e reativa; o que faltar é criado. Motivos de atendimento interno não são tocados.</p>
                <Check checked={substituir} onChange={mexer(setSubstituir)}>
                  Deixar idêntico ao modelo <span className="text-muted">— desativa os motivos do cliente que não estão no modelo</span>
                </Check>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line p-3">
            <Check checked={comTags} disabled={!tagsModelo.length} onChange={mexer(setComTags)}>
              Tags que faltam <span className="text-muted">— cria as {tagsModelo.length} tags do modelo que o cliente não tem (as dele não mudam)</span>
            </Check>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-ink">Para quem</h3>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={todos} onChange={() => mexer(setTodos)(true)} /> Todos os clientes ativos ({ativos.length})</label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={!todos} onChange={() => mexer(setTodos)(false)} /> Escolher clientes{!todos && ` (${escolhidos.length})`}</label>
          </div>
          {!todos && (
            <div className="rounded-xl border border-line">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                <Search size={14} className="text-faint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" className="flex-1 bg-transparent focus:outline-none" />
                <button type="button" className="text-xs text-accent-ink hover:underline" onClick={() => mexer(setEscolhidos)([...new Set([...escolhidos, ...filtrados.map((t) => t.id)])])}>Marcar visíveis</button>
                <button type="button" className="text-xs text-muted hover:underline" onClick={() => mexer(setEscolhidos)([])}>Limpar</button>
              </div>
              <div className="max-h-48 overflow-y-auto p-2 grid sm:grid-cols-2 gap-x-3 gap-y-1">
                {filtrados.map((t) => (
                  <Check key={t.id} checked={escolhidos.includes(t.id)} onChange={mexer((v: boolean) => setEscolhidos((l) => (v ? [...l, t.id] : l.filter((x) => x !== t.id))))}>{t.name}</Check>
                ))}
              </div>
            </div>
          )}
        </section>

        {previa && (
          <section className="space-y-2">
            <h3 className="font-medium text-ink">Prévia — {comMudanca.length} de {previa.length} cliente(s) mudam</h3>
            {!comMudanca.length && <p className="text-xs text-faint">Todos já estão iguais ao modelo nas partes escolhidas.</p>}
            <ul className="max-h-72 overflow-y-auto divide-y divide-line rounded-xl border border-line">
              {comMudanca.map((r) => (
                <li key={r.tenantId} className="px-3 py-2 space-y-0.5">
                  <p className="font-medium text-ink">{r.name}</p>
                  <Linha rotulo="Perfis criados" itens={r.profiles.created} />
                  <Linha rotulo="Perfis atualizados" itens={r.profiles.updated} />
                  <Linha rotulo="Motivos criados" itens={r.closeReasons.created} />
                  <Linha rotulo="Motivos atualizados" itens={r.closeReasons.updated} />
                  <Linha rotulo="Motivos reativados" itens={r.closeReasons.reactivated} />
                  <Linha rotulo="Motivos desativados" itens={r.closeReasons.deactivated} perigo />
                  <Linha rotulo="Tags criadas" itens={r.tags.created} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {previa
            ? <Button onClick={aplicar} disabled={!comMudanca.length} loading={rollout.isPending} loadingText="Aplicando…">Aplicar em {comMudanca.length} cliente(s)</Button>
            : <Button onClick={verPrevia} disabled={!algo || !alvo} loading={rollout.isPending} loadingText="Calculando…">Ver prévia</Button>}
        </div>
      </div>
    </Modal>
  );
}

const temMudanca = (r: TemplateRolloutResult) =>
  [r.profiles.created, r.profiles.updated, r.closeReasons.created, r.closeReasons.updated, r.closeReasons.reactivated, r.closeReasons.deactivated, r.tags.created].some((l) => l.length > 0);

function Linha({ rotulo, itens, perigo }: { rotulo: string; itens: string[]; perigo?: boolean }) {
  if (!itens.length) return null;
  return <p className={cn('text-xs', perigo ? 'text-danger' : 'text-muted')}><span className="font-medium">{rotulo} ({itens.length}):</span> {itens.join(', ')}</p>;
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('flex items-start gap-2', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}
