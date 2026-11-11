'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Building2, ShieldCheck, Wand2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useDepartments, useMe, useNumbers, useProfiles, useUpdateAgent, type Agent, type NumberItem } from '@/lib/hooks';
import { useCompanyScope } from './NumberScope';
import { AccessGrid, type AccessState } from './AccessGrid';

/**
 * Tela ÚNICA de acesso da pessoa (docs/18-perfis-de-acesso.md#tela-de-acesso). Antes a delegação
 * ficava em três lugares (perfil na Equipe, números num modal, departamentos em Configurações e
 * "quem recebe" em Números) e confundia. Aqui fica tudo:
 * - perfil = o que ela PODE FAZER;
 * - números = o que ela VÊ, onde a tela ABRE FILTRADA e de onde RECEBE automaticamente;
 * - departamentos = os setores dela (vê os do setor + os sem setor; se vê todas, também os setores abaixo).
 * Quem autoriza continua sendo a API.
 */
export function AccessModal({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const me = useMe();
  const numbers = useNumbers();
  const departments = useDepartments();
  const profiles = useProfiles();
  const update = useUpdateAgent();
  const { minhas, permitidos } = useCompanyScope(agent.id);
  const ehAdminAlvo = agent.role === 'tenant_admin';
  // "quem recebe" e reservar são da hierarquia da conta: só o admin (a API recusa os demais)
  const souAdmin = me.data?.role === 'tenant_admin' || !!me.data?.impersonatorId;

  const [carregado, setCarregado] = useState('');
  const [profileId, setProfileId] = useState('');
  const [acesso, setAcesso] = useState<AccessState>({ todos: true, ve: [], padrao: [], recebe: [], deptos: [] });
  const { todos, ve, padrao, deptos, recebe } = acesso;
  const lista = (numbers.data ?? []).filter((n) => !permitidos || permitidos.has(n.id));

  /** a pessoa enxerga o número com a marcação atual? (mesma regra da API) */
  const vendo = (n: NumberItem, marcados = ve, tudo = todos) => (tudo ? ehAdminAlvo || !n.reserved : marcados.includes(n.id));

  if (open && carregado !== agent.id && numbers.data) {
    const marcados = (agent.numbers ?? []).map((x) => x.numberId);
    setCarregado(agent.id);
    setProfileId(agent.profile?.id ?? '');
    setAcesso({
      todos: !marcados.length,
      ve: marcados,
      padrao: agent.defaultNumberIds ?? [],
      deptos: (agent.departments ?? []).map((d) => d.departmentId),
      // recebe: número sem lista = todos que veem; com lista = só quem está nela
      recebe: numbers.data.filter((n) => (!n.receiverIds?.length || n.receiverIds.includes(agent.id)) && vendo(n, marcados, !marcados.length)).map((n) => n.id),
    });
  }
  if (!open && carregado) setCarregado('');

  const perfilAtual = profiles.data?.find((p) => p.id === profileId);
  const veTodas = !!perfilAtual?.permissions.includes('conversations.view_all') || ehAdminAlvo;
  const perfisEscolhiveis = (profiles.data ?? []).filter((p) => p.systemRole !== 'tenant_admin' && (me.data?.role === 'super_admin' || p.permissions.every((x) => me.data?.permissions?.includes(x))));

  /** Atalho: vê todos os números (inclusive reservados), sem departamento, perfil que vê todas as conversas. */
  function acessoTotal() {
    setAcesso({ ...acesso, todos: false, ve: lista.map((n) => n.id), deptos: [] });
    const total = perfisEscolhiveis.find((p) => p.permissions.includes('conversations.view_all') && /gerente|gest|diretor|admin/i.test(p.name)) ?? perfisEscolhiveis.find((p) => p.permissions.includes('conversations.view_all'));
    if (total && !ehAdminAlvo) setProfileId(total.id);
    toast.ok('Marcado como acesso total. Confira e salve.');
  }

  /** Copia o acesso padrão do perfil escolhido (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil). */
  const modelo = perfilAtual?.accessTemplate ?? null;
  function aplicarModelo() {
    if (!modelo) return;
    const ves = modelo.allNumbers ? lista.filter((n) => !n.reserved).map((n) => n.id) : modelo.numberIds;
    setAcesso({
      todos: modelo.allNumbers,
      ve: modelo.allNumbers ? [] : modelo.numberIds,
      padrao: modelo.defaultNumberIds,
      deptos: modelo.departmentIds,
      recebe: souAdmin ? (modelo.receiveAll ? ves : modelo.receiveNumberIds) : recebe,
    });
    toast.ok('Acesso padrão do perfil aplicado. Confira e salve.');
  }

  async function salvar() {
    const vistos = lista.filter((n) => vendo(n)).map((n) => n.id);
    try {
      await update.mutateAsync({
        id: agent.id,
        defaultNumberIds: padrao.filter((id) => vistos.includes(id)),
        ...(!ehAdminAlvo && {
          ...(profileId !== (agent.profile?.id ?? '') && { profileId }),
          numberIds: todos ? [] : ve,
          departmentIds: deptos,
          ...(souAdmin && { receiveNumberIds: recebe.filter((id) => vistos.includes(id)) }),
        }),
      });
      toast.ok('Acesso atualizado');
      onClose();
    } catch (err) { toast.err(err); }
  }

  const resumoNumeros = todos ? (lista.some((n) => n.reserved) && !ehAdminAlvo ? 'todos os números, menos os reservados' : 'todos os números') : `${ve.length} número(s)`;
  const resumoDeptos = deptos.length ? (departments.data ?? []).filter((d) => deptos.includes(d.id)).map((d) => d.name).join(', ') : 'nenhum (vê todos os setores)';

  return (
    <Modal open={open} onClose={onClose} title={`Acesso de ${agent.name}`} width="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent-ink">
          {ehAdminAlvo
            ? <><b>Administrador da conta:</b> acesso total a tudo, inclusive números reservados. Aqui só dá para escolher onde as conversas dele abrem filtradas.</>
            : <>Pode fazer o que o perfil <b>{perfilAtual?.name ?? 'padrão do papel'}</b> permite · vê <b>{resumoNumeros}</b> · departamentos: <b>{resumoDeptos}</b>{veTodas ? (deptos.length ? ' · como gestor, vê também os setores abaixo dos dela' : ' · vê as conversas de todos os setores') : ''}.</>}
        </div>

        {minhas.length > 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><Building2 size={13} /> Empresas: {minhas.map((c) => c.name).join(', ')} — só os números delas aparecem (mude em <Link href="/configuracoes#empresa" className="underline">Configurações → Empresas</Link>).</p>
        )}

        {!ehAdminAlvo && (
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">1. O que pode fazer</h3>
              <Button size="sm" variant="ghost" icon={<ShieldCheck size={14} />} onClick={acessoTotal}>Acesso total</Button>
            </div>
            <select className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">Padrão do papel</option>
              {perfisEscolhiveis.map((p) => <option key={p.id} value={p.id}>{p.name}{p.permissions.includes('conversations.view_all') ? ' · vê todas as conversas' : ''}</option>)}
            </select>
            <p className="text-[12px] text-muted">O perfil é a lista de ações (encerrar, transferir, ver relatórios…). Os perfis são criados mais abaixo nesta página, em <b>Perfis de acesso</b>.</p>
          </section>
        )}

        {!ehAdminAlvo && modelo && profileId !== (agent.profile?.id ?? '') && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/50 px-3 py-2 text-[12.5px] text-ink">
            <Wand2 size={14} className="text-accent-ink shrink-0" />
            <span className="min-w-0 flex-1">O perfil <b>{perfilAtual?.name}</b> tem acesso padrão (números e departamentos).</span>
            <Button size="sm" variant="ghost" onClick={aplicarModelo}>Aplicar</Button>
          </div>
        )}

        <h3 className="text-sm font-semibold text-ink">{ehAdminAlvo ? 'Números' : '2. Números e departamentos'}</h3>
        <AccessGrid numbers={lista} departments={departments.data ?? []} value={acesso} onChange={setAcesso} admin={ehAdminAlvo} canReceive={souAdmin} viewAll={veTodas} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} loading={update.isPending}>Salvar acesso</Button>
        </div>
      </div>
    </Modal>
  );
}
