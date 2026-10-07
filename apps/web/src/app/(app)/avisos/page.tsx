'use client';
import { useState } from 'react';
import { Megaphone, Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useAdminNotices, useCreateNotice, useMe, useToggleNotice, type SystemNoticeType } from '@/lib/hooks';

const TIPOS: { id: SystemNoticeType; label: string; cls: string }[] = [
  { id: 'INFO', label: 'Informação', cls: 'border-accent text-accent-ink bg-accent-soft' },
  { id: 'WARNING', label: 'Atenção', cls: 'border-warn text-warn-ink bg-warn-soft' },
  { id: 'CRITICAL', label: 'Crítico', cls: 'border-danger text-danger-ink bg-danger-soft' },
];

/**
 * Avisos globais (docs/avisos.md). Publicar manda para todo cliente logado na hora (popup no
 * topo) e deixa no sino enquanto ativo. Só super_admin (a API também bloqueia).
 */
export default function AvisosPage() {
  const me = useMe();
  const notices = useAdminNotices();
  const create = useCreateNotice();
  const toggle = useToggleNotice();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<SystemNoticeType>('INFO');

  if (me.data && me.data.role !== 'super_admin') {
    return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;
  }

  async function publicar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({ title: title.trim(), message: message.trim(), type });
      toast.ok('Aviso enviado a todos os clientes conectados');
      setTitle(''); setMessage(''); setType('INFO');
    } catch (err) { toast.err(err); }
  }

  return (
    <PageShell width="max-w-3xl">
      <PageHeader title="Avisos do sistema" subtitle="Manutenção, instabilidade, novidades — aparece para todos os clientes." />

      <form onSubmit={publicar} className="rounded-2xl border border-line bg-panel p-4 space-y-3">
        <Field label="Tipo">
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button key={t.id} type="button" onClick={() => setType(t.id)} className={cn('rounded-lg border px-3 py-1.5 text-[13px] font-medium', type === t.id ? t.cls : 'border-line text-muted hover:bg-field')}>{t.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Título">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Manutenção programada" />
        </Field>
        <Field label="Mensagem">
          <textarea className={`${inputCls} resize-none`} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} required placeholder="Hoje às 23h o sistema ficará indisponível por cerca de 10 minutos." />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={create.isPending} loadingText="Enviando…" disabled={!title.trim() || !message.trim()}>Publicar aviso</Button>
        </div>
      </form>

      {notices.isLoading ? <SkeletonRows /> : !notices.data?.length ? (
        <Empty icon={<Megaphone size={28} />} title="Nenhum aviso publicado" text="Os avisos enviados aparecem aqui." />
      ) : (
        <div className="rounded-2xl border border-line bg-panel divide-y divide-line">
          {notices.data.map((n) => {
            const tipo = TIPOS.find((t) => t.id === n.type) ?? TIPOS[0];
            return (
              <div key={n.id} className={cn('px-4 py-3 flex items-start gap-3', !n.active && 'opacity-60')}>
                <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tipo.cls)}>{tipo.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  <p className="text-[13px] text-muted whitespace-pre-line break-words">{n.message}</p>
                  <p className="text-[11px] text-faint mt-0.5">{new Date(n.createdAt).toLocaleString('pt-BR')}{!n.active && ' · desativado'}</p>
                </div>
                <button
                  type="button"
                  title={n.active ? 'Desativar (sai do sino de todos)' : 'Reativar'}
                  onClick={() => toggle.mutate({ id: n.id, active: !n.active }, { onError: toast.err })}
                  className="shrink-0 p-2 rounded-lg text-muted hover:text-ink hover:bg-field"
                >
                  <Power size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
