'use client';
import { useState } from 'react';
import { Plus, KeyRound, Power, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Modal, Field, inputCls, btnPrimary, btnGhost } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useAgents, useCreateAgent, useUpdateAgent, useUsage, useMe, type Agent } from '@/lib/hooks';

export default function EquipePage() {
  const me = useMe();
  const isAdmin = me.data?.role !== 'agent';
  const agents = useAgents();
  const usage = useUsage();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Agent | null>(null);

  const max = usage.data?.limits?.maxAgents;
  const count = usage.data?.used.agents ?? 0;
  const full = max !== undefined && count >= max;

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Equipe"
        subtitle={<>Quem atende as conversas. {max !== undefined && <>Plano <b>{usage.data?.plan}</b>: {count}/{max} atendentes.</>}</>}
        action={isAdmin && <button onClick={() => setCreating(true)} disabled={full} className={btnPrimary} title={full ? 'Limite do plano atingido' : undefined}><Plus size={16} className="inline mr-1 -mt-0.5" /> Novo atendente</button>}
      />

      {full && <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">Limite de atendentes do plano atingido. Desative alguém ou faça upgrade em <b>Plano e uso</b>.</p>}

      {agents.isLoading && <SkeletonRows rows={3} />}
      {agents.data?.length === 0 && <Empty icon={<Users size={36} />} title="Nenhum usuário" text="Adicione atendentes para dividir o atendimento." />}

      {!!agents.data?.length && (
        <div className="rounded-2xl bg-white border border-surface-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-gray-500 uppercase tracking-wide">
              <tr><th className="px-5 py-2.5">Nome</th><th className="px-5 py-2.5 hidden sm:table-cell">E-mail</th><th className="px-5 py-2.5">Papel</th><th className="px-5 py-2.5 hidden md:table-cell">Último acesso</th><th className="px-5 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {agents.data.map((a) => (
                <tr key={a.id} className={cn(!a.isActive && 'opacity-50')}>
                  <td className="px-5 py-3 font-medium">{a.name}{a.id === me.data?.id && <span className="ml-2 text-xs text-gray-400">(você)</span>}</td>
                  <td className="px-5 py-3 text-gray-500 hidden sm:table-cell">{a.email}</td>
                  <td className="px-5 py-3"><span className={cn('text-xs rounded-full px-2 py-0.5', a.role === 'agent' ? 'bg-gray-100 text-gray-600' : 'bg-brand-soft text-brand')}>{a.role === 'agent' ? 'Atendente' : 'Admin'}</span></td>
                  <td className="px-5 py-3 text-gray-500 hidden md:table-cell">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('pt-BR') : 'nunca'}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {isAdmin && a.role === 'agent' && (
                      <>
                        <button onClick={() => setResetting(a)} className="text-gray-400 hover:text-gray-700 p-1" title="Redefinir senha"><KeyRound size={15} /></button>
                        <button onClick={() => update.mutateAsync({ id: a.id, isActive: !a.isActive }).then(() => toast.ok(a.isActive ? 'Atendente desativado' : 'Atendente ativado')).catch(toast.err)} className={cn('p-1', a.isActive ? 'text-gray-400 hover:text-red-600' : 'text-brand')} title={a.isActive ? 'Desativar' : 'Ativar'}><Power size={15} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateAgentModal open={creating} onClose={() => setCreating(false)} onSubmit={(b) => create.mutateAsync(b).then(() => { toast.ok('Atendente criado'); setCreating(false); }).catch(toast.err)} pending={create.isPending} />
      <ResetPasswordModal agent={resetting} onClose={() => setResetting(null)} onSubmit={(password) => resetting && update.mutateAsync({ id: resetting.id, password }).then(() => { toast.ok('Senha redefinida'); setResetting(null); }).catch(toast.err)} pending={update.isPending} />
    </PageShell>
  );
}

function CreateAgentModal({ open, onClose, onSubmit, pending }: { open: boolean; onClose: () => void; onSubmit: (b: { name: string; email: string; password: string }) => void; pending: boolean }) {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  return (
    <Modal open={open} onClose={onClose} title="Novo atendente" width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
        <Field label="Nome"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field label="E-mail"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Senha inicial" hint="Mínimo 8 caracteres. Envie ao atendente por um canal seguro."><input type="text" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} required /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={btnGhost}>Cancelar</button><button disabled={pending} className={btnPrimary}>Criar</button></div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ agent, onClose, onSubmit, pending }: { agent: Agent | null; onClose: () => void; onSubmit: (p: string) => void; pending: boolean }) {
  const [p, setP] = useState('');
  return (
    <Modal open={!!agent} onClose={onClose} title={`Redefinir senha · ${agent?.name ?? ''}`} width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(p); setP(''); }} className="space-y-4">
        <Field label="Nova senha" hint="As sessões ativas deste atendente serão encerradas."><input type="text" className={inputCls} value={p} onChange={(e) => setP(e.target.value)} minLength={8} required autoFocus /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={btnGhost}>Cancelar</button><button disabled={pending} className={btnPrimary}>Redefinir</button></div>
      </form>
    </Modal>
  );
}
