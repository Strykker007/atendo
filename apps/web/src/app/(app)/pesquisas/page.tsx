'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, Pencil, Plus, Power, ShieldCheck, Star, ThumbsUp, Trash2 } from 'lucide-react';
import { SURVEY_DEFAULTS, SURVEY_EXTRA_QUESTIONS_MAX, SURVEY_SCALE_LABEL, SURVEY_SCALES, surveyInteractive, surveyPromptText, type SurveyExtraQuestion, type SurveyScale } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Empty, PageHeader, PageShell } from '@/components/ui/Page';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { FeatureLocked } from '@/components/billing/FeatureLocked';
import { TextWithVars, type FlowVar } from '@/components/flows/TextWithVars';
import { useCan, useHasFeature, useCreateSurvey, useSurveys, useUpdateSurvey, type SatisfactionSurvey, type SurveyInput } from '@/lib/hooks';

/** Além das do sistema e dos campos da ficha (que o TextWithVars já traz): quem atendeu. */
const SURVEY_VARS: FlowVar[] = [
  { key: 'agent.name', label: 'Nome de quem atendeu', source: 'system' },
  { key: 'agent.name | first', label: 'Primeiro nome de quem atendeu', source: 'system' },
];

/** Prévia com valores de exemplo no lugar das variáveis mais comuns. */
const EXEMPLO: Record<string, string> = { 'contact.first_name': 'Maria', 'contact.name': 'Maria Souza', 'agent.name': 'Ana Lima', 'agent.name | first': 'Ana', 'company.name': 'sua empresa' };
const comExemplo = (t: string) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k: string) => EXEMPLO[k.replace(/\s*\|\s*/g, ' | ')] ?? m);

const ESCALA_DICA: Record<SurveyScale, string> = {
  scale_5: 'O cliente digita uma nota de 1 a 5.',
  scale_10: 'O cliente digita de 1 a 10. O relatório calcula o NPS.',
  csat_3: 'O cliente toca em Ruim, Neutro ou Bom.',
};

/**
 * Pesquisas de satisfação (docs/pesquisa-de-satisfacao.md): sai ao encerrar o atendimento, com
 * recusa em um toque ("0" ou "Não responder") e sem insistência. A padrão vem marcada no modal
 * de encerramento.
 */
export default function SurveysPage() {
  const pode = useCan('settings.manage');
  const feature = useHasFeature('satisfaction_surveys');
  const surveys = useSurveys(feature.has);
  const update = useUpdateSurvey();
  const [editando, setEditando] = useState<SatisfactionSurvey | 'nova' | null>(null);

  const alternar = (s: SatisfactionSurvey, patch: SurveyInput, msg: string) =>
    update.mutateAsync({ id: s.id, ...patch }).then(() => toast.ok(msg), toast.err);

  if (!feature.loading && !feature.has) return <FeatureLocked title="Pesquisas de satisfação" text="Pergunte ao cliente como foi o atendimento logo depois de encerrar e acompanhe a nota de cada consultor (CSAT/NPS)." />;

  return (
    <PageShell>
      <PageHeader
        title="Pesquisas de satisfação"
        subtitle="Enviadas ao encerrar o atendimento. O cliente pode recusar com um toque e nunca recebe a pergunta de novo."
        action={
          <div className="flex gap-2">
            <Link href="/relatorios/satisfacao" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><BarChart3 size={15} className="text-accent" /> Relatório</Link>
            {pode && <Button icon={<Plus size={15} />} onClick={() => setEditando('nova')}>Nova pesquisa</Button>}
          </div>
        }
      />

      {surveys.isLoading && <SkeletonRows rows={3} />}
      {surveys.data?.length === 0 && <Empty icon={<ThumbsUp size={28} />} title="Nenhuma pesquisa ainda" text="Crie uma pesquisa e ela passa a sair no encerramento dos atendimentos." />}

      <div className="space-y-2">
        {surveys.data?.map((s) => (
          <div key={s.id} className={cn('rounded-2xl border border-line bg-panel p-4 flex flex-wrap items-start gap-3', !s.isActive && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-[11px] rounded-full border border-line px-2 py-0.5 text-muted">{SURVEY_SCALE_LABEL[s.scale]}</span>
                {s.isDefault && <span className="text-[11px] rounded-full bg-accent-soft text-accent-ink px-2 py-0.5 font-semibold inline-flex items-center gap-1"><Star size={11} /> Padrão no encerramento</span>}
                {!s.isActive && <span className="text-[11px] rounded-full bg-field px-2 py-0.5 text-muted">Desativada</span>}
              </div>
              <p className="mt-1 text-[13px] text-muted line-clamp-2 whitespace-pre-line">{s.question}</p>
              <p className="mt-1 text-[11px] text-faint">
                {1 + (s.extraQuestions?.length ?? 0)} pergunta{s.extraQuestions?.length ? 's' : ''} · {s.allowDecline ? 'pode recusar' : 'sem opção de recusa'} · {s.askComment ? 'pede comentário' : 'sem comentário'} · espera {s.expiresHours} h
              </p>
            </div>
            {pode && (
              <div className="flex flex-wrap gap-1.5">
                {s.isActive && !s.isDefault && <Button size="sm" variant="ghost" icon={<Star size={13} />} onClick={() => alternar(s, { isDefault: true }, 'Agora é a pesquisa padrão')}>Tornar padrão</Button>}
                {s.isActive && s.isDefault && <Button size="sm" variant="ghost" onClick={() => alternar(s, { isDefault: false }, 'Não sai mais marcada no encerramento')}>Tirar padrão</Button>}
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditando(s)}>Editar</Button>
                <Button size="sm" variant={s.isActive ? 'subtle' : 'ghost'} icon={<Power size={13} />} onClick={() => alternar(s, { isActive: !s.isActive }, s.isActive ? 'Pesquisa desativada' : 'Pesquisa reativada')}>{s.isActive ? 'Desativar' : 'Reativar'}</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editando && <SurveyEditor survey={editando === 'nova' ? null : editando} onClose={() => setEditando(null)} />}
    </PageShell>
  );
}

function SurveyEditor({ survey, onClose }: { survey: SatisfactionSurvey | null; onClose: () => void }) {
  const create = useCreateSurvey();
  const update = useUpdateSurvey();
  const [f, setF] = useState(() => ({
    name: survey?.name ?? 'Pesquisa de satisfação',
    scale: survey?.scale ?? ('scale_5' as SurveyScale),
    question: survey?.question ?? SURVEY_DEFAULTS.question,
    allowDecline: survey?.allowDecline ?? true,
    declineLabel: survey?.declineLabel ?? SURVEY_DEFAULTS.declineLabel,
    askComment: survey?.askComment ?? true,
    extraQuestions: survey?.extraQuestions ?? ([] as SurveyExtraQuestion[]),
    commentPrompt: survey ? survey.commentPrompt ?? '' : SURVEY_DEFAULTS.commentPrompt,
    thanksMessage: survey ? survey.thanksMessage ?? '' : SURVEY_DEFAULTS.thanksMessage,
    declinedMessage: survey ? survey.declinedMessage ?? '' : SURVEY_DEFAULTS.declinedMessage,
    expiresHours: survey?.expiresHours ?? SURVEY_DEFAULTS.expiresHours,
    isDefault: survey?.isDefault ?? false,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const mudarExtra = (i: number, patch: Partial<SurveyExtraQuestion>) => set('extraQuestions', f.extraQuestions.map((q, n) => (n === i ? { ...q, ...patch } : q)));
  const novaExtra = () => set('extraQuestions', [...f.extraQuestions, { id: `q${Date.now().toString(36)}`, text: '', scale: 'scale_5' }]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.question.trim()) return toast.warn('Preencha o nome e a pergunta.');
    if (f.extraQuestions.some((q) => !q.text.trim())) return toast.warn('Escreva o texto de cada pergunta adicional (ou remova a vazia).');
    try {
      if (survey) await update.mutateAsync({ id: survey.id, ...f });
      else await create.mutateAsync(f);
      toast.ok('Pesquisa salva');
      onClose();
    } catch (err) { toast.err(err); }
  }

  const preview = surveyPromptText(f);
  const botoes = surveyInteractive(f)?.options ?? [];

  return (
    <Modal open onClose={onClose} title={survey ? 'Editar pesquisa' : 'Nova pesquisa'} width="max-w-3xl">
      <form onSubmit={salvar} className="grid gap-5 md:grid-cols-[1fr_17rem]">
        <div className="space-y-3">
          <Field label="Nome (só a equipe vê)">
            <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Escala" hint={ESCALA_DICA[f.scale]}>
            <div className="grid grid-cols-3 gap-1.5">
              {SURVEY_SCALES.map((sc) => (
                <button key={sc} type="button" aria-pressed={f.scale === sc} onClick={() => set('scale', sc)}
                  className={cn('rounded-lg border px-2 py-2 text-[12.5px] font-medium', f.scale === sc ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>
                  {SURVEY_SCALE_LABEL[sc]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Pergunta" hint="A instrução de como responder é acrescentada sozinha.">
            <TextWithVars value={f.question} onChange={(v) => set('question', v)} vars={SURVEY_VARS} flowVarsGroup={false} formatting maxLength={1000} className="min-h-20 resize-none" />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Perguntas adicionais <span className="text-[11px] font-normal text-faint">opcional, até {SURVEY_EXTRA_QUESTIONS_MAX}</span></span>
              {f.extraQuestions.length < SURVEY_EXTRA_QUESTIONS_MAX && <button type="button" onClick={novaExtra} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"><Plus size={13} /> Pergunta</button>}
            </div>
            {f.extraQuestions.map((q, i) => (
              <div key={q.id} className="rounded-lg border border-line p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-muted">{i + 2}ª pergunta</span>
                  <select className={cn(inputCls, 'py-1 text-[12px] w-auto ml-auto')} value={q.scale} onChange={(e) => mudarExtra(i, { scale: e.target.value as SurveyScale })} aria-label="Escala">
                    {SURVEY_SCALES.map((sc) => <option key={sc} value={sc}>{SURVEY_SCALE_LABEL[sc]}</option>)}
                  </select>
                  <button type="button" onClick={() => set('extraQuestions', f.extraQuestions.filter((_, n) => n !== i))} className="w-7 h-7 grid place-items-center rounded-lg text-muted hover:text-danger hover:bg-field" aria-label="Remover pergunta"><Trash2 size={13} /></button>
                </div>
                <TextWithVars value={q.text} onChange={(v) => mudarExtra(i, { text: v })} vars={SURVEY_VARS} flowVarsGroup={false} formatting maxLength={1000} className="min-h-16 resize-none" placeholder="Ex.: E o tempo de resposta, como foi?" />
              </div>
            ))}
            {f.extraQuestions.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11.5px] text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-ok" /> Uma pergunta por vez, só depois que o cliente responder a anterior. Cada mensagem passa pela fila do número, com o mesmo intervalo e limites anti-bloqueio das outras automações.</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={f.allowDecline} onChange={(e) => set('allowDecline', e.target.checked)} />
            <span><b className="font-medium text-ink">Permitir recusar</b><span className="block text-xs text-muted">O cliente digita 0 {f.scale === 'csat_3' ? 'ou toca no botão ' : ''}e a pesquisa termina na hora, sem insistir.</span></span>
          </label>
          {f.allowDecline && (
            <div className="grid gap-3 sm:grid-cols-2 pl-6">
              {f.scale === 'csat_3' && (
                <Field label="Texto do botão de recusa">
                  <input className={inputCls} value={f.declineLabel} onChange={(e) => set('declineLabel', e.target.value)} maxLength={20} />
                </Field>
              )}
              <Field label="Resposta à recusa" hint="Vazio = não responde nada.">
                <TextWithVars multiline={false} value={f.declinedMessage} onChange={(v) => set('declinedMessage', v)} vars={SURVEY_VARS} flowVarsGroup={false} maxLength={1000} />
              </Field>
            </div>
          )}

          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={f.askComment} onChange={(e) => set('askComment', e.target.checked)} />
            <span><b className="font-medium text-ink">Pedir um comentário depois da nota</b><span className="block text-xs text-muted">Opcional para o cliente: “0” ou “não” pula.</span></span>
          </label>
          {f.askComment && (
            <div className="pl-6">
              <TextWithVars value={f.commentPrompt} onChange={(v) => set('commentPrompt', v)} vars={SURVEY_VARS} flowVarsGroup={false} formatting maxLength={1000} className="min-h-16 resize-none" />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="Agradecimento" hint="Vazio = não responde nada.">
              <TextWithVars multiline={false} value={f.thanksMessage} onChange={(v) => set('thanksMessage', v)} vars={SURVEY_VARS} flowVarsGroup={false} maxLength={1000} />
            </Field>
            <Field label="Espera (horas)" hint="Depois disso, a mensagem reabre o atendimento.">
              <input type="number" min={1} max={168} className={inputCls} value={f.expiresHours} onChange={(e) => set('expiresHours', Math.min(168, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={f.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
            <span className="text-ink">Vir marcada no encerramento (pesquisa padrão)</span>
          </label>
        </div>

        {/* prévia como o cliente vê */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">Prévia</div>
          <div className="rounded-xl bg-field p-3 space-y-1.5">
            <div className="rounded-lg rounded-tl-none bg-panel border border-line px-3 py-2 text-[13px] text-ink whitespace-pre-line">{comExemplo(preview).replace(/\*([^*]+)\*/g, '$1')}</div>
            {botoes.map((b) => <div key={b.id} className="rounded-lg bg-panel border border-line px-3 py-1.5 text-center text-[13px] font-medium text-accent">{b.title}</div>)}
            {f.extraQuestions.filter((q) => q.text.trim()).map((q, i) => {
              const cfg = { scale: q.scale, question: q.text, allowDecline: f.allowDecline, declineLabel: f.declineLabel };
              return (
                <div key={q.id} className="space-y-1.5 pt-1">
                  <div className="text-center text-[10.5px] text-faint">depois da resposta · {i + 2}ª pergunta</div>
                  <div className="rounded-lg rounded-tl-none bg-panel border border-line px-3 py-2 text-[13px] text-ink whitespace-pre-line">{comExemplo(surveyPromptText(cfg)).replace(/\*([^*]+)\*/g, '$1')}</div>
                  {(surveyInteractive(cfg)?.options ?? []).map((b) => <div key={b.id} className="rounded-lg bg-panel border border-line px-3 py-1.5 text-center text-[13px] font-medium text-accent">{b.title}</div>)}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-faint">Variáveis aparecem com valores de exemplo (Maria, Ana Lima).</p>
          <p className="text-[11px] text-faint">Nos números via QR Code os botões chegam como lista numerada; o número também vale como resposta.</p>
        </div>

        <div className="md:col-span-2 flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending || update.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
