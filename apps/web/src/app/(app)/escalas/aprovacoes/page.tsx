'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Copy, KeyRound, ShieldCheck, TimerOff, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import {
  useCan, useCreateOverride, useCreateTemporaryUser, useExpireTemporaryUser, useRevokeOverride, useScheduleOverrides, useTeamShifts, useTemporaryUsers, useWorkSchedules,
  type TeamShift,
} from '@/lib/hooks';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const STATUS: Record<'ACTIVE' | 'EXPIRED' | 'INACTIVE', { label: string; cls: string }> = {
  ACTIVE: { label: 'Ativo', cls: 'bg-ok/15 text-ok' },
  EXPIRED: { label: 'Expirado', cls: 'bg-field text-muted' },
  INACTIVE: { label: 'Inativo', cls: 'bg-field text-muted' },
};

/**
 * Painel do gestor (docs/escalas.md): quem está no turno agora, liberação rápida de plantão
 * excepcional e acessos temporários para freelancers/substitutos.
 */
export default function AprovacoesPage() {
  const pode = useCan('team.manage');
  const equipe = useTeamShifts();
  const liberacoes = useScheduleOverrides();
  const temporarios = useTemporaryUsers();
  const revogar = useRevokeOverride();
  const expirar = useExpireTemporaryUser();
  const [autorizar, setAutorizar] = useState<TeamShift | true | null>(null);
  const [gerar, setGerar] = useState(false);

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<CalendarClock size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui gerenciar a equipe." /></PageShell>;

  const escalados = (equipe.data ?? []).filter((p) => !p.exempt);

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Escalas e plantões"
        subtitle={<>Libere quem precisa entrar fora da escala e gere acessos temporários. Os turnos são configurados em <Link href="/configuracoes/escalas" className="text-accent-ink hover:underline">Configurações → Escalas</Link>.</>}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setGerar(true)}><UserPlus size={14} /> Gerar acesso temporário</Button>
            <Button onClick={() => setAutorizar(true)}><ShieldCheck size={14} /> Autorizar plantão excepcional</Button>
          </div>
        }
      />

      <section className="rounded-2xl border border-line bg-panel">
        <h2 className="px-4 pt-4 pb-2 font-display font-semibold text-ink text-sm">Equipe com escala — agora</h2>
        {equipe.isLoading ? <div className="p-4"><SkeletonRows /></div> : !escalados.length ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Ninguém tem escala. Sem escala, ninguém é travado por horário.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {escalados.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className={cn('w-2 h-2 rounded-full shrink-0', p.onShift || p.override ? 'bg-ok' : 'bg-danger')} />
                <div className="flex-1 min-w-40">
                  <p className="text-sm text-ink truncate">{p.name}</p>
                  <p className="text-[12px] text-faint">
                    {p.schedule?.name} · {p.onShift ? 'no turno' : p.override ? `liberado até ${quando(p.override.validUntil)}` : 'fora da escala (login bloqueado)'}
                  </p>
                </div>
                {!p.onShift && !p.override && <Button size="sm" variant="ghost" onClick={() => setAutorizar(p)}><ShieldCheck size={13} /> Liberar</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel">
        <h2 className="px-4 pt-4 pb-2 font-display font-semibold text-ink text-sm">Liberações ativas</h2>
        {liberacoes.isLoading ? <div className="p-4"><SkeletonRows /></div> : !liberacoes.data?.length ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nenhuma liberação de plantão valendo.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {liberacoes.data.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-40">
                  <p className="text-sm text-ink truncate">{o.user.name}</p>
                  <p className="text-[12px] text-faint">
                    {quando(o.validFrom)} → {quando(o.validUntil)}{o.approvedBy ? ` · por ${o.approvedBy.name}` : ''}{o.reason ? ` · ${o.reason}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="subtle" loading={revogar.isPending && revogar.variables === o.id}
                  onClick={() => revogar.mutate(o.id, { onSuccess: () => toast.ok('Liberação encerrada.'), onError: (err) => toast.err(err) })}>Encerrar</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel">
        <h2 className="px-4 pt-4 pb-2 font-display font-semibold text-ink text-sm">Acessos temporários</h2>
        {temporarios.isLoading ? <div className="p-4"><SkeletonRows /></div> : !temporarios.data?.length ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nenhum acesso temporário gerado.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {temporarios.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-40">
                  <p className="text-sm text-ink truncate">{t.name} <span className={cn('ml-1 text-[11px] rounded px-1.5 py-0.5', STATUS[t.status].cls)}>{STATUS[t.status].label}</span></p>
                  <p className="text-[12px] text-faint truncate">
                    {t.email} · {t.status === 'ACTIVE' && t.accessExpiresAt ? `expira ${quando(t.accessExpiresAt)}` : t.expiredAt ? `expirou ${quando(t.expiredAt)}` : ''}
                    {t.temporaryCreatedBy ? ` · por ${t.temporaryCreatedBy.name}` : ''}
                  </p>
                </div>
                {t.status === 'ACTIVE' && (
                  <Button size="sm" variant="subtle" loading={expirar.isPending && expirar.variables === t.id}
                    onClick={() => expirar.mutate(t.id, { onSuccess: () => toast.ok('Acesso encerrado.'), onError: (err) => toast.err(err) })}><TimerOff size={13} /> Encerrar agora</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {autorizar && <OverrideModal pessoa={autorizar === true ? null : autorizar} equipe={escalados} onClose={() => setAutorizar(null)} />}
      {gerar && <TemporaryModal onClose={() => setGerar(false)} />}
    </PageShell>
  );
}

function OverrideModal({ pessoa, equipe, onClose }: { pessoa: TeamShift | null; equipe: TeamShift[]; onClose: () => void }) {
  const criar = useCreateOverride();
  const [userId, setUserId] = useState(pessoa?.id ?? '');
  const [hours, setHours] = useState(12);
  const [reason, setReason] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await criar.mutateAsync({ userId, hours, reason: reason.trim() || undefined });
      toast.ok(`Plantão liberado até ${quando(r.validUntil)}.`);
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Autorizar plantão excepcional">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Colaborador">
          <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Escolha…</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>{p.name}{p.schedule ? ` — ${p.schedule.name}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Liberar por (horas)" hint="A partir de agora. Máximo 72h.">
          <div className="flex flex-wrap gap-1.5">
            {[2, 4, 8, 12, 24].map((h) => (
              <button key={h} type="button" onClick={() => setHours(h)} className={cn('rounded-lg border px-3 py-1.5 text-xs', hours === h ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-field')}>{h}h</button>
            ))}
            <input type="number" min={1} max={72} className={cn(inputCls, 'w-24')} value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Horas" />
          </div>
        </Field>
        <Field label="Motivo (opcional)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ex.: cobrir falta da escala B" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={criar.isPending} disabled={!userId || hours < 1 || hours > 72}><ShieldCheck size={14} /> Liberar</Button>
        </div>
      </form>
    </Modal>
  );
}

function TemporaryModal({ onClose }: { onClose: () => void }) {
  const criar = useCreateTemporaryUser();
  const escalas = useWorkSchedules();
  const [name, setName] = useState('');
  const [hours, setHours] = useState(12);
  const [scheduleId, setScheduleId] = useState('');
  const [gerado, setGerado] = useState<{ name: string; email: string; password: string; accessExpiresAt: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setGerado(await criar.mutateAsync({ name: name.trim(), hours, scheduleId: scheduleId || undefined }));
    } catch (err) { toast.err(err); }
  }

  const copiar = (texto: string) => navigator.clipboard.writeText(texto).then(() => toast.ok('Copiado.'), () => toast.err('Não deu para copiar.'));

  if (gerado) {
    const texto = `Acesso temporário — ${gerado.name}\nLogin: ${gerado.email}\nSenha: ${gerado.password}\nVale até ${quando(gerado.accessExpiresAt)}`;
    return (
      <Modal open onClose={onClose} title="Acesso temporário gerado">
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft text-warn-ink px-3 py-2 text-[12.5px]">
            <KeyRound size={15} className="shrink-0 mt-0.5" />
            <span>Copie agora: a senha não aparece de novo. A conta expira sozinha em <b>{quando(gerado.accessExpiresAt)}</b> e não serve para outro dia.</span>
          </p>
          <pre className="rounded-lg border border-line bg-field p-3 text-sm whitespace-pre-wrap break-all">{texto}</pre>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => copiar(texto)}><Copy size={14} /> Copiar</Button>
            <Button onClick={onClose}>Concluir</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Gerar acesso temporário">
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-[12.5px] text-muted">Conta de atendente para freelancer ou substituto. O sistema gera login e senha; vencido o prazo, a conta expira automaticamente.</p>
        <Field label="Nome"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Maria (substituta)" required /></Field>
        <Field label="Validade do plantão (horas)" hint="Máximo 72h.">
          <div className="flex flex-wrap gap-1.5">
            {[6, 8, 12, 24].map((h) => (
              <button key={h} type="button" onClick={() => setHours(h)} className={cn('rounded-lg border px-3 py-1.5 text-xs', hours === h ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-field')}>{h}h</button>
            ))}
            <input type="number" min={1} max={72} className={cn(inputCls, 'w-24')} value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Horas" />
          </div>
        </Field>
        <Field label="Escala (opcional)" hint="Também trava o login fora do turno dentro da validade.">
          <select className={inputCls} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Sem escala — vale a validade inteira</option>
            {(escalas.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={criar.isPending} disabled={!name.trim() || hours < 1 || hours > 72}><UserPlus size={14} /> Gerar acesso</Button>
        </div>
      </form>
    </Modal>
  );
}
