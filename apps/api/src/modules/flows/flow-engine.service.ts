import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Conversation, FlowRun, Message, WhatsAppNumber } from '@prisma/client';
import type { FlowDefinition, FlowNode, FlowTrigger } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';

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
            await this.send(run.conversationId, node.data.text ? this.interpolate(node.data.text, ctx) : undefined, node.data);
            await this.goNext(runId, def, node.id);
            continue;
          case 'question':
          case 'menu': {
            const text = node.type === 'menu' ? this.menuText(node.data.text, node.data.options) : node.data.text;
            await this.send(run.conversationId, this.interpolate(text, ctx));
            await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting' } });
            return; // espera resposta do contato
          }
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

    if (node.type === 'question') {
      if (!this.valid(answer, node.data.validation)) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Não entendi. Pode repetir?');
      const vars = { ...(run.vars as Record<string, string>), [node.data.varName]: answer };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      return this.next(run.id, undefined);
    }
    if (node.type === 'menu') {
      const idx = Number(answer) - 1;
      const byNumber = Number.isInteger(idx) ? node.data.options[idx] : undefined;
      const byText = node.data.options.find((o) => o.label.toLowerCase() === answer.toLowerCase() || answer.toLowerCase().includes(o.label.toLowerCase()));
      const chosen = byNumber ?? byText;
      if (!chosen) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Opção inválida. Responda com o número da opção.', 'fallback');
      const vars = { ...(run.vars as Record<string, string>), [`menu_${node.id}`]: chosen.label };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      return this.next(run.id, chosen.id);
    }
    // nó 'wait' recebendo mensagem: ignora, continua esperando o tempo
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
    await this.send(run.conversationId, invalidText);
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
        vars[d.varName] = this.interpolate(d.value ?? '', { contact: run.conversation.contact, vars });
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

  private valid(answer: string, validation: 'none' | 'email' | 'phone' | 'number') {
    if (!answer) return false;
    if (validation === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer);
    if (validation === 'phone') return answer.replace(/\D/g, '').length >= 10;
    if (validation === 'number') return !Number.isNaN(Number(answer.replace(',', '.')));
    return true;
  }

  private menuText(text: string, options: { label: string }[]) {
    return `${text}\n\n${options.map((o, i) => `${i + 1} - ${o.label}`).join('\n')}`;
  }

  /** {{contact.name}}, {{contact.phone}}, {{nome_da_variavel}} */
  private interpolate(text: string, ctx: { contact: { name: string | null; phone: string }; vars: Record<string, string> }) {
    return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      if (key === 'contact.name') return ctx.contact.name ?? '';
      if (key === 'contact.phone') return ctx.contact.phone;
      return ctx.vars[key] ?? '';
    });
  }

  private async send(conversationId: string, text?: string, media?: { mediaKey?: string; mediaType?: 'image' | 'document' | 'audio' | 'video'; mediaName?: string }) {
    if (!text && !media?.mediaKey) return;
    await this.conversations.sendAsSystem(conversationId, text, media?.mediaKey ? { key: media.mediaKey, type: media.mediaType ?? 'document', name: media.mediaName } : undefined);
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
