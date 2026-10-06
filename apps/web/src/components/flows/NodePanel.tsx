'use client';
import { useContext } from 'react';
import { Trash2, Plus, X, ExternalLink, Lock, LockOpen } from 'lucide-react';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { NODE_META, DELAY_UNIT, FlowEditorRefs } from './nodes';
import { useTags, useAgents, useServices, useProfessionals, useHasFeature, useDepartments } from '@/lib/hooks';
import { DEPARTMENT_NONE } from '@atendo/shared';
import { TextWithVars, SYSTEM_VARS, type FlowVar } from './TextWithVars';
import { CONTACT_FIELD_LABEL, MAX_FLOW_HOPS, VARIABLE_OP_LABEL, WEBHOOK_DEFAULT_TIMEOUT_SEC, WEBHOOK_MAX_TIMEOUT_SEC, WEBHOOK_METHODS, distributeRemaining, normalizeCondition, normalizeContent, randomizerLockedTotal, randomizerTotal, type ContactField, type DelayUnit, type FlowNode, type ReplyTimeout, type VariableAssignment, type VariableOp, type WebhookHeader } from '@atendo/shared';
import { ConditionPanel } from './ConditionPanel';
import { ContentPanel } from './ContentPanel';

const varName = (v: string) => v.replace(/[^\w]/g, '_').toLowerCase();
const shortId = () => crypto.randomUUID().slice(0, 8);
/** Valor fixo que não é número (com {{variável}} só dá para saber na execução). Mesma regra do `toNumber` da API. */
const notNumber = (v: string) => {
  const t = v.trim();
  if (/\{\{/.test(t)) return false;
  return !t || Number.isNaN(Number(/,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')));
};

/**
 * Tempo limite de resposta (Salvar e Menu). 0 = espera indefinidamente. Vencido, sai por
 * "Não respondeu"; sem essa saída ligada, o fluxo termina.
 */
function ReplyTimeoutFields({ data, set }: { data: ReplyTimeout; set: (p: Record<string, unknown>) => void }) {
  const unit: DelayUnit = data.timeoutUnit ?? 'minutes';
  const f = DELAY_UNIT[unit].factor;
  const on = !!data.timeoutMinutes;
  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <label className="flex items-center gap-2 text-ink text-[13px]">
        <input type="checkbox" checked={on} onChange={(e) => set({ timeoutMinutes: e.target.checked ? 30 : undefined, timeoutUnit: e.target.checked ? 'minutes' : undefined })} />
        Tempo limite para responder
      </label>
      {on && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={1} className={inputCls} value={+(data.timeoutMinutes! / f).toFixed(2)} onChange={(e) => set({ timeoutMinutes: Math.max(1, Math.round(Number(e.target.value) * f)) })} />
            <select className={inputCls} value={unit} onChange={(e) => set({ timeoutUnit: e.target.value })}>
              {(Object.keys(DELAY_UNIT) as DelayUnit[]).map((k) => <option key={k} value={k}>{DELAY_UNIT[k].label}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2 text-ink text-[12px]">
            <input type="checkbox" className="mt-0.5" checked={!!data.timeoutBusinessHours} onChange={(e) => set({ timeoutBusinessHours: e.target.checked || undefined })} />
            <span>Contar só dentro do horário de atendimento<span className="block text-[11px] text-muted">Pelo quadro de horários do número da conversa: 30 min pedidos às 11:50 com almoço das 12h às 14h vencem às 14:20.</span></span>
          </label>
          <p className="text-[11px] text-muted">Sem resposta nesse tempo, segue pela saída <b>Não respondeu</b> (sem ligação, o fluxo termina). Cada nova tentativa recomeça a contagem. Robô pausado ou conversa encerrada no meio: o fluxo para.</p>
        </>
      )}
    </div>
  );
}

/** Painel lateral: edita os dados do bloco selecionado. Cada tipo tem seus campos. */
export function NodePanel({ node, onChange, onDelete, vars }: { node: FlowNode; onChange: (data: FlowNode['data']) => void; onDelete: () => void; vars: FlowVar[] }) {
  const tags = useTags();
  const agents = useAgents();
  const departments = useDepartments();
  // desativado só aparece se já for o escolhido (para não sumir do select sem aviso)
  const deptOptions = (current?: string) => (departments.data ?? []).filter((d) => d.isActive || d.id === current);
  const sched = useHasFeature('scheduling');
  const aiFeature = useHasFeature('ai_flows');
  const services = useServices();
  const pros = useProfessionals();
  const refs = useContext(FlowEditorRefs);
  const m = NODE_META[node.type];
  // editar o bloco é revisá-lo: some o aviso "Reconfigurar" que veio da importação
  const set = (patch: Record<string, unknown>) => {
    const { _reconfig, ...rest } = node.data as Record<string, unknown>;
    void _reconfig;
    onChange({ ...rest, ...patch } as FlowNode['data']);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <span className={`w-6 h-6 rounded-md grid place-items-center ${m.color}`}>{m.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink">{m.label}</div>
          <div className="text-[11px] text-muted truncate">{m.hint}</div>
        </div>
        {node.type !== 'start' && <button onClick={onDelete} className="text-faint hover:text-danger p-1" title="Remover bloco"><Trash2 size={15} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {node.type === 'start' && <p className="text-muted">O gatilho (manual, nova conversa ou palavra-chave) é definido nas configurações do fluxo, no topo da tela.</p>}

        {node.type === 'message' && (
          <ContentPanel
            items={normalizeContent(node.data)}
            vars={vars}
            // primeira edição de um bloco antigo grava no formato novo (`items`) e apaga os campos soltos
            onChange={(items) => set({ items, text: undefined, mediaKey: undefined, mediaType: undefined, mediaName: undefined })}
          />
        )}

        {node.type === 'connect_flow' && (() => {
          const target = refs.flows?.find((f) => f.id === node.data.flowId);
          return (
            <>
              <Field label="Fluxo de destino" hint="Só fluxos desta empresa. Desativado não recebe a conversa.">
                <select className={inputCls} value={node.data.flowId ?? ''} onChange={(e) => set({ flowId: e.target.value || undefined, flowName: undefined })}>
                  <option value="">Escolha…</option>
                  {node.data.flowId && refs.flows && !target && <option value={node.data.flowId}>(fluxo excluído)</option>}
                  {refs.flows?.map((f) => <option key={f.id} value={f.id}>{f.name}{f.id === refs.flowId ? ' (este fluxo — recomeça)' : ''}{f.isActive ? '' : ' (desativado)'}</option>)}
                </select>
              </Field>
              {target && <a href={`/fluxos/${target.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent-ink hover:underline"><ExternalLink size={12} /> Abrir “{target.name}” em nova aba</a>}
              {target && !target.isActive && <p className="text-[11.5px] rounded-lg bg-warn-soft text-warn-ink px-3 py-2">O destino está desativado: enquanto estiver assim, a conversa não salta — a automação para e a conversa fica com o atendente atribuído (ou vai para a fila).</p>}
              <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">
                Este fluxo <b>termina aqui</b> e o destino começa do <b>início</b> — não há volta. As variáveis deste fluxo seguem para o destino.
                Se o destino for excluído ou desativado, a automação para: a conversa fica com o atendente atribuído ou, sem ninguém, vai para a fila. Proteção contra loop: {MAX_FLOW_HOPS} saltos seguidos sem o contato responder encerram a automação.
              </p>
            </>
          );
        })()}

        {node.type === 'question' && (
          <>
            <Field label="Pergunta (opcional)" hint="Vazio = só espera a resposta (a pergunta foi feita num bloco anterior)"><TextWithVars value={node.data.text} onChange={(v) => set({ text: v })} vars={vars} placeholder="Qual o seu e-mail?" /></Field>
            <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Onde salvar a resposta</div>
              <Field label="Variável" hint="Só letras, números e _ . A resposta do contato fica guardada aqui.">
                <input className={inputCls} value={node.data.varName} onChange={(e) => set({ varName: varName(e.target.value) })} placeholder="email" />
              </Field>
              <Field label="Também na ficha do contato" hint="Vale fora deste fluxo: aparece na ficha e nas próximas conversas">
                <select className={inputCls} value={node.data.contactField ?? ''} onChange={(e) => set({ contactField: (e.target.value || undefined) as ContactField | undefined })}>
                  <option value="">Não salvar no contato</option>
                  {(Object.keys(CONTACT_FIELD_LABEL) as ContactField[]).map((k) => <option key={k} value={k}>{CONTACT_FIELD_LABEL[k]}</option>)}
                </select>
              </Field>
              <p className="text-[11.5px] text-muted">Depois, em qualquer bloco, use <code className="font-mono bg-panel border border-line rounded px-1">{`{{${node.data.varName || 'nome'}}}`}</code> — ou clique em <b>Inserir variável</b> nos campos de texto.</p>
            </div>
            <Field label="Validação">
              <select className={inputCls} value={node.data.validation} onChange={(e) => set({ validation: e.target.value })}>
                <option value="none">Qualquer texto</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="number">Número</option>
              </select>
            </Field>
            <Field label="Mensagem se inválido"><TextWithVars multiline={false} value={node.data.invalidText ?? ''} onChange={(v) => set({ invalidText: v })} vars={vars} placeholder="Não entendi. Pode repetir?" /></Field>
            <Field label="Tentativas antes de desistir" hint="Respostas inválidas aceitas antes de seguir pela saída 'Tentativas esgotadas' (sem ligação, entrega para humano)"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
            <ReplyTimeoutFields data={node.data} set={set} />
          </>
        )}

        {node.type === 'menu' && (
          <>
            <Field label="Texto do menu" hint="As opções são numeradas automaticamente"><TextWithVars value={node.data.text} onChange={(v) => set({ text: v })} vars={vars} placeholder="Como posso ajudar?" /></Field>
            <Field label="Opções">
              <div className="space-y-1.5">
                {node.data.options.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <span className="tnum font-mono text-xs text-faint w-4">{i + 1}</span>
                    <input className={inputCls} value={o.label} onChange={(e) => set({ options: node.data.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
                    <button onClick={() => set({ options: node.data.options.filter((x) => x.id !== o.id) })} className="text-faint hover:text-danger p-1" disabled={node.data.options.length <= 1}><X size={14} /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ options: [...node.data.options, { id: crypto.randomUUID().slice(0, 8), label: `Opção ${node.data.options.length + 1}` }] })}>Adicionar opção</Button>
              </div>
            </Field>
            <Field label="Mensagem se inválido"><TextWithVars multiline={false} value={node.data.invalidText ?? ''} onChange={(v) => set({ invalidText: v })} vars={vars} placeholder="Opção inválida. Responda com o número." /></Field>
            <p className="text-[11px] text-muted">O contato pode responder o <b>número</b> ou o <b>texto</b> da opção (maiúsculas e acentos não importam). A opção escolhida fica na variável <code className="font-mono bg-field rounded px-1">{`{{menu_${node.id}}}`}</code>.</p>
            <Field label="Tentativas" hint="Respostas inválidas aceitas antes de seguir pela saída 'Tentativas esgotadas' (sem ligação, entrega para humano)"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
            <ReplyTimeoutFields data={node.data} set={set} />
          </>
        )}

        {node.type === 'condition' && (
          <ConditionPanel
            branches={normalizeCondition(node.data)}
            vars={vars}
            // primeira edição de um bloco antigo grava no formato novo (ramo 'yes' + Senão 'no')
            onChange={(branches) => set({ branches, kind: undefined, varName: undefined, value: undefined, tagId: undefined, hours: undefined })}
          />
        )}

        {node.type === 'action' && (
          <>
            <Field label="Ação">
              {/* "Encerrar conversa" é atalho para Mudar status → Encerrado (mesmo dado salvo) */}
              <select className={inputCls} value={node.data.kind === 'set_status' && node.data.status === 'closed' ? 'close' : node.data.kind} onChange={(e) => set(e.target.value === 'close' ? { kind: 'set_status', status: 'closed' } : e.target.value === 'set_status' ? { kind: 'set_status', status: 'waiting' } : { kind: e.target.value })}>
                {/* "Definir variável" virou o bloco Manipulador; continua aqui só para fluxos antigos */}
                {node.data.kind === 'set_var' && <option value="set_var">Definir variável (antigo — prefira o bloco Manipulador)</option>}
                <option value="add_tag">Aplicar etiqueta</option><option value="remove_tag">Remover etiqueta</option><option value="assign">Atribuir a atendente</option><option value="set_status">Mudar status</option><option value="close">Encerrar conversa</option><option value="webhook">Chamar webhook</option><option value="set_department">Definir departamento</option><option value="handoff">Transferir para atendente humano (fim do fluxo)</option>
              </select>
            </Field>
            {node.data.kind === 'webhook' && (() => {
              const d = node.data;
              const method = d.method ?? 'POST';
              const headers = d.headers ?? [];
              const updH = (id: string, patch: Partial<WebhookHeader>) => set({ headers: headers.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
              return (
                <>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <Field label="Método">
                      <select className={inputCls} value={method} onChange={(e) => set({ method: e.target.value })}>{WEBHOOK_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    </Field>
                    <Field label="URL"><TextWithVars multiline={false} value={d.url ?? ''} onChange={(v) => set({ url: v.trim() })} vars={vars} placeholder="https://exemplo.com/webhook" /></Field>
                  </div>
                  <Field label="Headers" hint="Ex.: Authorization. Valores aceitam {{variáveis}}. Authorization, X-Api-Key e nomes com token/secret não vão na exportação.">
                    <div className="space-y-1.5">
                      {headers.map((h) => (
                        <div key={h.id} className="flex items-center gap-1.5">
                          <input className={`${inputCls} w-2/5`} value={h.key} placeholder="Nome" onChange={(e) => updH(h.id, { key: e.target.value.replace(/[^\w!#$%&'*+.^`|~-]/g, '') })} />
                          <TextWithVars multiline={false} value={h.value} vars={vars} placeholder="Valor" onChange={(v) => updH(h.id, { value: v })} />
                          <button onClick={() => set({ headers: headers.filter((x) => x.id !== h.id) })} className="text-faint hover:text-danger p-1"><X size={14} /></button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ headers: [...headers, { id: shortId(), key: '', value: '' }] })}>Adicionar header</Button>
                    </div>
                  </Field>
                  {method !== 'GET' && method !== 'DELETE' && (
                    <Field label="Corpo (opcional)" hint="Vazio = JSON com o contato e as variáveis do fluxo. Em JSON, as {{variáveis}} entram já escapadas.">
                      <TextWithVars value={d.body ?? ''} onChange={(v) => set({ body: v || undefined })} vars={vars} placeholder={'{"nome": "{{contact.name}}", "pedido": "{{pedido}}"}'} />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Tempo limite (s)"><input type="number" min={1} max={WEBHOOK_MAX_TIMEOUT_SEC} className={inputCls} value={d.timeoutSec ?? WEBHOOK_DEFAULT_TIMEOUT_SEC} onChange={(e) => set({ timeoutSec: Math.min(WEBHOOK_MAX_TIMEOUT_SEC, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
                    <Field label="Guardar resposta em"><input className={inputCls} value={d.responseVar ?? ''} onChange={(e) => set({ responseVar: varName(e.target.value) || undefined })} placeholder="retorno_webhook" /></Field>
                  </div>
                  <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Falha (fora do ar, tempo esgotado, endereço interno ou resposta diferente de 2xx) segue pela saída <b>Erro</b>; sem ela ligada, segue pela saída normal. A resposta guardada é o corpo (até 2.000 caracteres) — vazia em caso de erro.</p>
                </>
              );
            })()}
            {node.data.kind === 'set_var' && (
              <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Este bloco cria/atualiza uma variável</div>
                <Field label="Nome da variável"><input className={inputCls} value={node.data.varName ?? ''} onChange={(e) => set({ varName: varName(e.target.value) })} placeholder="origem" /></Field>
                <Field label="Valor" hint="Pode usar outras variáveis, ex.: Olá {{contact.name}}"><TextWithVars multiline={false} value={node.data.value ?? ''} onChange={(v) => set({ value: v })} vars={vars} placeholder="site" /></Field>
              </div>
            )}
            {(node.data.kind === 'add_tag' || node.data.kind === 'remove_tag') && (
              <>
                <Field label="Tag"><select className={inputCls} value={node.data.tagId ?? ''} onChange={(e) => set({ tagId: e.target.value })}><option value="">Escolha…</option>{tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                <Field label="Aplicar em" hint="Contato = vale para sempre, em todas as conversas dessa pessoa (ex.: comprador recorrente)">
                  <div className="grid grid-cols-2 gap-2">
                    {([['conversation', 'Esta conversa'], ['contact', '📌 Contato']] as const).map(([v, l]) => (
                      <button type="button" key={v} onClick={() => set({ scope: v })} className={`rounded-lg border px-3 py-1.5 text-sm ${(node.data.scope ?? 'conversation') === v ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:bg-field'}`}>{l}</button>
                    ))}
                  </div>
                </Field>
              </>
            )}
            {(node.data.kind === 'assign' || node.data.kind === 'handoff') && (
              <Field label={node.data.kind === 'handoff' ? 'Atribuir a (opcional)' : 'Atendente'} hint={node.data.kind === 'handoff' ? 'Vazio = volta para a fila "Aguardando"' : undefined}>
                <select className={inputCls} value={node.data.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}><option value="">{node.data.kind === 'handoff' ? 'Fila (qualquer atendente)' : 'Escolha…'}</option>{agents.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </Field>
            )}
            {node.data.kind === 'set_department' && (
              <>
                <Field label="Departamento">
                  <select className={inputCls} value={node.data.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || undefined })}>
                    <option value="">Escolha…</option>
                    {deptOptions(node.data.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}{d.isActive ? '' : ' (desativado)'}</option>)}
                    <option value={DEPARTMENT_NONE}>Sem departamento (tirar do atual)</option>
                  </select>
                </Field>
                <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Só muda o departamento da conversa — o atendente e o status continuam como estão e o fluxo segue. Para entregar a alguém do departamento, use depois o bloco <b>Distribuidor</b> (com o departamento) ou <b>Transferir para atendente humano</b> (vai para a fila).</p>
              </>
            )}
            {node.data.kind === 'set_status' && node.data.status !== 'closed' && (
              <Field label="Status"><select className={inputCls} value={node.data.status ?? 'waiting'} onChange={(e) => set({ status: e.target.value })}><option value="waiting">Aguardando</option><option value="in_progress">Em atendimento</option></select></Field>
            )}
            {node.data.kind === 'set_status' && node.data.status === 'closed' && <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Encerra o atendimento (dispara o fluxo de encerramento, se houver). Depois disso, Atraso e tempo limite deste fluxo param — a conversa está encerrada.</p>}
          </>
        )}

        {node.type === 'schedule' && (
          !sched.has && !sched.loading ? <p className="text-sm text-muted rounded-lg bg-warn-soft px-3 py-2">Agendamento não está incluído no plano deste cliente. O bloco será ignorado (saída “Não conseguiu”).</p> : (
          <>
            <Field label="Texto de abertura (opcional)"><TextWithVars value={node.data.intro ?? ''} onChange={(v) => set({ intro: v })} vars={vars} placeholder="Vamos agendar! Qual serviço você quer?" /></Field>
            <Field label="Serviço" hint="Fixo = não pergunta ao contato">
              <select className={inputCls} value={node.data.serviceId ?? ''} onChange={(e) => set({ serviceId: e.target.value || undefined })}><option value="">Perguntar ao contato</option>{services.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}</select>
            </Field>
            <Field label="Profissional" hint="Fixo = não pergunta (com um só cadastrado, também não pergunta)">
              <select className={inputCls} value={node.data.professionalId ?? ''} onChange={(e) => set({ professionalId: e.target.value || undefined })}><option value="">Perguntar ao contato</option>{pros.data?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </Field>
            <Field label="Horários mostrados por vez"><input type="number" min={2} max={12} className={inputCls} value={node.data.maxSlots} onChange={(e) => set({ maxSlots: Number(e.target.value) })} /></Field>
            <Field label="Mensagem de confirmação" hint="Pode usar {{servico}}, {{profissional}}, {{horario}}"><TextWithVars value={node.data.confirmText ?? ''} onChange={(v) => set({ confirmText: v })} vars={vars} placeholder="Agendado! {{servico}} com {{profissional}} em {{horario}}. Te lembro um dia antes. 💈" /></Field>
            <p className="text-[11px] text-muted">Depois de agendar, as variáveis <code className="font-mono bg-field rounded px-1">{'{{agendamento}}'}</code>, <code className="font-mono bg-field rounded px-1">{'{{servico}}'}</code> e <code className="font-mono bg-field rounded px-1">{'{{profissional}}'}</code> ficam disponíveis. O contato pode responder “cancelar” a qualquer momento.</p>
          </>
          )
        )}

        {node.type === 'ai' && (
          !aiFeature.has && !aiFeature.loading ? <p className="text-sm text-muted rounded-lg bg-warn-soft px-3 py-2">IA nos fluxos não está incluída no plano deste cliente. O bloco será ignorado (saída “Não conseguiu”).</p> : (
          <>
            <Field label="O que a IA faz aqui">
              <select className={inputCls} value={node.data.mode} onChange={(e) => set({ mode: e.target.value, labels: e.target.value === 'classify' && !node.data.labels?.length ? [{ id: crypto.randomUUID().slice(0, 8), label: 'Quer agendar' }, { id: crypto.randomUUID().slice(0, 8), label: 'Perguntou preço' }] : node.data.labels })}>
                <option value="answer">Responder o contato</option>
                <option value="classify">Classificar a mensagem (escolher o caminho)</option>
              </select>
            </Field>
            <Field label="Instruções do negócio" hint="Quem é você, o que pode e o que não pode responder">
              <TextWithVars value={node.data.instructions} onChange={(v) => set({ instructions: v })} vars={vars} placeholder="Você atende a Barbearia do Carlos. Só fale de cortes, barba e horários. Nunca prometa desconto." />
            </Field>
            {node.data.mode === 'answer' ? (
              <>
                <Field label="Base de conhecimento" hint="Única fonte de fatos: preços, endereço, horários, regras. Se não estiver aqui, a IA diz que vai verificar.">
                  <TextWithVars className="min-h-40" value={node.data.knowledge ?? ''} onChange={(v) => set({ knowledge: v })} vars={vars} placeholder={'Corte: R$ 45 (30 min)\nPIX: {{pix_chave}}\nEndereço: Rua X, 100\nFuncionamento: {{horario_atendimento}}'} />
                </Field>
                <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-ink text-[13px]">
                    <input type="checkbox" checked={node.data.keepTalking ?? false} onChange={(e) => set({ keepTalking: e.target.checked })} />
                    Continuar conversando
                  </label>
                  <p className="text-[11.5px] text-muted">Desmarcado, a IA responde <b>uma vez</b> e o fluxo segue. Marcado, ela continua respondendo o contato até o limite abaixo — é o que faz a IA <i>atender</i> de verdade.</p>
                  {node.data.keepTalking && (
                    <Field label="Máximo de respostas" hint="Ao atingir, o fluxo segue pela saída 'Respondeu' (leve para um humano). É o freio de custo.">
                      <input type="number" min={1} max={30} className={inputCls} value={node.data.maxTurns ?? 10} onChange={(e) => set({ maxTurns: Number(e.target.value) })} />
                    </Field>
                  )}
                </div>
                <Field label="Guardar a resposta numa variável (opcional)">
                  <input className={inputCls} value={node.data.varName ?? ''} onChange={(e) => set({ varName: e.target.value.replace(/[^\w]/g, '_').toLowerCase() || undefined })} placeholder="resposta_ia" />
                </Field>
              </>
            ) : (
              <Field label="Rótulos" hint="Cada rótulo vira uma saída do bloco">
                <div className="space-y-1.5">
                  {(node.data.labels ?? []).map((l) => (
                    <div key={l.id} className="flex items-center gap-1.5">
                      <input className={inputCls} value={l.label} onChange={(e) => set({ labels: (node.data.labels ?? []).map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) })} />
                      <button onClick={() => set({ labels: (node.data.labels ?? []).filter((x) => x.id !== l.id) })} className="text-faint hover:text-danger p-1"><X size={14} /></button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => set({ labels: [...(node.data.labels ?? []), { id: crypto.randomUUID().slice(0, 8), label: '' }] })}>Rótulo</Button>
                </div>
              </Field>
            )}
            <Field label="Mensagem quando a IA não conseguir" hint="Enviada antes de seguir pela saída 'Não conseguiu'">
              <TextWithVars multiline={false} value={node.data.fallbackText ?? ''} onChange={(v) => set({ fallbackText: v })} vars={vars} placeholder="Vou verificar isso com um atendente, um momento." />
            </Field>
            <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">A saída <b>Não conseguiu</b> é obrigatória e deve levar a um humano: ela é usada quando a IA está indisponível, sem quota ou fora do que sabe responder. Cada chamada consome uma <b>interação de IA</b> do plano.</p>
          </>
          )
        )}

        {node.type === 'wait' && (() => {
          const unit = node.data.unit ?? 'minutes';
          const f = DELAY_UNIT[unit].factor;
          const mode = node.data.mode ?? 'duration';
          return (
            <>
              <Field label="Aguardar">
                <select className={inputCls} value={mode} onChange={(e) => set({ mode: e.target.value === 'duration' ? undefined : e.target.value })}>
                  <option value="duration">Um tempo definido</option>
                  <option value="next_open">Até o próximo horário de atendimento</option>
                </select>
              </Field>
              {mode === 'duration' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Esperar"><input type="number" min={1} className={inputCls} value={+(node.data.minutes / f).toFixed(2)} onChange={(e) => set({ minutes: Math.max(1, Math.round(Number(e.target.value) * f)) })} /></Field>
                    <Field label="Unidade">
                      <select className={inputCls} value={unit} onChange={(e) => set({ unit: e.target.value })}>
                        {(Object.keys(DELAY_UNIT) as (keyof typeof DELAY_UNIT)[]).map((k) => <option key={k} value={k}>{DELAY_UNIT[k].label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <label className="flex items-start gap-2 text-ink">
                    <input type="checkbox" className="mt-0.5" checked={!!node.data.businessHours} onChange={(e) => set({ businessHours: e.target.checked })} />
                    <span>Só seguir no horário de atendimento<span className="block text-[11px] text-muted">Se o tempo vencer fora do horário (quadro de horários do número da conversa), espera até a próxima abertura.</span></span>
                  </label>
                </>
              ) : (
                <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Segue quando o quadro de horários do número da conversa entrar numa faixa que conta como atendimento. Se já estiver aberto (ou com o atendimento desativado), segue na hora.</p>
              )}
              <p className="text-[11px] text-muted">Mensagem do contato durante a espera é ignorada. Robô pausado ou conversa encerrada antes do fim: o fluxo para.</p>
            </>
          );
        })()}

        {node.type === 'variable' && (() => {
          const list = node.data.assignments;
          const upd = (id: string, patch: Partial<VariableAssignment>) => set({ assignments: list.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
          return (
            <Field label="Operações" hint="Executadas em ordem: cada uma já enxerga o resultado da anterior. Valores aceitam {{variáveis}}.">
              <div className="space-y-2">
                {list.map((a, i) => {
                  const op = a.op ?? 'set';
                  return (
                    <div key={a.id} className="rounded-lg border border-line p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="tnum font-mono text-[11px] text-faint w-4">{i + 1}</span>
                        <select className={inputCls} value={op} onChange={(e) => upd(a.id, { op: e.target.value as VariableOp })}>
                          {(Object.keys(VARIABLE_OP_LABEL) as VariableOp[]).map((o) => <option key={o} value={o}>{VARIABLE_OP_LABEL[o]}</option>)}
                        </select>
                        <button onClick={() => set({ assignments: list.filter((x) => x.id !== a.id) })} disabled={list.length <= 1} className="text-faint hover:text-danger p-1"><X size={14} /></button>
                      </div>
                      <input className={inputCls} value={a.varName} placeholder="nome_da_variavel" onChange={(e) => upd(a.id, { varName: varName(e.target.value) })} />
                      {(op === 'set' || op === 'append') && <TextWithVars multiline={false} value={a.value} vars={vars} placeholder={op === 'append' ? 'texto a acrescentar' : 'valor'} onChange={(v) => upd(a.id, { value: v })} />}
                      {(op === 'add' || op === 'subtract') && (
                        <>
                          <TextWithVars multiline={false} value={a.value} vars={vars} placeholder="número (ex.: 1 ou {{outra}})" onChange={(v) => upd(a.id, { value: v })} />
                          {notNumber(a.value) && <p className="text-[11px] text-danger">Só números podem ser somados ou subtraídos (ex.: 1, 10,5).</p>}
                        </>
                      )}
                      {op === 'copy' && (
                        <select className={inputCls} value={a.from ?? ''} onChange={(e) => upd(a.id, { from: e.target.value })}>
                          <option value="">Copiar de…</option>
                          <optgroup label="Dados do contato">{SYSTEM_VARS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>
                          {vars.length > 0 && <optgroup label="Criadas neste fluxo">{vars.filter((v) => v.key !== a.varName).map((v) => <option key={v.key} value={v.key}>{v.key} — {v.label}</option>)}</optgroup>}
                        </select>
                      )}
                      {op === 'now' && (
                        <select className={inputCls} value={a.format ?? 'datetime'} onChange={(e) => upd(a.id, { format: e.target.value as VariableAssignment['format'] })}>
                          <option value="datetime">Data e hora (04/10/2026 14:30)</option>
                          <option value="date">Só a data (04/10/2026)</option>
                          <option value="time">Só a hora (14:30)</option>
                        </select>
                      )}
                      {op === 'clear' && <p className="text-[11px] text-muted">A variável fica vazia.</p>}
                    </div>
                  );
                })}
                <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ assignments: [...list, { id: shortId(), varName: '', op: 'set', value: '' }] })}>Adicionar operação</Button>
                <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">Somar/subtrair: variável vazia conta como 0 e aceita vírgula decimal (10,5); se o valor não for número, a variável não muda. Variáveis valem só nesta execução do fluxo.</p>
              </div>
            </Field>
          );
        })()}

        {node.type === 'randomizer' && (() => {
          const branches = node.data.branches;
          const total = randomizerTotal(branches);
          const lockedTotal = randomizerLockedTotal(branches);
          const freeCount = branches.filter((b) => !b.locked).length;
          const canSpread = lockedTotal <= 100 && freeCount > 0;
          // digitar um valor fixa o ramo; só o cadeado solta (nenhum botão desfaz o que foi fixado)
          const setPct = (id: string, v: string) => set({ branches: branches.map((x) => (x.id === id ? { ...x, weight: Math.min(100, Math.max(0, Math.round(Number(v) || 0))), locked: true } : x)) });
          const toggleLock = (id: string) => set({ branches: branches.map((x) => (x.id === id ? { ...x, locked: !x.locked } : x)) });
          const linkCls = 'text-xs font-medium text-accent hover:underline disabled:text-faint disabled:no-underline disabled:cursor-not-allowed';
          return (
            <Field label="Ramos" hint="Cada ramo é uma saída. Informe o percentual de conversas que vai para cada um.">
              <div className="space-y-1.5">
                <div className="flex justify-end">
                  <button type="button" onClick={() => set({ branches: distributeRemaining(branches) })} disabled={!canSpread} className={linkCls}
                    title={freeCount ? 'Divide o que falta para 100% igualmente entre os ramos livres; os fixados (cadeado) são mantidos. Sem nenhum fixado, divide 100% por todos.' : 'Todos os ramos estão fixados: solte algum cadeado'}>Distribuir restante</button>
                </div>
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center gap-1.5">
                    <input className={inputCls} value={b.label} placeholder="Nome" onChange={(e) => set({ branches: branches.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)) })} />
                    <div className="relative w-24 shrink-0">
                      <input type="number" min={0} max={100} step={1} className={`${inputCls} pr-6`} value={b.weight} onChange={(e) => setPct(b.id, e.target.value)} aria-label={`Percentual do ramo ${b.label}`} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                    </div>
                    <button type="button" onClick={() => toggleLock(b.id)} className={b.locked ? 'text-accent p-1' : 'text-faint hover:text-ink p-1'}
                      title={b.locked ? 'Fixado: "Distribuir restante" não altera este ramo. Clique para soltar.' : 'Livre: recebe parte do restante. Clique para fixar.'}
                      aria-label={b.locked ? `Soltar ramo ${b.label}` : `Fixar ramo ${b.label}`} aria-pressed={!!b.locked}>
                      {b.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                    </button>
                    <button onClick={() => set({ branches: branches.filter((x) => x.id !== b.id) })} disabled={branches.length <= 2} className="text-faint hover:text-danger p-1"><X size={14} /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => set({ branches: [...branches, { id: shortId(), label: String.fromCharCode(65 + branches.length), weight: 0 }] })}>Adicionar ramo</Button>
                <div className={`space-y-0.5 rounded-lg px-3 py-2 text-xs ${total === 100 ? 'bg-field text-muted' : 'bg-danger-soft text-danger-ink'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold tnum">Total: {total}% / 100%</span>
                    {total !== 100 && <span>A soma dos ramos deve ser igual a 100%</span>}
                  </div>
                  {lockedTotal > 100 && <p className="font-medium text-danger-ink tnum">Os ramos fixados somam {lockedTotal}% — passa de 100%. Reduza algum valor para distribuir o restante.</p>}
                </div>
                <p className="text-[11px] text-muted">Dica: preencha os valores desejados e clique em &ldquo;Distribuir restante&rdquo; para ajustar os outros ramos.</p>
              </div>
            </Field>
          );
        })()}

        {node.type === 'distributor' && (
          <>
            <Field label="Como distribuir">
              <select className={inputCls} value={node.data.mode} onChange={(e) => set({ mode: e.target.value })}>
                <option value="round_robin">Rodízio — um de cada vez, em ordem</option>
                <option value="least_busy">Menos ocupado — quem tem menos conversas abertas</option>
                <option value="queue">Fila — devolve para “Aguardando”</option>
              </select>
            </Field>
            <Field label="Departamento (opcional)" hint={node.data.departmentId ? 'A conversa entra neste departamento e só os participantes dele concorrem.' : 'Vazio = não mexe no departamento da conversa.'}>
              <select className={inputCls} value={node.data.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || undefined, agentIds: [] })}>
                <option value="">Nenhum</option>
                {deptOptions(node.data.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}{d.isActive ? '' : ' (desativado)'}</option>)}
              </select>
            </Field>
            {node.data.mode !== 'queue' && (
              <Field label="Entre quais atendentes" hint={node.data.departmentId ? 'Nenhum marcado = todos os participantes ativos do departamento. Só recebe quem opera o número da conversa.' : 'Nenhum marcado = todos os ativos. Só recebe quem opera o número da conversa.'}>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {agents.data?.filter((a) => a.isActive && (!node.data.departmentId || a.departments?.some((x) => x.departmentId === node.data.departmentId))).map((a) => {
                    const on = node.data.agentIds?.includes(a.id) ?? false;
                    return <label key={a.id} className="flex items-center gap-2 text-ink"><input type="checkbox" checked={on} onChange={(e) => set({ agentIds: e.target.checked ? [...(node.data.agentIds ?? []), a.id] : (node.data.agentIds ?? []).filter((x) => x !== a.id) })} /> {a.name}</label>;
                  })}
                </div>
              </Field>
            )}
            <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">A conversa fica com o atendente escolhido e o fluxo segue pela saída <b>Distribuído</b> (ex.: avisar o contato e terminar). <b>Ninguém disponível</b> é usada quando nenhum atendente pode receber.</p>
          </>
        )}

        {node.type === 'end' && (
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={node.data.closeConversation} onChange={(e) => set({ closeConversation: e.target.checked })} /> Encerrar a conversa ao terminar</label>
        )}
      </div>
    </div>
  );
}
