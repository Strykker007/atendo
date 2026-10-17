'use client';
import { useEffect, useState } from 'react';
import { Paperclip, X, Users, UsersRound, ShieldAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { TagPicker } from '@/components/chat/TagPicker';
import { TemplateFields, useTemplateChoice } from '@/components/chat/TemplateFields';
import {
  uploadFile, mediaTypeOf, useAgents, useNumbers, useTags, useAudiencePreview, useCreateCampaign, useStartCampaign, useOutcomeLabels, useGroups,
  type CampaignAudience, type Upload,
} from '@/lib/hooks';
import { QrRiskModal } from './QrRiskModal';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PERIODOS = [7, 30, 90] as const;
const VARIAVEIS = [{ v: '{{contact.first_name}}', l: 'Primeiro nome' }, { v: '{{contact.name}}', l: 'Nome' }, { v: '{{saudacao}}', l: 'Bom dia/tarde/noite' }];

/** "um por linha, vírgula ou ;" → lista; o servidor normaliza (DDI 55 quando falta) */
const telefonesDe = (t: string) => t.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Nova transmissão. Público = filtros (E) + telefones colados (somam). A contagem atualiza
 * sozinha. QR Code: texto/anexo e o aviso de risco antes de iniciar. API oficial: só template.
 */
export function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const numbers = useNumbers();
  const tags = useTags();
  const labels = useOutcomeLabels();
  const agents = useAgents();
  const create = useCreateCampaign();
  const start = useStartCampaign();

  const [name, setName] = useState('');
  const [numberId, setNumberId] = useState('');
  const [text, setText] = useState('');
  const [anexo, setAnexo] = useState<Upload | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora');
  const [startAt, setStartAt] = useState('');

  // público
  const [todos, setTodos] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [closingTagIds, setClosingTagIds] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<number | 'custom'>(30);
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(iso(new Date()));
  const [lastOutcome, setLastOutcome] = useState<'' | 'won' | 'lost'>('');
  const [agentId, setAgentId] = useState('');
  const [telefones, setTelefones] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [riscoAberto, setRiscoAberto] = useState(false);

  const conectados = (numbers.data ?? []).filter((n) => n.isActive && n.status === 'connected');
  useEffect(() => { if (!numberId && conectados[0]) setNumberId(conectados[0].id); }, [conectados.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const number = conectados.find((n) => n.id === numberId);
  const oficial = number?.provider === 'meta';
  const choice = useTemplateChoice(numberId || null, !!oficial);
  // grupos autorizados do número (docs/grupos.md): só QR Code
  const grupos = useGroups(numberId || undefined, !!number && !oficial);
  const gruposAutorizados = oficial ? [] : (grupos.data ?? []).filter((g) => g.authorized);
  // trocou de número: grupo escolhido é do número anterior
  useEffect(() => { setGroupIds([]); }, [numberId]);

  const deIso = periodo === 'custom' ? de : diasAtras(periodo as number);
  const ateIso = periodo === 'custom' ? ate : iso(new Date());
  const usaPeriodo = closingTagIds.length > 0 || !!lastOutcome;
  const audience: CampaignAudience = {
    ...(todos ? { all: true } : {
      ...(tagIds.length && { tagIds }),
      ...(closingTagIds.length && { closingTagIds }),
      ...(lastOutcome && { lastOutcome }),
      ...(agentId && { agentId }),
      ...(usaPeriodo && { closingFrom: new Date(`${deIso}T00:00:00`).toISOString(), closingTo: new Date(new Date(`${ateIso}T00:00:00`).getTime() + 86_400_000).toISOString() }),
    }),
    ...(telefonesDe(telefones).length && { phones: telefonesDe(telefones) }),
    ...(groupIds.length && !oficial && { groupIds }),
  };
  const temPublico = todos || tagIds.length > 0 || closingTagIds.length > 0 || !!lastOutcome || !!agentId || telefonesDe(telefones).length > 0 || (!oficial && groupIds.length > 0);
  // espera parar de mexer antes de contar
  const [publicoAtual, setPublicoAtual] = useState(audience);
  const chave = JSON.stringify(audience);
  useEffect(() => { const t = setTimeout(() => setPublicoAtual(JSON.parse(chave)), 400); return () => clearTimeout(t); }, [chave]);
  const preview = useAudiencePreview(publicoAtual, temPublico);
  const p = temPublico ? preview.data : undefined;

  const tagsEncerramento = (tags.data ?? []).filter((t) => t.showOnWon || t.showOnLost);
  const teto = oficial ? null : number?.campaignDailyLimit ?? 200;
  const totalGrupos = p?.groups ?? 0;
  const dias = p && teto ? Math.ceil((p.total + totalGrupos) / Math.max(1, teto)) : null;

  const mensagemOk = oficial ? choice.valid : !!text.trim() || !!anexo;
  const podeCriar = !!name.trim() && !!number && mensagemOk && temPublico && !!p && p.total + totalGrupos > 0 && !p.excedeu && (quando === 'agora' || !!startAt);

  async function anexar(f: File) {
    setSubindo(true);
    try { setAnexo(await uploadFile(f)); } catch (err) { toast.err(err); } finally { setSubindo(false); }
  }

  async function criar(iniciar: boolean, acceptRisk = false) {
    try {
      const c = await create.mutateAsync({
        name: name.trim(),
        numberId,
        ...(oficial
          ? { template: choice.value ?? undefined }
          : { text: text.trim() || undefined, ...(anexo && { mediaKey: anexo.key, mediaType: mediaTypeOf(anexo.mimeType), mediaName: anexo.fileName }) }),
        ...(quando === 'agendar' && startAt && { startAt: new Date(startAt).toISOString() }),
        audience,
      });
      if (iniciar) {
        await start.mutateAsync({ id: c.id, acceptRisk });
        toast.ok(quando === 'agendar' ? 'Transmissão agendada' : 'Transmissão iniciada');
      } else toast.ok('Rascunho salvo — inicie quando quiser');
      onClose();
    } catch (err) { toast.err(err); }
  }

  const sec = 'space-y-2';
  const rot = 'block text-sm font-medium text-ink';

  return (
    <Modal open onClose={onClose} title="Nova transmissão" width="max-w-2xl">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={sec}>
            <label className={rot} htmlFor="tx-nome">Nome</label>
            <input id="tx-nome" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Recuperar quem achou caro — outubro" autoFocus />
          </div>
          <div className={sec}>
            <label className={rot} htmlFor="tx-numero">Enviar pelo número</label>
            <select id="tx-numero" className={inputCls} value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              {conectados.length === 0 && <option value="">Nenhum número conectado</option>}
              {conectados.map((n) => <option key={n.id} value={n.id}>{n.label} — {n.provider === 'meta' ? 'API oficial' : 'QR Code'}</option>)}
            </select>
          </div>
        </div>

        {number && !oficial && (
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">
            <ShieldAlert size={15} className="shrink-0 mt-0.5" />
            <span>QR Code: uma mensagem a cada 20–60 s, só no horário de funcionamento, até <b>{teto}</b> por 24h neste número. Para no 3º erro seguido.{dias && dias > 1 ? ` Este público leva cerca de ${dias} dias.` : ''}</span>
          </p>
        )}

        {/* ---------- mensagem ---------- */}
        <div className={sec}>
          <span className={rot}>Mensagem</span>
          {oficial ? (
            <TemplateFields choice={choice} hint="Na API oficial a transmissão sai como template aprovado pela Meta. {{contact.first_name}} vira o primeiro nome de cada contato." />
          ) : (
            <>
              <textarea className={cn(inputCls, 'resize-none')} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="{{saudacao}}, {{contact.first_name}}! Chegou a fralda que você procurava…" />
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                {VARIAVEIS.map((x) => (
                  <button key={x.v} type="button" onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${x.v}`)} className="rounded-md border border-line px-2 py-0.5 text-muted hover:text-ink hover:bg-field">+ {x.l}</button>
                ))}
                <span className="flex-1" />
                {anexo ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-field px-2 py-0.5 text-ink">
                    <Paperclip size={12} /> {anexo.fileName}
                    <button type="button" onClick={() => setAnexo(null)} aria-label="Tirar anexo" className="text-faint hover:text-ink"><X size={12} /></button>
                  </span>
                ) : (
                  <label className="inline-flex items-center gap-1 cursor-pointer text-muted hover:text-ink">
                    {subindo ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Anexar
                    <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void anexar(f); }} />
                  </label>
                )}
              </div>
            </>
          )}
        </div>

        {/* ---------- público ---------- */}
        <div className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(rot, 'flex items-center gap-1.5')}><Users size={15} /> Público</span>
            <label className="flex items-center gap-2 text-[12.5px] text-muted cursor-pointer">
              <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Todos os contatos
            </label>
          </div>

          <fieldset disabled={todos} className={cn('space-y-3', todos && 'opacity-50')}>
            <div className={sec}>
              <span className="block text-[12.5px] text-muted">Com as tags (atuais do contato)</span>
              <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} placeholder="Qualquer tag" />
            </div>

            <div className={sec}>
              <span className="block text-[12.5px] text-muted">Encerramentos — tag escolhida e/ou resultado do último atendimento</span>
              <div className="flex flex-wrap gap-1.5">
                {tagsEncerramento.map((t) => {
                  const on = closingTagIds.includes(t.id);
                  return (
                    <button key={t.id} type="button" aria-pressed={on} onClick={() => setClosingTagIds((l) => (on ? l.filter((x) => x !== t.id) : [...l, t.id]))}
                      className={cn('inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-0.5 text-[12px] transition', on ? 'font-semibold' : 'opacity-80 hover:opacity-100')}
                      style={{ color: t.color, borderColor: on ? t.color : `color-mix(in srgb, ${t.color} 45%, transparent)`, background: `color-mix(in srgb, ${t.color} ${on ? 22 : 8}%, transparent)` }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.name}
                    </button>
                  );
                })}
                {tagsEncerramento.length === 0 && <span className="text-[12px] text-faint">Nenhuma tag marcada para o encerramento.</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <div className="inline-flex rounded-lg border border-line p-0.5">
                  {([['', 'Qualquer resultado'], ['won', labels.won], ['lost', labels.lost]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setLastOutcome(v)} aria-pressed={lastOutcome === v} className={cn('rounded-md px-2 py-0.5', lastOutcome === v ? 'bg-accent-soft text-accent-ink font-medium' : 'text-muted hover:text-ink')}>{l}</button>
                  ))}
                </div>
                {usaPeriodo && (
                  <>
                    <span className="text-muted">nos últimos</span>
                    {PERIODOS.map((n) => (
                      <button key={n} type="button" onClick={() => setPeriodo(n)} className={cn('rounded-md border px-2 py-0.5', periodo === n ? 'border-accent text-accent-ink bg-accent-soft' : 'border-line text-muted hover:text-ink')}>{n} dias</button>
                    ))}
                    <button type="button" onClick={() => setPeriodo('custom')} className={cn('rounded-md border px-2 py-0.5', periodo === 'custom' ? 'border-accent text-accent-ink bg-accent-soft' : 'border-line text-muted hover:text-ink')}>Período…</button>
                    {periodo === 'custom' && (
                      <span className="inline-flex items-center gap-1">
                        <input type="date" className={cn(inputCls, 'h-7 py-0 w-auto text-[12px]')} value={de} max={ate} onChange={(e) => setDe(e.target.value)} aria-label="De" />
                        <span className="text-muted">a</span>
                        <input type="date" className={cn(inputCls, 'h-7 py-0 w-auto text-[12px]')} value={ate} min={de} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className={sec}>
              <span className="block text-[12.5px] text-muted">Atendente (está com a conversa ou encerrou o último atendimento)</span>
              <select className={cn(inputCls, 'sm:w-72')} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Qualquer atendente</option>
                {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </fieldset>

          <div className={sec}>
            <span className="block text-[12.5px] text-muted">E também estes telefones (colados de uma planilha: um por linha, vírgula ou ;)</span>
            <textarea className={cn(inputCls, 'resize-none font-mono text-[12.5px]')} rows={2} value={telefones} onChange={(e) => setTelefones(e.target.value)} placeholder={'(11) 99999-8888\n11 98888-7777'} />
          </div>

          {number && !oficial && (
            <div className={sec}>
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><UsersRound size={13} /> E também estes grupos autorizados</span>
              {gruposAutorizados.length === 0 ? (
                <span className="block text-[12px] text-faint">Nenhum grupo autorizado neste número. Autorize em Configurações → Grupos autorizados.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {gruposAutorizados.map((g) => {
                    const on = groupIds.includes(g.id);
                    return (
                      <button key={g.id} type="button" aria-pressed={on} onClick={() => setGroupIds((l) => (on ? l.filter((x) => x !== g.id) : [...l, g.id]))}
                        className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', on ? 'border-accent bg-accent-soft text-accent-ink font-medium' : 'border-line text-muted hover:text-ink')}>
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[12.5px]">
            {!temPublico && <span className="text-muted">Escolha ao menos um critério (ou “Todos os contatos”).</span>}
            {temPublico && !p && <span className="text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Contando…</span>}
            {p && (
              <>
                <span className={cn('font-semibold', p.excedeu ? 'text-danger' : 'text-ink')}><span className="tnum">{p.total.toLocaleString('pt-BR')}</span> contato(s){totalGrupos > 0 ? ` e ${totalGrupos} grupo(s)` : ''} vão receber</span>
                {p.novos > 0 && <span className="text-muted">{p.novos} telefone(s) novo(s) viram contato</span>}
                {p.invalidos > 0 && <span className="text-warn-ink">{p.invalidos} telefone(s) inválido(s) ignorado(s)</span>}
                {p.optOut > 0 && <span className="text-muted">{p.optOut} descadastrado(s) fora</span>}
                {p.excedeu && <span className="text-danger">Máximo de {p.max.toLocaleString('pt-BR')} por transmissão — refine os filtros.</span>}
              </>
            )}
          </div>
        </div>

        {/* ---------- quando ---------- */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={rot}>Quando</span>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Assim que iniciar</label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> Agendar</label>
          {quando === 'agendar' && <input type="datetime-local" className={cn(inputCls, 'w-auto py-1')} value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Data e hora de início" />}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="ghost" disabled={!podeCriar} loading={create.isPending && !start.isPending} onClick={() => void criar(false)}>Salvar rascunho</Button>
          <Button disabled={!podeCriar} loading={create.isPending || start.isPending} loadingText="Criando…" onClick={() => (oficial ? void criar(true) : setRiscoAberto(true))}>
            {quando === 'agendar' ? 'Agendar transmissão' : 'Iniciar transmissão'}
          </Button>
        </div>
      </div>

      {riscoAberto && <QrRiskModal onClose={() => setRiscoAberto(false)} onAccept={() => { setRiscoAberto(false); void criar(true, true); }} />}
    </Modal>
  );
}
