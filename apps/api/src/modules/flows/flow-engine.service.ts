import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Conversation, FlowRun, Message, WhatsAppNumber } from '@prisma/client';
import type { FlowDefinition, FlowNode, FlowTrigger } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { SchedulingService } from '../scheduling/scheduling.service';
import { Inject, forwardRef } from '@nestjs/common';
import { choose, interpolate, validAnswer } from './answer';
import { AiService } from '../ai/ai.service';

export const QUEUE_FLOWS = 'flows';
export interface FlowResumeJob { runId: string }

const MAX_STEPS = 50; // proteção contra loop infinito num mesmo avanço

/**
 * Motor de fluxos. Um FlowRun anda pelo grafo até encontrar um nó que espera
 * (pergunta/menu → resposta do contato; aguardar → tempo) ou termina (fim/handoff).
 * Cada mensagem recebida numa conversa com run ativo chama `onInbound`.
 */
@Injectable()
export class FlowEngineService {
  private readonly log = new Logger(FlowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
    @Inject(forwardRef(() => SchedulingService)) private readonly scheduling: SchedulingService,
    private readonly ai: AiService,
    @InjectQueue(QUEUE_FLOWS) private readonly queue: Queue<FlowResumeJob>,
  ) {}

  // ---------- entrada ----------

  /** Dispara um fluxo numa conversa (manual ou por gatilho). Substitui run ativo, se houver. */
  async start(flowId: string, conversationId: string, startedById?: string) {
    const flow = await this.prisma.flow.findUnique({ where: { id: flowId } });
    if (!flow || !flow.isActive) throw new BadRequestException('Fluxo inexistente ou inativo');
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.tenantId !== flow.tenantId) throw new BadRequestException('Conversa não encontrada');
    const def = flow.definition as unknown as FlowDefinition;
    const startNode = def.nodes.find((n) => n.type === 'start');
    if (!startNode) throw new BadRequestException('Fluxo sem nó de início');

    await this.stop(conversationId, 'substituído por outro fluxo');
    const run = await this.prisma.flowRun.create({
      data: { tenantId: flow.tenantId, flowId: flow.id, conversationId, currentNodeId: startNode.id, startedById, vars: {} },
    });
    await this.markConversation(conversationId, run.id);
    await this.advance(run.id);
    return run;
  }

  /** Para o fluxo ativo da conversa (botão "Parar" ou handoff). */
  async stop(conversationId: string, reason = 'parado pelo atendente') {
    const active = await this.prisma.flowRun.findFirst({ where: { conversationId, status: { in: ['running', 'waiting'] } } });
    if (!active) return null;
    await this.prisma.flowRun.update({ where: { id: active.id }, data: { status: 'stopped', endedAt: new Date(), error: reason } });
    await this.markConversation(conversationId, null);
    return active;
  }

  /**
   * Chamado pelo InboundProcessor para toda mensagem recebida.
   * 1) run ativo esperando → entrega a resposta. 2) senão, avalia gatilhos (nova conversa / palavra-chave).
   */
  async onInbound(number: WhatsAppNumber, conversation: Conversation, message: Message, isNewConversation: boolean) {
    const active = await this.prisma.flowRun.findFirst({ where: { conversationId: conversation.id, status: { in: ['running', 'waiting'] } } });
    if (active) {
      if (active.status === 'waiting') await this.deliverAnswer(active, message);
      return;
    }
    const flows = await this.prisma.flow.findMany({ where: { tenantId: number.tenantId, isActive: true } });
    const text = (message.text ?? '').toLowerCase();
    for (const f of flows) {
      const t = f.trigger as unknown as FlowTrigger;
      const numberOk = !t.numberIds?.length || t.numberIds.includes(number.id);
      if (!numberOk) continue;
      if (t.type === 'new_conversation' && isNewConversation) return void (await this.start(f.id, conversation.id));
      if (t.type === 'keyword' && t.keywords?.some((k) => text.includes(k.toLowerCase()))) return void (await this.start(f.id, conversation.id));
    }
  }

  /** Job de "Aguardar" venceu. */
  async resume(runId: string) {
    const run = await this.prisma.flowRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== 'waiting') return;
    await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'running', waitUntil: null } });
    await this.next(runId, undefined);
  }

  // ---------- execução ----------

  private async load(runId: string) {
    const run = await this.prisma.flowRun.findUniqueOrThrow({ where: { id: runId }, include: { flow: true, conversation: { include: { contact: true, tags: true } } } });
    const def = run.flow.definition as unknown as FlowDefinition;
    return { run, def, node: def.nodes.find((n) => n.id === run.currentNodeId) };
  }

  private edgeFrom(def: FlowDefinition, nodeId: string, handle?: string) {
    return def.edges.find((e) => e.source === nodeId && (handle === undefined ? !e.sourceHandle : e.sourceHandle === handle)) ?? def.edges.find((e) => e.source === nodeId && !e.sourceHandle);
  }

  /** Vai para o próximo nó a partir do atual (pela saída `handle`) e executa. */
  private async next(runId: string, handle?: string) {
    const { run, def } = await this.load(runId);
    const edge = run.currentNodeId ? this.edgeFrom(def, run.currentNodeId, handle) : undefined;
    if (!edge) return this.finish(runId, 'done');
    await this.prisma.flowRun.update({ where: { id: runId }, data: { currentNodeId: edge.target, retries: 0 } });
    await this.advance(runId);
  }

  /** Executa nós em sequência até um que espere ou termine. */
  private async advance(runId: string) {
    for (let step = 0; step < MAX_STEPS; step++) {
      const { run, def, node } = await this.load(runId);
      if (run.status !== 'running') return;
      if (!node) return this.finish(runId, 'failed', `nó ${run.currentNodeId} não existe`);
      const vars = run.vars as Record<string, string>;
      const ctx = { contact: run.conversation.contact, vars };

      try {
        switch (node.type) {
          case 'start':
            await this.goNext(runId, def, node.id);
            continue;
          case 'message':
            await this.send(run.conversationId, node.data.text ? interpolate(node.data.text, ctx) : undefined, node.data);
            await this.goNext(runId, def, node.id);
            continue;
          case 'question':
            await this.send(run.conversationId, interpolate(node.data.text, ctx));
            await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting' } });
            return; // espera resposta do contato
          case 'menu':
            await this.sendMenu(run.conversationId, interpolate(node.data.text, ctx), node.data.options.map((o) => ({ id: o.id, title: o.label })));
            await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting' } });
            return;
          case 'condition': {
            const yes = await this.evaluate(node, run.conversation, vars);
            await this.goNext(runId, def, node.id, yes ? 'yes' : 'no');
            continue;
          }
          case 'action': {
            const ended = await this.act(node, run);
            if (ended) return;
            await this.goNext(runId, def, node.id);
            continue;
          }
          case 'wait': {
            const ms = Math.max(1, node.data.minutes) * 60_000;
            await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting', waitUntil: new Date(Date.now() + ms) } });
            await this.queue.add('resume', { runId }, { delay: ms, jobId: `resume-${runId}-${node.id}-${Date.now()}` });
            return;
          }
          case 'end':
            if (node.data.closeConversation) await this.conversations.setStatusSystem(run.conversationId, 'closed');
            return this.finish(runId, 'done');
          case 'ai': {
            await this.goNext(runId, def, node.id, await this.aiStep(run, node, ctx));
            continue;
          }
          case 'schedule': {
            // mini-máquina: serviço → profissional → horário → confirma. Estado em vars._sched
            const st = await this.scheduleStep(runId, node, run.conversationId, run.tenantId, vars, undefined);
            if (st === 'wait') { await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting' } }); return; }
            await this.goNext(runId, def, node.id, st);
            continue;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`run ${runId} nó ${node.id}: ${msg}`);
        return this.finish(runId, 'failed', msg);
      }
    }
    await this.finish(runId, 'failed', 'limite de passos excedido (loop?)');
  }

  private async goNext(runId: string, def: FlowDefinition, nodeId: string, handle?: string) {
    const edge = this.edgeFrom(def, nodeId, handle);
    if (!edge) {
      await this.finish(runId, 'done');
      // sinaliza para o loop parar: status deixa de ser running
      return;
    }
    await this.prisma.flowRun.update({ where: { id: runId }, data: { currentNodeId: edge.target, retries: 0 } });
  }

  /** Resposta do contato chegou num nó Perguntar/Menu. */
  private async deliverAnswer(run: FlowRun, message: Message) {
    const { def, node } = await this.load(run.id);
    if (!node) return this.finish(run.id, 'failed', 'nó atual inexistente');
    const answer = (message.text ?? '').trim();
    const replyId = (message.raw as { interactiveReplyId?: string } | null)?.interactiveReplyId;

    if (node.type === 'question') {
      if (!validAnswer(answer, node.data.validation)) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Não entendi. Pode repetir?');
      const vars = { ...(run.vars as Record<string, string>), [node.data.varName]: answer };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      return this.next(run.id, undefined);
    }
    if (node.type === 'menu') {
      const chosen = choose(node.data.options.map((o) => ({ id: o.id, title: o.label })), answer, replyId);
      if (!chosen) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Opção inválida. Responda com o número da opção.', 'fallback');
      const vars = { ...(run.vars as Record<string, string>), [`menu_${node.id}`]: chosen.title };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      return this.next(run.id, chosen.id);
    }
    if (node.type === 'schedule') {
      const st = await this.scheduleStep(run.id, node, run.conversationId, run.tenantId, run.vars as Record<string, string>, answer, replyId);
      if (st === 'wait') return; // continua esperando
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { status: 'running' } });
      return this.next(run.id, st);
    }
    // nó 'wait' recebendo mensagem: ignora, continua esperando o tempo
  }

  /**
   * Nó de IA. Devolve a saída a seguir: 'done' (respondeu), o id do rótulo (classificou)
   * ou 'fallback'. **Nunca lança**: se a IA falhar, o fluxo segue pelo fallback e o
   * contato é entregue a um humano em vez de ficar sem resposta.
   */
  private async aiStep(
    run: FlowRun & { conversation: Conversation & { contact: { name: string | null; phone: string } } },
    node: Extract<FlowNode, { type: 'ai' }>,
    ctx: { contact: { name: string | null; phone: string }; vars: Record<string, string> },
  ): Promise<string> {
    try {
      await this.ai.assertFeature(run.tenantId, 'ai_flows');
      const last = await this.prisma.message.findFirst({
        where: { conversationId: run.conversationId, direction: 'in' },
        orderBy: { createdAt: 'desc' },
        select: { text: true },
      });

      if (node.data.mode === 'classify') {
        const labels = node.data.labels ?? [];
        if (!last?.text?.trim() || !labels.length) return 'fallback';
        const answer = await this.ai.flowClassify({
          tenantId: run.tenantId,
          conversationId: run.conversationId,
          instructions: node.data.instructions,
          labels,
          text: last.text,
        });
        // o modelo responde o id; aceitamos também o rótulo por extenso
        const chosen = choose(labels.map((l) => ({ id: l.id, title: l.label })), answer);
        return chosen?.id ?? 'fallback';
      }

      const history = await this.prisma.message.findMany({
        where: { conversationId: run.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { direction: true, text: true, internal: true },
      });
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: run.tenantId }, select: { name: true } });
      const text = await this.ai.flowAnswer({
        tenantId: run.tenantId,
        conversationId: run.conversationId,
        businessName: tenant.name,
        instructions: interpolate(node.data.instructions, ctx),
        knowledge: node.data.knowledge,
        history: [...history].reverse(),
      });
      await this.send(run.conversationId, text);
      if (node.data.varName) {
        await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars: { ...ctx.vars, [node.data.varName]: text } } });
      }
      return 'done';
    } catch (err) {
      this.log.warn(`IA no fluxo ${run.flowId}: ${err instanceof Error ? err.message : err}`);
      if (node.data.fallbackText) await this.send(run.conversationId, node.data.fallbackText).catch(() => undefined);
      return 'fallback';
    }
  }

  /**
   * Passo do agendamento. Devolve 'wait' (mandou pergunta, espera resposta), 'done' (agendou)
   * ou 'fallback' (não conseguiu / desistiu). O estado fica em vars._sched (JSON).
   */
  private async scheduleStep(runId: string, node: Extract<FlowNode, { type: 'schedule' }>, conversationId: string, tenantId: string, vars: Record<string, string>, answer?: string, replyId?: string): Promise<'wait' | 'done' | 'fallback'> {
    type S = { step: 'service' | 'pro' | 'slot' | 'confirm'; serviceId?: string; professionalId?: string; services?: { id: string; name: string }[]; pros?: { id: string; name: string }[]; slots?: { startAt: string; label: string }[]; chosen?: { startAt: string; label: string } };
    const state: S = vars._sched ? JSON.parse(vars._sched) : { step: 'service' };
    const save = async (s: S) => { await this.prisma.flowRun.update({ where: { id: runId }, data: { vars: { ...vars, _sched: JSON.stringify(s) } } }); };
    const send = (t: string) => this.send(conversationId, t);
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const pick = <T extends { id: string; name: string }>(list: T[], a?: string) => choose(list.map((x) => ({ ...x, title: x.name })), a ?? '', replyId) as T | undefined;
    const asOpts = (items: { id: string; name: string }[]) => items.map((x) => ({ id: x.id, title: x.name.slice(0, 24), description: x.name.length > 24 ? x.name : undefined }));
    const cancelWords = /^(cancelar|sair|desistir|não|nao|parar)$/i;
    if (answer && cancelWords.test(answer.trim())) { await send('Tudo bem, agendamento cancelado. Se precisar, é só chamar.'); return 'fallback'; }

    // 1) serviço
    if (state.step === 'service') {
      if (node.data.serviceId) { state.serviceId = node.data.serviceId; state.step = 'pro'; }
      else if (!state.services) {
        const services = await this.prisma.service.findMany({ where: { tenantId, isActive: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
        if (!services.length) { await send('Ainda não há serviços cadastrados para agendar.'); return 'fallback'; }
        state.services = services.map((s) => ({ id: s.id, name: `${s.name} (${s.durationMin} min${Number(s.price) ? `, R$ ${Number(s.price).toFixed(0)}` : ''})` }));
        await save(state);
        await this.sendMenu(conversationId, node.data.intro ?? 'Vamos agendar! Qual serviço você quer?', asOpts(state.services), 'Ver serviços');
        return 'wait';
      } else {
        const c = pick(state.services, answer);
        if (!c) { await this.sendMenu(conversationId, 'Não entendi. Escolha o serviço:', asOpts(state.services), 'Ver serviços'); return 'wait'; }
        state.serviceId = c.id; state.step = 'pro';
      }
    }
    // 2) profissional
    if (state.step === 'pro') {
      if (node.data.professionalId) { state.professionalId = node.data.professionalId; state.step = 'slot'; }
      else if (!state.pros) {
        const pros = await this.prisma.professional.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
        if (!pros.length) { await send('Ainda não há profissionais cadastrados.'); return 'fallback'; }
        if (pros.length === 1) { state.professionalId = pros[0].id; state.step = 'slot'; }
        else {
          state.pros = pros.map((p) => ({ id: p.id, name: p.name }));
          await save(state);
          await this.sendMenu(conversationId, 'Com quem você prefere?', asOpts(state.pros), 'Ver profissionais');
          return 'wait';
        }
      } else {
        const c = pick(state.pros, answer);
        if (!c) { await this.sendMenu(conversationId, 'Escolha o profissional:', asOpts(state.pros), 'Ver profissionais'); return 'wait'; }
        state.professionalId = c.id; state.step = 'slot';
      }
    }
    // 3) horário
    if (state.step === 'slot') {
      if (!state.slots) {
        const slots = await this.scheduling.availability(tenantId, state.professionalId!, state.serviceId!, new Date(), undefined, Math.max(1, node.data.maxSlots || 6));
        if (!slots.length) { await send('Não encontrei horários livres nos próximos dias. Vou chamar alguém para te ajudar.'); return 'fallback'; }
        state.slots = slots.map((s) => ({ startAt: s.startAt.toISOString(), label: s.label }));
        await save(state);
        await this.sendMenu(conversationId, 'Estes são os próximos horários livres. Escolha um (ou responda "mais" para ver outros):', [...state.slots.map((s) => ({ id: s.startAt, title: s.label })), { id: '__more', title: 'Ver mais horários' }], 'Ver horários');
        return 'wait';
      }
      if (/^mais$/i.test((answer ?? '').trim())) {
        const last = new Date(state.slots[state.slots.length - 1].startAt);
        const more = await this.scheduling.availability(tenantId, state.professionalId!, state.serviceId!, last, undefined, Math.max(1, node.data.maxSlots || 6));
        if (!more.length) { await send('Não há mais horários nos próximos dias. Escolha um dos anteriores ou responda "cancelar".'); return 'wait'; }
        state.slots = more.map((s) => ({ startAt: s.startAt.toISOString(), label: s.label }));
        await save(state);
        await this.sendMenu(conversationId, 'Mais horários:', [...state.slots.map((s) => ({ id: s.startAt, title: s.label })), { id: '__more', title: 'Ver mais horários' }], 'Ver horários');
        return 'wait';
      }
      if (replyId === '__more' || Number(answer) === state.slots.length + 1) return this.scheduleStep(runId, node, conversationId, tenantId, vars, 'mais', undefined);
      const c = choose(state.slots.map((s) => ({ id: s.startAt, title: s.label })), answer ?? '', replyId);
      if (!c) { await send('Escolha um dos horários, responda "mais" para outros ou "cancelar".'); return 'wait'; }
      state.chosen = { startAt: c.id, label: c.title }; state.step = 'confirm';
      const svc = await this.prisma.service.findUniqueOrThrow({ where: { id: state.serviceId! } });
      const pro = await this.prisma.professional.findUniqueOrThrow({ where: { id: state.professionalId! } });
      await save(state);
      await this.sendMenu(conversationId, `Confirmar *${svc.name}* com *${pro.name}* em *${c.title}*?`, [{ id: 'yes', title: 'Sim, confirmar' }, { id: 'other', title: 'Outro horário' }]);
      return 'wait';
    }
    // 4) confirmação
    if (state.step === 'confirm') {
      const a = replyId === 'yes' ? '1' : replyId === 'other' ? '2' : (answer ?? '').trim();
      if (a === '2') { state.step = 'slot'; state.slots = undefined; state.chosen = undefined; await save(state); return this.scheduleStep(runId, node, conversationId, tenantId, { ...vars, _sched: JSON.stringify(state) }, undefined); }
      if (a !== '1' && !/^(sim|s|ok|confirmar)$/i.test(a)) { await this.sendMenu(conversationId, 'Confirma o horário?', [{ id: 'yes', title: 'Sim, confirmar' }, { id: 'other', title: 'Outro horário' }]); return 'wait'; }
      try {
        const appt = await this.scheduling.create(tenantId, { professionalId: state.professionalId!, serviceId: state.serviceId!, contactId: conv.contactId, startAt: new Date(state.chosen!.startAt), conversationId, source: 'flow' });
        const text = (node.data.confirmText ?? 'Agendado! {{servico}} com {{profissional}} em {{horario}}. Te lembro um dia antes. 💈')
          .replace('{{servico}}', appt.service.name).replace('{{profissional}}', appt.professional.name).replace('{{horario}}', state.chosen!.label);
        await send(text);
        await this.prisma.flowRun.update({ where: { id: runId }, data: { vars: { ...vars, _sched: undefined, agendamento: state.chosen!.label, servico: appt.service.name, profissional: appt.professional.name } } });
        return 'done';
      } catch (err) {
        // horário ocupado no meio tempo → oferece de novo
        state.step = 'slot'; state.slots = undefined; await save(state);
        await send(`${err instanceof Error ? err.message : 'Esse horário não está mais disponível.'}`);
        return this.scheduleStep(runId, node, conversationId, tenantId, { ...vars, _sched: JSON.stringify(state) }, undefined);
      }
    }
    return 'fallback';
  }

  private async retry(run: FlowRun, maxRetries: number, invalidText: string, fallbackHandle?: string) {
    const retries = run.retries + 1;
    if (retries > Math.max(0, maxRetries)) {
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { status: 'running', retries: 0 } });
      const { def } = await this.load(run.id);
      const fb = fallbackHandle && run.currentNodeId ? this.edgeFrom(def, run.currentNodeId, fallbackHandle) : undefined;
      if (fb && fb.sourceHandle === fallbackHandle) return this.next(run.id, fallbackHandle);
      // sem saída de fallback: entrega para humano
      await this.handoff(run.id, 'contato não respondeu como esperado');
      return;
    }
    await this.prisma.flowRun.update({ where: { id: run.id }, data: { retries } });
    const { node: cur } = await this.load(run.id);
    if (cur?.type === 'menu') await this.sendMenu(run.conversationId, invalidText, cur.data.options.map((o) => ({ id: o.id, title: o.label })));
    else await this.send(run.conversationId, invalidText);
  }

  // ---------- nós ----------

  private async act(node: Extract<FlowNode, { type: 'action' }>, run: FlowRun & { conversation: Conversation & { contact: { name: string | null; phone: string } } }): Promise<boolean> {
    const d = node.data;
    switch (d.kind) {
      case 'add_tag':
        if (!d.tagId) break;
        if (d.scope === 'contact') await this.prisma.contactTag.upsert({ where: { contactId_tagId: { contactId: run.conversation.contactId, tagId: d.tagId } }, create: { contactId: run.conversation.contactId, tagId: d.tagId }, update: {} });
        else await this.prisma.conversationTag.upsert({ where: { conversationId_tagId: { conversationId: run.conversationId, tagId: d.tagId } }, create: { conversationId: run.conversationId, tagId: d.tagId }, update: {} });
        break;
      case 'remove_tag':
        if (!d.tagId) break;
        if (d.scope === 'contact') await this.prisma.contactTag.deleteMany({ where: { contactId: run.conversation.contactId, tagId: d.tagId } });
        else await this.prisma.conversationTag.deleteMany({ where: { conversationId: run.conversationId, tagId: d.tagId } });
        break;
      case 'assign':
        if (d.agentId) await this.prisma.conversation.update({ where: { id: run.conversationId }, data: { assigneeId: d.agentId, status: 'in_progress' } });
        break;
      case 'set_status':
        if (d.status) await this.conversations.setStatusSystem(run.conversationId, d.status);
        break;
      case 'handoff':
        await this.handoff(run.id, 'transferido para humano pelo fluxo', d.agentId);
        return true;
      case 'set_var': {
        if (!d.varName) break;
        const vars = { ...(run.vars as Record<string, string>) };
        vars[d.varName] = interpolate(d.value ?? '', { contact: run.conversation.contact, vars });
        await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars } });
        return false;
      }
    }
    this.gateway.emitConversation(run.tenantId, await this.prisma.conversation.findUniqueOrThrow({ where: { id: run.conversationId } }));
    return false;
  }

  /** Entrega para humano: volta para a fila (ou atribui) e encerra o run. */
  private async handoff(runId: string, reason: string, agentId?: string) {
    const run = await this.prisma.flowRun.findUniqueOrThrow({ where: { id: runId } });
    await this.prisma.conversation.update({ where: { id: run.conversationId }, data: agentId ? { assigneeId: agentId, status: 'in_progress' } : { assigneeId: null, status: 'waiting' } });
    await this.finish(runId, 'done', reason);
  }

  private async evaluate(node: Extract<FlowNode, { type: 'condition' }>, conv: Conversation & { tags: { tagId: string }[] }, vars: Record<string, string>) {
    const d = node.data;
    switch (d.kind) {
      case 'var_equals':
        return (vars[d.varName ?? ''] ?? '').trim().toLowerCase() === (d.value ?? '').trim().toLowerCase();
      case 'var_contains':
        return (vars[d.varName ?? ''] ?? '').toLowerCase().includes((d.value ?? '').toLowerCase());
      case 'has_tag': {
        if (conv.tags.some((t) => t.tagId === d.tagId)) return true;
        return !!(await this.prisma.contactTag.findFirst({ where: { contactId: conv.contactId, tagId: d.tagId ?? '' } }));
      }
      case 'business_hours': {
        const h = d.hours ?? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] };
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const hm = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = h.start.split(':').map(Number);
        const [eh, em] = h.end.split(':').map(Number);
        return h.days.includes(now.getDay()) && hm >= sh * 60 + sm && hm < eh * 60 + em;
      }
    }
    return false;
  }

  private async send(conversationId: string, text?: string, media?: { mediaKey?: string; mediaType?: 'image' | 'document' | 'audio' | 'video'; mediaName?: string }) {
    if (!text && !media?.mediaKey) return;
    await this.conversations.sendAsSystem(conversationId, text, media?.mediaKey ? { key: media.mediaKey, type: media.mediaType ?? 'document', name: media.mediaName } : undefined);
  }

  /** Pergunta com opções: botões/lista na Meta, lista numerada na Evolution. */
  private async sendMenu(conversationId: string, text: string, options: { id: string; title: string; description?: string }[], listButton?: string) {
    await this.conversations.sendAsSystem(conversationId, text, undefined, { options, listButton });
  }

  private async finish(runId: string, status: 'done' | 'failed' | 'stopped', error?: string) {
    const run = await this.prisma.flowRun.update({ where: { id: runId }, data: { status, endedAt: new Date(), error } });
    await this.markConversation(run.conversationId, null);
  }

  private async markConversation(conversationId: string, runId: string | null) {
    const conv = await this.prisma.conversation.update({ where: { id: conversationId }, data: { activeFlowRunId: runId } });
    this.gateway.emitConversation(conv.tenantId, conv);
  }
}
