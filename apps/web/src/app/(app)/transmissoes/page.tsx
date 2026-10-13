'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Send, Pause, Play, XCircle, Lock, AlertTriangle, QrCode, BadgeCheck, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { NewCampaignModal } from '@/components/transmissoes/NewCampaignModal';
import { QrRiskModal } from '@/components/transmissoes/QrRiskModal';
import { useCampaigns, useCampaign, useCampaignStatus, useStartCampaign, useHasFeature, useCan, useOutcomeLabels, type Campaign, type CampaignStatus } from '@/lib/hooks';

const STATUS: Record<CampaignStatus, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-field text-muted' },
  scheduled: { label: 'Pendente', cls: 'bg-accent-soft text-accent-ink' },
  running: { label: 'Em andamento', cls: 'bg-ok-soft text-ok' },
  paused: { label: 'Pausado', cls: 'bg-warn-soft text-warn-ink' },
  done: { label: 'Concluído', cls: 'bg-field text-ink' },
  canceled: { label: 'Cancelado', cls: 'bg-danger-soft text-danger' },
};

/**
 * Transmissões (envio em massa) — docs/envio.md#transmissão. Lista com progresso ao vivo (o
 * socket `campaign` atualiza a cada lote) e os controles: iniciar, pausar, retomar, cancelar.
 */
export default function TransmissoesPage() {
  const feature = useHasFeature('campaigns');
  const pode = useCan('campaigns.manage');
  const campaigns = useCampaigns();
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  if (!pode) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui transmissões.</p></PageShell>;
  if (!feature.loading && !feature.has) {
    return (
      <PageShell width="max-w-3xl">
        <PageHeader title="Transmissões" />
        <div className="rounded-2xl border border-line bg-panel p-8 text-center space-y-2">
          <div className="mx-auto w-10 h-10 rounded-xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={18} /></div>
          <p className="text-sm font-semibold text-ink">Transmissão em massa</p>
          <p className="text-xs text-muted">Não está incluída no seu plano.</p>
          <Link href="/plano" className="text-xs text-accent-ink underline">Ver planos</Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Transmissões"
        subtitle="Mensagem para muitos contatos de uma vez, com o público montado pelas tags, encerramentos e atendente."
        action={<Button icon={<Plus size={16} />} onClick={() => setNova(true)}>Nova transmissão</Button>}
      />

      {campaigns.isLoading && <SkeletonRows rows={3} />}
      {campaigns.data?.length === 0 && <Empty icon={<Send size={36} />} title="Nenhuma transmissão" text='Ex.: mandar uma oferta para quem "Não comprou" por "Achou caro" nos últimos 30 dias.' />}

      <div className="space-y-3">
        {campaigns.data?.map((c) => <CampaignCard key={c.id} c={c} onOpen={() => setAberta(c.id)} />)}
      </div>

      {nova && <NewCampaignModal onClose={() => setNova(false)} />}
      {aberta && <CampaignDetailModal id={aberta} onClose={() => setAberta(null)} />}
    </PageShell>
  );
}

/** Progresso: processados (enviados + falhas + ignorados) sobre o total. */
function Progresso({ c }: { c: Campaign }) {
  const s = c.stats;
  const feitos = s.total - s.pending;
  const pct = s.total ? Math.round((feitos / s.total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-field overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', c.status === 'paused' ? 'bg-warn' : c.status === 'canceled' ? 'bg-danger' : 'bg-ok')} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted tnum">
        <span><b className="text-ink">{feitos}</b> de {s.total} ({pct}%)</span>
        <span>Enviados <b className="text-ink">{s.sent}</b></span>
        <span>Entregues <b className="text-ink">{s.delivered}</b></span>
        <span>Lidos <b className="text-ink">{s.read}</b></span>
        {s.failed > 0 && <span className="text-danger">Falhas <b>{s.failed}</b></span>}
        {s.skipped > 0 && <span>Ignorados <b className="text-ink">{s.skipped}</b></span>}
      </div>
    </div>
  );
}

function Controles({ c }: { c: Campaign }) {
  const status = useCampaignStatus();
  const start = useStartCampaign();
  const [cancelando, setCancelando] = useState(false);
  const [risco, setRisco] = useState(false);
  const qr = c.number.provider !== 'meta';
  const iniciar = (acceptRisk?: boolean) => start.mutateAsync({ id: c.id, acceptRisk }).then(() => toast.ok('Transmissão iniciada')).catch(toast.err);
  const mudar = (s: 'paused' | 'running' | 'canceled', ok: string) => status.mutateAsync({ id: c.id, status: s }).then(() => toast.ok(ok)).catch(toast.err);
  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {c.status === 'draft' && <Button size="sm" icon={<Play size={13} />} loading={start.isPending} onClick={() => (qr && !c.riskAcceptedAt ? setRisco(true) : void iniciar())}>Iniciar</Button>}
      {(c.status === 'running' || c.status === 'scheduled') && <Button size="sm" variant="ghost" icon={<Pause size={13} />} loading={status.isPending} onClick={() => void mudar('paused', 'Transmissão pausada')}>Pausar</Button>}
      {c.status === 'paused' && <Button size="sm" icon={<Play size={13} />} loading={status.isPending} onClick={() => void mudar('running', 'Transmissão retomada')}>Retomar</Button>}
      {!['done', 'canceled'].includes(c.status) && <Button size="sm" variant="ghost" className="text-danger" icon={<XCircle size={13} />} onClick={() => setCancelando(true)}>Cancelar</Button>}
      <ConfirmDialog open={cancelando} onClose={() => setCancelando(false)} title="Cancelar transmissão" danger confirmLabel="Cancelar transmissão"
        text={`Os ${c.stats.pending} contato(s) que ainda não receberam não vão receber. O que já saiu não volta. Não dá para desfazer.`}
        onConfirm={async () => { await mudar('canceled', 'Transmissão cancelada'); }} />
      {risco && <QrRiskModal onClose={() => setRisco(false)} onAccept={() => { setRisco(false); void iniciar(true); }} />}
    </div>
  );
}

function CampaignCard({ c, onOpen }: { c: Campaign; onOpen: () => void }) {
  const st = STATUS[c.status];
  const qr = c.number.provider !== 'meta';
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()} className="rounded-2xl bg-panel border border-line p-4 space-y-3 cursor-pointer hover:border-muted/50">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink truncate">{c.name}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', st.cls)}>{st.label}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1">{qr ? <QrCode size={12} /> : <BadgeCheck size={12} />}{c.number.label} · {qr ? 'QR Code' : 'API oficial'}</span>
            {c.startAt && c.status === 'scheduled' && <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{new Date(c.startAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
            <span>Criada {new Date(c.createdAt).toLocaleDateString('pt-BR')}</span>
          </div>
        </div>
        <Controles c={c} />
      </div>
      {c.pauseReason && c.status === 'paused' && (
        <p className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink"><AlertTriangle size={14} className="shrink-0 mt-0.5" />Parou sozinha: {c.pauseReason}</p>
      )}
      <Progresso c={c} />
    </div>
  );
}

const AUDIENCIA = (c: Campaign, labels: { won: string; lost: string }) => {
  const a = c.audience;
  if (!a) return '—';
  const partes: string[] = [];
  if (a.all) partes.push('Todos os contatos');
  if (a.tagIds?.length) partes.push(`${a.tagIds.length} tag(s) atuais`);
  if (a.closingTagIds?.length) partes.push(`${a.closingTagIds.length} tag(s) de encerramento`);
  if (a.lastOutcome) partes.push(`último atendimento: ${labels[a.lastOutcome]}`);
  if (a.closingFrom && a.closingTo) partes.push(`${new Date(a.closingFrom).toLocaleDateString('pt-BR')} a ${new Date(new Date(a.closingTo).getTime() - 86_400_000).toLocaleDateString('pt-BR')}`);
  if (a.agentId) partes.push('atendente filtrado');
  if (a.phones?.length) partes.push(`${a.phones.length} telefone(s) colados`);
  return partes.join(' · ') || '—';
};

function CampaignDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCampaign(id);
  const labels = useOutcomeLabels();
  const c = q.data;
  return (
    <Modal open onClose={onClose} title={c?.name ?? 'Transmissão'} width="max-w-2xl">
      {!c ? <SkeletonRows rows={3} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[c.status].cls)}>{STATUS[c.status].label}</span>
            <span className="text-[12.5px] text-muted">{c.number.label} · {c.number.provider === 'meta' ? 'API oficial' : 'QR Code'}</span>
            <span className="flex-1" />
            <Controles c={c} />
          </div>
          {c.pauseReason && c.status === 'paused' && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">Parou sozinha: {c.pauseReason}</p>}
          <Progresso c={c} />
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 text-[12.5px]">
            <div><dt className="text-faint">Público</dt><dd className="text-ink">{AUDIENCIA(c, labels)}</dd></div>
            <div><dt className="text-faint">Mensagem</dt><dd className="text-ink">{c.template ? `Template “${c.template.name}”` : (c.text || (c.mediaName ? `Anexo: ${c.mediaName}` : '—'))}</dd></div>
            {c.daily.limit != null && <div><dt className="text-faint">Teto do número (24h)</dt><dd className="text-ink tnum">{c.daily.sent} de {c.daily.limit}</dd></div>}
            <div><dt className="text-faint">Regras</dt><dd className="text-ink">{c.number.provider === 'meta' ? 'Template aprovado · lotes no ritmo do número' : '20–60 s entre mensagens · horário de funcionamento · pausa em 3 falhas'}</dd></div>
            {c.riskAcceptedAt && <div><dt className="text-faint">Aviso de risco aceito</dt><dd className="text-ink">{new Date(c.riskAcceptedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</dd></div>}
          </dl>
          {c.problemas.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium text-ink">Não receberam</h3>
              <ul className="max-h-56 overflow-y-auto divide-y divide-line rounded-lg border border-line text-[12.5px]">
                {c.problemas.map((p, i) => (
                  <li key={i} className="flex gap-3 px-3 py-1.5">
                    <span className="text-ink truncate w-40 shrink-0">{p.contato}</span>
                    <span className={cn('shrink-0', p.status === 'failed' ? 'text-danger' : 'text-muted')}>{p.status === 'failed' ? 'Falhou' : 'Ignorado'}</span>
                    <span className="text-muted truncate">{p.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
