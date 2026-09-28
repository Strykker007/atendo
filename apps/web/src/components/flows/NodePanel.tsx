'use client';
import { Trash2, Plus, X } from 'lucide-react';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { NODE_META } from './nodes';
import { useTags, useAgents, useServices, useProfessionals, useHasFeature } from '@/lib/hooks';
import { TextWithVars, type FlowVar } from './TextWithVars';
import type { FlowNode } from '@atendo/shared';

/** Painel lateral: edita os dados do bloco selecionado. Cada tipo tem seus campos. */
export function NodePanel({ node, onChange, onDelete, vars }: { node: FlowNode; onChange: (data: FlowNode['data']) => void; onDelete: () => void; vars: FlowVar[] }) {
  const tags = useTags();
  const agents = useAgents();
  const sched = useHasFeature('scheduling');
  const aiFeature = useHasFeature('ai_flows');
  const services = useServices();
  const pros = useProfessionals();
  const m = NODE_META[node.type];
  const set = (patch: Record<string, unknown>) => onChange({ ...(node.data as object), ...patch } as FlowNode['data']);

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
          <>
            <Field label="Texto">
              <TextWithVars value={node.data.text ?? ''} onChange={(v) => set({ text: v })} vars={vars} placeholder="Olá {{contact.name}}! …" />
            </Field>
            <p className="text-[11px] text-faint">Anexar imagem/arquivo ao bloco: em breve (use uma resposta rápida por enquanto).</p>
          </>
        )}

        {node.type === 'question' && (
          <>
            <Field label="Pergunta"><TextWithVars value={node.data.text} onChange={(v) => set({ text: v })} vars={vars} placeholder="Qual o seu e-mail?" /></Field>
            <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Este bloco cria uma variável</div>
              <Field label="Nome da variável" hint="Só letras, números e _ . A resposta do contato fica guardada aqui.">
                <input className={inputCls} value={node.data.varName} onChange={(e) => set({ varName: e.target.value.replace(/[^\w]/g, '_').toLowerCase() })} placeholder="email" />
              </Field>
              <p className="text-[11.5px] text-muted">Depois, em qualquer bloco, use <code className="font-mono bg-panel border border-line rounded px-1">{`{{${node.data.varName || 'nome'}}}`}</code> — ou clique em <b>Inserir variável</b> nos campos de texto.</p>
            </div>
            <Field label="Validação">
              <select className={inputCls} value={node.data.validation} onChange={(e) => set({ validation: e.target.value })}>
                <option value="none">Qualquer texto</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="number">Número</option>
              </select>
            </Field>
            <Field label="Mensagem se inválido"><TextWithVars multiline={false} value={node.data.invalidText ?? ''} onChange={(v) => set({ invalidText: v })} vars={vars} placeholder="Não entendi. Pode repetir?" /></Field>
            <Field label="Tentativas antes de desistir" hint="Depois disso, entrega para humano"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
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
            <p className="text-[11px] text-muted">A opção escolhida fica na variável <code className="font-mono bg-field rounded px-1">{`{{menu_${node.id}}}`}</code>.</p>
            <Field label="Tentativas" hint="Depois disso segue pela saída 'resposta inválida' ou entrega para humano"><input type="number" min={0} max={5} className={inputCls} value={node.data.maxRetries} onChange={(e) => set({ maxRetries: Number(e.target.value) })} /></Field>
          </>
        )}

        {node.type === 'condition' && (
          <>
            <Field label="Tipo">
              <select className={inputCls} value={node.data.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="var_equals">Variável é igual a</option><option value="var_contains">Variável contém</option><option value="has_tag">Conversa tem a tag</option><option value="business_hours">Está no horário comercial</option>
              </select>
            </Field>
            {(node.data.kind === 'var_equals' || node.data.kind === 'var_contains') && (
              <>
                <Field label="Variável">
                  <select className={inputCls} value={node.data.varName ?? ''} onChange={(e) => set({ varName: e.target.value })}>
                    <option value="">Escolha…</option>
                    {vars.map((v) => <option key={v.key} value={v.key}>{v.key} — {v.label}</option>)}
                  </select>
                  {vars.length === 0 && <span className="text-[11px] text-faint">Nenhuma variável ainda: adicione um bloco Perguntar antes.</span>}
                </Field>
                <Field label="Valor"><input className={inputCls} value={node.data.value ?? ''} onChange={(e) => set({ value: e.target.value })} /></Field>
              </>
            )}
            {node.data.kind === 'has_tag' && (
              <Field label="Tag"><select className={inputCls} value={node.data.tagId ?? ''} onChange={(e) => set({ tagId: e.target.value })}><option value="">Escolha…</option>{tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            )}
            {node.data.kind === 'business_hours' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Das"><input type="time" className={inputCls} value={node.data.hours?.start ?? '08:00'} onChange={(e) => set({ hours: { ...(node.data.hours ?? { days: [1, 2, 3, 4, 5], end: '18:00' }), start: e.target.value } })} /></Field>
                <Field label="Até"><input type="time" className={inputCls} value={node.data.hours?.end ?? '18:00'} onChange={(e) => set({ hours: { ...(node.data.hours ?? { days: [1, 2, 3, 4, 5], start: '08:00' }), end: e.target.value } })} /></Field>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => {
                    const days = node.data.hours?.days ?? [1, 2, 3, 4, 5];
                    const on = days.includes(i);
                    return <button key={i} type="button" onClick={() => set({ hours: { start: '08:00', end: '18:00', ...(node.data.hours ?? {}), days: on ? days.filter((d) => d !== i) : [...days, i] } })} className={`w-7 h-7 rounded-md text-xs font-semibold ${on ? 'bg-accent text-white' : 'bg-field text-muted'}`}>{l}</button>;
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {node.type === 'action' && (
          <>
            <Field label="Ação">
              <select className={inputCls} value={node.data.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="set_var">Definir variável</option><option value="add_tag">Aplicar tag</option><option value="remove_tag">Remover tag</option><option value="assign">Atribuir a atendente</option><option value="set_status">Mudar status</option><option value="handoff">Entregar para humano (fim do fluxo)</option>
              </select>
            </Field>
            {node.data.kind === 'set_var' && (
              <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Este bloco cria/atualiza uma variável</div>
                <Field label="Nome da variável"><input className={inputCls} value={node.data.varName ?? ''} onChange={(e) => set({ varName: e.target.value.replace(/[^\w]/g, '_').toLowerCase() })} placeholder="origem" /></Field>
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
            {node.data.kind === 'set_status' && (
              <Field label="Status"><select className={inputCls} value={node.data.status ?? 'waiting'} onChange={(e) => set({ status: e.target.value })}><option value="waiting">Aguardando</option><option value="in_progress">Em atendimento</option><option value="closed">Encerrado</option></select></Field>
            )}
          </>
        )}

        {node.type === 'schedule' && (
          !sched.has && !sched.loading ? <p className="text-sm text-muted rounded-lg bg-warn-soft px-3 py-2">Agendamento não está incluído no plano deste cliente. O bloco será ignorado (saída "Não conseguiu").</p> : (
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
            <p className="text-[11px] text-muted">Depois de agendar, as variáveis <code className="font-mono bg-field rounded px-1">{'{{agendamento}}'}</code>, <code className="font-mono bg-field rounded px-1">{'{{servico}}'}</code> e <code className="font-mono bg-field rounded px-1">{'{{profissional}}'}</code> ficam disponíveis. O contato pode responder "cancelar" a qualquer momento.</p>
          </>
          )
        )}

        {node.type === 'ai' && (
          !aiFeature.has && !aiFeature.loading ? <p className="text-sm text-muted rounded-lg bg-warn-soft px-3 py-2">IA nos fluxos não está incluída no plano deste cliente. O bloco será ignorado (saída "Não conseguiu").</p> : (
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
                  <textarea className={inputCls} rows={7} value={node.data.knowledge ?? ''} onChange={(e) => set({ knowledge: e.target.value })} placeholder={'Corte: R$ 45 (30 min)\nBarba: R$ 30\nEndereço: Rua X, 100\nFuncionamento: terça a sábado, 9h às 19h'} />
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

        {node.type === 'wait' && <Field label="Minutos"><input type="number" min={1} className={inputCls} value={node.data.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })} /></Field>}

        {node.type === 'end' && (
          <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={node.data.closeConversation} onChange={(e) => set({ closeConversation: e.target.checked })} /> Encerrar a conversa ao terminar</label>
        )}
      </div>
    </div>
  );
}
