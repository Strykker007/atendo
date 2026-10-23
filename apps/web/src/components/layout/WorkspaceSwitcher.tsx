'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown, Eye, KeyRound, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, impersonation, setAccessToken } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useImpersonate, useMemberships, useTenants, type Membership } from '@/lib/hooks';

const PAPEL: Record<Membership['role'], string> = { super_admin: 'Dono do sistema', tenant_admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' };
const RECENT_KEY = 'atendo-recent-tenants';
const MAX_RECENT = 5;
const MAX_TODOS = 60;

const recentes = {
  get: (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } },
  add: (id: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentes.get().filter((x) => x !== id)].slice(0, MAX_RECENT))); } catch { /* ignore */ } },
};
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Item =
  | { kind: 'membro'; key: string; label: string; hint: string; m: Membership }
  | { kind: 'cliente'; key: string; label: string; hint: string; tenantId: string };

/**
 * Seletor de empresa (docs/multiempresa.md#seletor): "Minhas empresas" troca de verdade, como membro
 * (`/auth/switch`); para o dono, "Recentes" e a busca em todos os clientes entram como dono
 * (docs/donos-do-sistema.md#ver-cliente). Abre com Ctrl+K (⌘K) de qualquer tela.
 */
export function WorkspaceSwitcher({ collapsed, owner }: { collapsed: boolean; owner: boolean }) {
  const memberships = useMemberships();
  const tenants = useTenants(owner);
  const impersonate = useImpersonate();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const vendo = typeof window !== 'undefined' ? impersonation.get() : null;
  const minhas = useMemo(() => memberships.data ?? [], [memberships.data]);
  const atual = minhas.find((m) => m.current);
  const visivel = owner || minhas.length > 1;

  useEffect(() => {
    if (!visivel) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visivel]);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const grupos = useMemo(() => {
    const t = normal(q.trim());
    const bate = (s: string) => !t || normal(s).includes(t);
    const meus = minhas
      .filter((m) => bate(m.tenantName ?? 'Dono do sistema'))
      .map<Item>((m) => ({ kind: 'membro', key: `m:${m.userId}`, label: m.tenantName ?? 'Dono do sistema', hint: m.systemOwner && m.tenantId ? `${PAPEL[m.role]} · dono` : PAPEL[m.role], m }));
    if (!owner) return [{ titulo: 'Minhas empresas', itens: meus }];
    const minhasIds = new Set(minhas.map((m) => m.tenantId));
    const todos = (tenants.data ?? []).filter((x) => !minhasIds.has(x.id));
    const porId = new Map(todos.map((x) => [x.id, x]));
    const cliente = (x: { id: string; name: string }): Item => ({ kind: 'cliente', key: `c:${x.id}`, label: x.name, hint: 'entrar como dono', tenantId: x.id });
    const rec = t ? [] : recentes.get().map((id) => porId.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map(cliente);
    const recIds = new Set(rec.map((r) => r.key));
    const resto = todos.filter((x) => bate(x.name) && !recIds.has(`c:${x.id}`)).slice(0, MAX_TODOS).map(cliente);
    return [
      { titulo: 'Minhas empresas', itens: meus },
      { titulo: 'Recentes', itens: rec },
      { titulo: t ? 'Clientes' : `Todos os clientes (${todos.length})`, itens: resto },
    ].filter((g) => g.itens.length);
  }, [q, minhas, owner, tenants.data]);
  const itens = grupos.flatMap((g) => g.itens);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  if (!visivel) return null;

  async function escolher(it: Item) {
    setBusy(true);
    try {
      if (it.kind === 'membro') {
        if (it.m.current && !vendo) { setOpen(false); return; }
        const r = await api<{ accessToken: string }>('/auth/switch', { method: 'POST', body: JSON.stringify({ userId: it.m.userId }) });
        impersonation.set(null);
        setAccessToken(r.accessToken);
        qc.clear();
        setOpen(false);
        router.replace(it.m.tenantId ? '/conversas' : '/admin');
        return;
      }
      if (vendo?.tenantId === it.tenantId) { setOpen(false); return; }
      const r = await impersonate.mutateAsync(it.tenantId);
      impersonation.set({ tenantId: it.tenantId, name: it.label });
      recentes.add(it.tenantId);
      setAccessToken(r.accessToken);
      qc.clear();
      setOpen(false);
      router.push('/conversas');
    } catch (err) { toast.err(err); } finally { setBusy(false); }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, itens.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && itens[sel]) { e.preventDefault(); void escolher(itens[sel]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const rotulo = vendo ? vendo.name : atual?.tenantName ?? 'Dono do sistema';
  const icone = vendo ? <Eye size={14} /> : atual?.tenantId ? <Building2 size={14} /> : <KeyRound size={14} />;
  let i = -1;

  return (
    <>
      {collapsed ? (
        <button type="button" onClick={() => setOpen(true)} title={`${rotulo} — trocar (Ctrl+K)`} aria-label="Trocar de empresa"
          className={cn('mx-auto mb-1 p-1.5 rounded-md hover:bg-white/5', vendo ? 'text-white' : 'text-side-ink/60 hover:text-white')}>
          {icone}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} title="Trocar de empresa (Ctrl+K)"
          className={cn('mx-2 mb-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium', vendo ? 'bg-c4 text-white' : 'bg-white/5 text-side-ink hover:text-white')}>
          <span className="shrink-0 opacity-80">{icone}</span>
          <span className="flex-1 min-w-0">
            <span className="block truncate">{rotulo}</span>
            {vendo && <span className="block text-[10.5px] font-normal opacity-75">entrando como dono</span>}
          </span>
          <ChevronsUpDown size={13} className="shrink-0 opacity-60" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-label="Trocar de empresa" className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search size={15} className="text-muted shrink-0" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} disabled={busy}
                placeholder={owner ? 'Buscar empresa ou cliente…' : 'Buscar empresa…'} aria-label="Buscar empresa"
                className="flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-faint focus:outline-none" />
              <kbd className="hidden sm:block rounded border border-line px-1.5 text-[10.5px] text-muted">Esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1.5">
              {vendo && (
                <p className="mx-3.5 mb-1.5 rounded-md bg-field px-2.5 py-1.5 text-[12px] text-muted">
                  Vendo <span className="font-medium text-ink">{vendo.name}</span> como dono. Escolha uma das suas empresas para voltar.
                </p>
              )}
              {!itens.length && <p className="px-3.5 py-6 text-center text-[13px] text-muted">Nada encontrado.</p>}
              {grupos.map((g) => (
                <div key={g.titulo} className="pb-1">
                  <p className="px-3.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">{g.titulo}</p>
                  {g.itens.map((it) => {
                    i += 1;
                    const idx = i;
                    const marcado = it.kind === 'membro' ? it.m.current && !vendo : vendo?.tenantId === it.tenantId;
                    return (
                      <button key={it.key} type="button" data-i={idx} disabled={busy} onMouseEnter={() => setSel(idx)} onClick={() => void escolher(it)}
                        className={cn('flex w-full items-center gap-2.5 px-3.5 py-2 text-left', idx === sel ? 'bg-field' : 'hover:bg-field')}>
                        <span className="text-muted shrink-0">{it.kind === 'membro' ? (it.m.tenantId ? <Building2 size={14} /> : <KeyRound size={14} />) : <Eye size={14} />}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[13px] text-ink">{it.label}</span>
                          <span className="block truncate text-[11.5px] text-muted">{it.hint}</span>
                        </span>
                        {marcado && <Check size={14} className="text-accent shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
