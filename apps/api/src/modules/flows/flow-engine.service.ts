import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Conversation, FlowRun, Message, WhatsAppNumber } from '@prisma/client';
import { CONTENT_MAX_DELAY_SEC, DEPARTMENT_NONE, MAX_FLOW_HOPS, RETRIES_EXHAUSTED_HANDLE, REPLY_TIMEOUT_HANDLE, WEBHOOK_DEFAULT_TIMEOUT_SEC, WEBHOOK_ERROR_HANDLE, WEBHOOK_MAX_TIMEOUT_SEC, normalizeCondition, normalizeContent, type ContentItem, type FlowDefinition, type FlowNode, type FlowTrigger } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { botPaused } from '../conversations/bot-pause';
import { SchedulingService } from '../scheduling/scheduling.service';
import { Inject, forwardRef } from '@nestjs/common';
import { choose, interpolate, jsonEscape, validAnswer, type InterpolateCtx } from './answer';
import { pickBranch, type RuleEnv } from './conditions';
import { applyAssignments } from './variables';
import { afterAiAnswer } from './ai-turns';
import { onScheduleMiss } from './schedule-misses';
import { AiService } from '../ai/ai.service';
import { TenantSettingsService } from '../tenants/tenant-settings.service';
import { isOpenAt } from '../tenants/business-hours';
import { SchedulesService } from '../tenants/schedules.service';
import type { ScheduleNow } from '../tenants/schedule-clock';
import { planInbound } from './hours-gate';
import { callWebhook } from './webhook';
import { DISTRIBUTION_REASON, leastBusy, nextInRotation, pickWeighted } from './distribution';
import { pickDefaultFlow, type InboundSituation } from './default-flows';

export const QUEUE_FLOWS = 'flows';
export interface FlowResumeJob { runId: string }
/** Fim automático da pausa do robô. `pausedAt` (ISO) identifica a pausa: pausar de novo invalida o job antigo. */
export interface BotUnpauseJob { conversationId: string; tenantId: string; pausedAt: string }
/**
 * Tempo limite de resposta (Salvar/Menu). `until` (ISO) identifica a espera: só vale se o run
 * ainda está esperando no mesmo nó com o mesmo `waitUntil` — resposta, nova tentativa ou parada
 * no meio tornam o job antigo inofensivo.
 */
export interface ReplyTimeoutJob { runId: string; nodeId: string; until: string }
/** Intervalo entre mensagens automáticas (boas-vindas, faixa de horário): o resto da sequência, já interpolado. */
export interface AutoContentJob { conversationId: string; items: ContentItem[] }
export type FlowJob = FlowResumeJob | BotUnpauseJob | ReplyTimeoutJob | AutoContentJob;

const BOT_PAUSED_REASON = 'fluxo pausado na conversa';
const CLOSED_REASON = 'conversa encerrada';
type JobConv = { botPausedAt: Date | null; botPausedUntil: Date | null; status: string };
/**
 * Checagem de todo job do motor (Atraso, intervalo do Conteúdo, tempo limite) antes de agir:
 * robô pausado ou conversa encerrada encerram o run em vez de executar.
 */
const jobBlocked = (conv: JobConv) => (botPaused(conv) ? BOT_PAUSED_REASON : conv.status === 'closed' ? CLOSED_REASON : null);
const JOB_CONV = { select: { botPausedAt: true, botPausedUntil: true, status: true } } as const;
const MAX_STEPS = 50; // proteção contra loop infinito num mesmo avanço

/** Variáveis internas do motor (`_aiTurns`, `_sched`, `_content`) não seguem para o fluxo conectado. */
const HOPS_VAR = '_flowHops';
/** Conteúdo pausado no intervalo entre mensagens: `<id do nó>:<índice da próxima>`. */
const CONTENT_VAR = '_content';
const contentCursor = (vars: Record<string, string>, nodeId: string) => {
  const [id, idx] = (vars[CONTENT_VAR] ?? '').split(':');
  return id === nodeId && /^\d+$/.test(idx ?? '') ? Number(idx) : undefined;
};

/** Memoiza uma busca assíncrona: várias regras pedindo a mesma coisa = uma consulta. */
const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
};

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
    private readonly tenantSettings: TenantSettingsService,
    private readonly schedules: SchedulesService,
    @InjectQueue(QUEUE_FLOWS) private readonly queue: Queue<FlowJob>,
  ) {}

  // ---------- entrada ----------

  /**
   * Dispara um fluxo numa conversa (manual ou por gatilho). Substitui run ativo, se houver.
   * `vars`: variáveis iniciais (bloco "Conectar com outro fluxo" leva as do fluxo de origem).
   */
  async start(flowId: string, conversationId: string, startedById?: string, opts?: { vars?: Record<string, string> }) {
    const flow = await this.prisma.flow.findUnique({ where: { id: flowId } });
    if (!flow || !flow.isActive) throw new BadRequestException('Fluxo inexistente ou inativo');
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.tenantId !== flow.tenantId) throw new BadRequestException('Conversa não encontrada');
    if (botPaused(conv)) throw new BadRequestException('Os fluxos estão pausados nesta conversa. Retome para iniciar um fluxo.');
    const def = flow.definition as unknown as FlowDefinition;
    const startNode = def.nodes.find((n) => n.type === 'start');
    if (!startNode) throw new BadRequestException('Fluxo sem nó de início');

    await this.stop(conversationId, 'substituído por outro fluxo');
    const run = await this.prisma.flowRun.create({
      data: { tenantId: flow.tenantId, flowId: flow.id, conversationId, currentNodeId: startNode.id, startedById, vars: opts?.vars ?? {} },
    });
    await this.markConversation(conversationId, run.id);
    /**
     * Disparado por uma pessoa, o fluxo tira a conversa da fila.
     *
     * Antes o atendente mandava o fluxo rodar e a conversa continuava em "aguardando", como se
     * ninguém tivesse mexido: outro atendente pegava a mesma pessoa e os dois falavam junto
     * com o robô. Quem apertou o botão assumiu o atendimento — o robô está respondendo no
     * lugar dele, não no lugar de ninguém.
     */
    if (startedById && conv.status === 'waiting') {
      await this.conversations.setStatus(conv.tenantId, conversationId, 'in_progress', startedById);
    }
    await this.advance(run.id);
    return run;
  }

  /**
   * Fluxo escolhido no encerramento (pesquisa de satisfação, pós-venda). A conversa acabou
   * de ser fechada, então reabre em "encerrado→aguardando" só se o fluxo realmente falar —
   * `sendAsSystem` recusa conversa fechada, e travar o encerramento por causa disso seria pior.
   */
  async startOnClose(tenantId: string, conversationId: string, flowId: string) {
    const flow = await this.prisma.flow.findFirst({ where: { id: flowId, tenantId, isActive: true } });
    if (!flow) {
      this.log.warn(`Fluxo de encerramento ${flowId} não existe ou está inativo`);
      return null;
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'waiting' } });
    return this.start(flow.id, conversationId);
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
   * Pausa o robô SÓ nesta conversa: interrompe o run em andamento (sem retomar depois) e
   * agenda o fim automático. `minutes` nulo = até retomar manualmente.
   */
  async pauseBot(tenantId: string, conversationId: string, by: { id: string }, minutes: number | null) {
    const conv = await this.conversations.setBotPause(tenantId, conversationId, by, minutes);
    await this.stop(conversationId, BOT_PAUSED_REASON);
    if (conv.botPausedUntil && conv.botPausedAt) {
      await this.queue.add('unpause', { conversationId, tenantId, pausedAt: conv.botPausedAt.toISOString() }, {
        delay: Math.max(0, conv.botPausedUntil.getTime() - Date.now()),
        jobId: `unpause-${conversationId}-${conv.botPausedAt.getTime()}`,
        removeOnComplete: true,
      });
    }
    return conv;
  }

  /** Retomar pelo botão. A execução interrompida não volta: a próxima mensagem segue as regras de entrada. */
  resumeBot(tenantId: string, conversationId: string, by: { id: string }) {
    return this.conversations.clearBotPause(tenantId, conversationId, by);
  }

  /** Job do fim automático da pausa. */
  async autoResumeBot(job: BotUnpauseJob) {
    await this.conversations.clearBotPause(job.tenantId, job.conversationId, null, new Date(job.pausedAt));
  }

  /**
   * Chamado pelo InboundProcessor para toda mensagem recebida (docs/horarios.md → Comportamento).
   * 1) Faixa de horário atual do quadro do número decide: boas-vindas, resposta da faixa (uma vez
   *    por período), seguir ou parar. 2) Atendimento normal: run ativo esperando → entrega a
   *    resposta; senão gatilhos (nova conversa / palavra-chave) e fluxos padrão.
   */
  async onInbound(number: WhatsAppNumber, conversation: Conversation, message: Message, isNewConversation: boolean, situation?: InboundSituation) {
    const paused = botPaused(conversation);
    // pausa vencida e o job do fim ainda não rodou (fila atrasada): encerra aqui e segue normal
    if (!paused && conversation.botPausedAt) await this.conversations.clearBotPause(conversation.tenantId, conversation.id, null, conversation.botPausedAt);
    const [now, active] = await Promise.all([
      this.schedules.now(number.tenantId, number.id),
      this.prisma.flowRun.findFirst({ where: { conversationId: conversation.id, status: { in: ['running', 'waiting'] } } }),
    ]);
    const plan = planInbound({
      behavior: now.band.behavior,
      reply: now.band.reply,
      paused,
      newAttendance: isNewConversation || !!situation?.isNewContact || !!situation?.returningAfterClosed,
      activeRun: !!active,
    });

    const auto = new AutoReply(this, conversation, now);
    if (plan.welcome) await auto.welcome();
    if (plan.notifyFirst && (await auto.band()) === 'flow') return; // o fluxo da faixa assumiu
    await auto.flush();
    if (!plan.proceed) return;
    const handled = await this.normalEntry(number, conversation, message, isNewConversation, active, situation);
    if (!handled && plan.notifyIfUnhandled) {
      await auto.band();
      await auto.flush();
    }
  }

  /** Atendimento normal. Devolve se algum fluxo recebeu/assumiu a mensagem. */
  private async normalEntry(number: WhatsAppNumber, conversation: Conversation, message: Message, isNewConversation: boolean, active: FlowRun | null, situation?: InboundSituation): Promise<boolean> {
    if (active) {
      if (active.status === 'waiting') await this.deliverAnswer(active, message);
      return true;
    }
    const flows = await this.prisma.flow.findMany({ where: { tenantId: number.tenantId, isActive: true } });
    const text = (message.text ?? '').toLowerCase();
    for (const f of flows) {
      const t = f.trigger as unknown as FlowTrigger;
      const numberOk = !t.numberIds?.length || t.numberIds.includes(number.id);
      if (!numberOk) continue;
      if (t.type === 'new_conversation' && isNewConversation) return !!(await this.start(f.id, conversation.id));
      if (t.type === 'keyword' && t.keywords?.some((k) => text.includes(k.toLowerCase()))) return !!(await this.start(f.id, conversation.id));
    }

    // nenhum gatilho próprio casou: cai nos fluxos padrão do cliente
    if (!situation) return false;
    const settings = await this.tenantSettings.get(number.tenantId);
    const chosen = pickDefaultFlow(situation, settings);
    if (!chosen) return false;
    const flow = flows.find((f) => f.id === chosen.flowId);
    // fluxo apagado ou desativado: não trava a conversa, só registra
    if (!flow) {
      this.log.warn(`Fluxo padrão (${chosen.kind}) do tenant ${number.tenantId} não existe ou está inativo`);
      return false;
    }
    return !!(await this.start(flow.id, conversation.id));
  }

  /**
   * Resposta da faixa de horário (mensagem ou fluxo), **uma vez por conversa a cada período** da
   * faixa: a conversa guarda a chave do período (`scheduleNoticeKey`) e o update condicional
   * garante uma só mesmo com duas mensagens chegando juntas. Devolve o que foi feito.
   */
  async claimBandNotice(conversation: Conversation, now: ScheduleNow): Promise<{ kind: 'flow'; flowId: string } | { kind: 'message'; items: ContentItem[] } | null> {
    const band = now.band;
    if (band.behavior === 'normal') return null;
    let flowId: string | null = null;
    if (band.reply === 'flow') {
      const flow = band.flowId ? await this.prisma.flow.findFirst({ where: { id: band.flowId, tenantId: conversation.tenantId, isActive: true }, select: { id: true } }) : null;
      if (!flow) {
        this.log.warn(`Fluxo da faixa "${band.name}" (tenant ${conversation.tenantId}) não existe ou está inativo`);
        return null;
      }
      flowId = flow.id;
    } else if (!band.items.length) return null;
    const claimed = await this.prisma.conversation.updateMany({
      where: { id: conversation.id, OR: [{ scheduleNoticeKey: null }, { scheduleNoticeKey: { not: now.periodKey } }] },
      data: { scheduleNoticeKey: now.periodKey },
    });
    if (!claimed.count) return null;
    return flowId ? { kind: 'flow', flowId } : { kind: 'message', items: band.items };
  }

  /**
   * Mensagens automáticas (boas-vindas, resposta da faixa) fora de um fluxo: textos já
   * interpolados, enviados em ordem; intervalo entre mensagens vira job `auto-content`.
   * Não cria FlowRun — não aparece em execuções de fluxo.
   */
  async deliverAuto(conversationId: string, items: ContentItem[]) {
    for (let i = 0; i < items.length; i++) {
      const delay = i > 0 ? Math.min(CONTENT_MAX_DELAY_SEC, Math.max(0, Number(items[i].delay) || 0)) : 0;
      if (delay > 0) {
        const rest = items.slice(i).map((it, k) => (k === 0 ? { ...it, delay: 0 } : it));
        await this.queue.add('auto-content', { conversationId, items: rest }, { delay: delay * 1000, removeOnComplete: true });
        return;
      }
      await this.sendItem(conversationId, items[i], null).catch((err) => {
        this.log.warn(`Mensagem automática não enviada: ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  /** Job do intervalo entre mensagens automáticas. */
  autoContent(job: AutoContentJob) {
    return this.deliverAuto(job.conversationId, job.items);
  }

  /** Inicia o fluxo da faixa (chamado por `AutoReply`). */
  startBandFlow(flowId: string, conversationId: string) {
    return this.start(flowId, conversationId);
  }

  nextWelcome(tenantId: string) {
    return this.tenantSettings.nextWelcome(tenantId);
  }

  contactOf(conversation: Conversation) {
    return this.prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } });
  }

  /** Job de "Aguardar" (ou do intervalo entre mensagens do Conteúdo) venceu. */
  async resume(runId: string) {
    const run = await this.prisma.flowRun.findUnique({ where: { id: runId }, include: { conversation: JOB_CONV } });
    if (!run || run.status !== 'waiting') return;
    // a pausa já parou o run; isto cobre o job que venceu no meio do caminho
    const blocked = jobBlocked(run.conversation);
    if (blocked) return this.finish(runId, 'stopped', blocked);
    await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'running', waitUntil: null } });
    // Conteúdo no meio da sequência: continua no mesmo nó, da mensagem em que parou
    if (run.currentNodeId && contentCursor(run.vars as Record<string, string>, run.currentNodeId) !== undefined) return this.advance(runId);
    await this.next(runId, undefined);
  }

  /**
   * Tempo limite do Salvar/Menu venceu sem resposta. Disputa com a resposta do contato chegando
   * na mesma hora: quem virar o run de `waiting` para `running` primeiro (update condicional)
   * ganha; o outro não faz nada.
   */
  async replyTimeout(job: ReplyTimeoutJob) {
    const run = await this.prisma.flowRun.findUnique({ where: { id: job.runId }, include: { conversation: JOB_CONV } });
    if (!run || run.status !== 'waiting' || run.currentNodeId !== job.nodeId || run.waitUntil?.toISOString() !== job.until) return;
    const blocked = jobBlocked(run.conversation);
    if (blocked) return this.finish(run.id, 'stopped', blocked);
    const claimed = await this.prisma.flowRun.updateMany({ where: { id: run.id, status: 'waiting', currentNodeId: job.nodeId, waitUntil: new Date(job.until) }, data: { status: 'running', waitUntil: null, retries: 0 } });
    if (!claimed.count) return;
    const { def } = await this.load(run.id);
    // sem a saída "Não respondeu" ligada, o fluxo termina (não cai na saída de resposta)
    if (!def.edges.some((e) => e.source === job.nodeId && e.sourceHandle === REPLY_TIMEOUT_HANDLE)) return this.finish(run.id, 'done', 'contato não respondeu no tempo limite');
    await this.next(run.id, REPLY_TIMEOUT_HANDLE);
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
      if (botPaused(run.conversation)) return this.finish(runId, 'stopped', BOT_PAUSED_REASON);
      if (!node) return this.finish(runId, 'failed', `nó ${run.currentNodeId} não existe`);
      const vars = run.vars as Record<string, string>;
      const ctx = { contact: run.conversation.contact, vars };

      try {
        switch (node.type) {
          case 'start':
            await this.goNext(runId, def, node.id);
            continue;
          case 'message': {
            const items = normalizeContent(node.data);
            const resumeAt = contentCursor(vars, node.id);
            let paused = false;
            for (let i = resumeAt ?? 0; i < items.length; i++) {
              // intervalo antes da mensagem i (a primeira sai na hora; a retomada já esperou)
              const delay = i > 0 && i !== resumeAt ? Math.min(CONTENT_MAX_DELAY_SEC, Math.max(0, Number(items[i].delay) || 0)) : 0;
              if (delay > 0) {
                await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting', waitUntil: new Date(Date.now() + delay * 1000), vars: { ...vars, [CONTENT_VAR]: `${node.id}:${i}` } } });
                await this.queue.add('resume', { runId }, { delay: delay * 1000, jobId: `resume-${runId}-${node.id}-${i}-${Date.now()}` });
                paused = true;
                break;
              }
              await this.sendItem(run.conversationId, items[i], ctx);
            }
            if (paused) return;
            if (resumeAt !== undefined) {
              const { [CONTENT_VAR]: _done, ...rest } = vars;
              void _done;
              await this.prisma.flowRun.update({ where: { id: runId }, data: { vars: rest } });
            }
            await this.goNext(runId, def, node.id);
            continue;
          }
          case 'connect_flow':
            return this.connectFlow(run, node, vars);
          case 'question':
            // "Salvar" sem texto só espera: a pergunta veio de um bloco anterior
            if (node.data.text) await this.send(run.conversationId, interpolate(node.data.text, ctx));
            await this.awaitReply(runId, node);
            return; // espera resposta do contato
          case 'menu':
            await this.sendMenu(run.conversationId, interpolate(node.data.text, ctx), node.data.options.map((o) => ({ id: o.id, title: o.label })));
            await this.awaitReply(runId, node);
            return;
          case 'condition': {
            const handle = await this.evaluate(node, run.conversation, ctx);
            await this.goNext(runId, def, node.id, handle);
            continue;
          }
          case 'action': {
            const out = await this.act(node, run);
            if (out === 'ended') return;
            // webhook com falha: saída "Erro" se ligada (goNext cai na saída normal se não estiver)
            await this.goNext(runId, def, node.id, out);
            continue;
          }
          case 'wait': {
            const until = await this.waitUntil(run.tenantId, run.conversation.numberId, node);
            const ms = Math.max(0, until.getTime() - Date.now());
            await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting', waitUntil: until } });
            await this.queue.add('resume', { runId }, { delay: ms, jobId: `resume-${runId}-${node.id}-${Date.now()}` });
            return;
          }
          case 'variable': {
            const ops = node.data.assignments ?? [];
            // fuso só é buscado se alguma operação gravar a data/hora atual
            const timezone = ops.some((a) => a.op === 'now') ? (await this.tenantSettings.get(run.tenantId)).timezone : 'America/Sao_Paulo';
            const { vars: next, problems } = applyAssignments(vars, ops, { contact: ctx.contact, now: new Date(), timezone });
            if (problems.length) await this.warnTeam(run, `Manipulador: ${problems.join(' ')}`);
            await this.prisma.flowRun.update({ where: { id: runId }, data: { vars: next } });
            await this.goNext(runId, def, node.id);
            continue;
          }
          case 'randomizer': {
            const branch = pickWeighted(node.data.branches ?? []);
            if (!branch) return this.finish(runId, 'failed', 'randomizador sem ramos com peso');
            await this.goNext(runId, def, node.id, branch.id);
            continue;
          }
          case 'distributor': {
            const ok = await this.distribute(node, run);
            await this.goNext(runId, def, node.id, ok ? 'done' : 'fallback');
            continue;
          }
          case 'end':
            if (node.data.closeConversation) await this.conversations.setStatusSystem(run.conversationId, 'closed');
            return this.finish(runId, 'done');
          case 'ai': {
            const out = await this.aiStep(run, node, ctx);
            if (out === 'wait') {
              // modo conversa: fica no mesmo nó esperando a próxima mensagem do contato
              await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting' } });
              return;
            }
            await this.goNext(runId, def, node.id, out);
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

  /**
   * Espera a resposta do contato no Salvar/Menu. Com tempo limite, grava `waitUntil` e agenda o
   * job `reply-timeout`; cada nova espera (nova tentativa) recomeça a contagem.
   */
  private async awaitReply(runId: string, node: Extract<FlowNode, { type: 'question' | 'menu' }>) {
    const minutes = Math.max(0, Number(node.data.timeoutMinutes) || 0);
    let until: Date | null = null;
    if (minutes && node.data.timeoutBusinessHours) {
      // conta só dentro do horário de atendimento (quadro do número da conversa)
      const run = await this.prisma.flowRun.findUniqueOrThrow({ where: { id: runId }, select: { tenantId: true, conversation: { select: { numberId: true } } } });
      until = await this.schedules.addOpenMinutes(run.tenantId, run.conversation.numberId, new Date(), minutes);
    } else if (minutes) {
      until = new Date(Date.now() + minutes * 60_000);
    }
    await this.prisma.flowRun.update({ where: { id: runId }, data: { status: 'waiting', waitUntil: until } });
    if (until) {
      await this.queue.add('reply-timeout', { runId, nodeId: node.id, until: until.toISOString() }, { delay: Math.max(0, until.getTime() - Date.now()), jobId: `timeout-${runId}-${node.id}-${until.getTime()}`, removeOnComplete: true });
    }
  }

  /** Resposta do contato chegou num nó Perguntar/Menu. */
  private async deliverAnswer(run: FlowRun, message: Message) {
    // o contato respondeu: saltos entre fluxos daqui em diante não são loop automático
    if ((run.vars as Record<string, string>)[HOPS_VAR]) {
      const { [HOPS_VAR]: _hops, ...rest } = run.vars as Record<string, string>;
      void _hops;
      run = await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars: rest } });
    }
    const { def, node } = await this.load(run.id);
    if (!node) return this.finish(run.id, 'failed', 'nó atual inexistente');
    const answer = (message.text ?? '').trim();
    const replyId = (message.raw as { interactiveReplyId?: string } | null)?.interactiveReplyId;

    if (node.type === 'question' || node.type === 'menu') {
      // disputa com o tempo limite: só segue quem tirar o run de "waiting" primeiro
      const claimed = await this.prisma.flowRun.updateMany({ where: { id: run.id, status: 'waiting', currentNodeId: node.id }, data: { status: 'running', waitUntil: null } });
      if (!claimed.count) return;
    }
    if (node.type === 'question') {
      if (!validAnswer(answer, node.data.validation)) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Não entendi. Pode repetir?', RETRIES_EXHAUSTED_HANDLE);
      const vars = { ...(run.vars as Record<string, string>), [node.data.varName]: answer };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      if (node.data.contactField) await this.saveContactField(run.conversationId, node.data.contactField, answer);
      return this.next(run.id, undefined);
    }
    if (node.type === 'menu') {
      const chosen = choose(node.data.options.map((o) => ({ id: o.id, title: o.label })), answer, replyId);
      if (!chosen) return this.retry(run, node.data.maxRetries, node.data.invalidText ?? 'Opção inválida. Responda com o número da opção.', RETRIES_EXHAUSTED_HANDLE);
      const vars = { ...(run.vars as Record<string, string>), [`menu_${node.id}`]: chosen.title };
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars, status: 'running' } });
      return this.next(run.id, chosen.id);
    }
    if (node.type === 'ai') {
      const vars = run.vars as Record<string, string>;
      const out = await this.aiStep(run as never, node, { contact: { name: null, phone: '' }, vars });
      if (out === 'wait') return; // continua conversando
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { status: 'running' } });
      return this.next(run.id, out);
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

      // modo conversa: responde e espera a próxima mensagem, até o limite de turnos
      const turns = Number(ctx.vars._aiTurns ?? 0) + 1;
      const vars: Record<string, string> = { ...ctx.vars, _aiTurns: String(turns) };
      if (node.data.varName) vars[node.data.varName] = text;
      await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars } });

      const outcome = afterAiAnswer(turns, node.data);
      if (outcome === 'done' && node.data.keepTalking) {
        this.log.log(`IA atingiu o limite de ${turns} respostas no fluxo ${run.flowId}; seguindo pela saída normal`);
      }
      return outcome;
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
    type S = { step: 'service' | 'pro' | 'slot' | 'confirm'; serviceId?: string; professionalId?: string; services?: { id: string; name: string }[]; pros?: { id: string; name: string }[]; slots?: { startAt: string; label: string }[]; chosen?: { startAt: string; label: string }; misses?: number };
    const state: S = vars._sched ? JSON.parse(vars._sched) : { step: 'service' };
    const save = async (s: S) => { await this.prisma.flowRun.update({ where: { id: runId }, data: { vars: { ...vars, _sched: JSON.stringify(s) } } }); };
    const send = (t: string) => this.send(conversationId, t);
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const pick = <T extends { id: string; name: string }>(list: T[], a?: string) => choose(list.map((x) => ({ ...x, title: x.name })), a ?? '', replyId) as T | undefined;
    const asOpts = (items: { id: string; name: string }[]) => items.map((x) => ({ id: x.id, title: x.name.slice(0, 24), description: x.name.length > 24 ? x.name : undefined }));
    const cancelWords = /^(cancelar|sair|desistir|não|nao|parar)$/i;
    if (answer && cancelWords.test(answer.trim())) { await send('Tudo bem, agendamento cancelado. Se precisar, é só chamar.'); return 'fallback'; }

    /**
     * Resposta não entendida. Repetir o menu para sempre deixa o contato preso ouvindo
     * "não entendi" — depois de algumas tentativas, entrega para um humano.
     */
    const naoEntendi = async (repetir: () => Promise<void>): Promise<'wait' | 'fallback'> => {
      const r = onScheduleMiss(state.misses ?? 0);
      state.misses = r.misses;
      if (r.action === 'handoff') {
        await send('Vou chamar um atendente para te ajudar com o agendamento, um momento.');
        return 'fallback';
      }
      await save(state);
      await repetir();
      return 'wait';
    };

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
        if (!c) return naoEntendi(() => this.sendMenu(conversationId, 'Não entendi. Escolha o serviço:', asOpts(state.services!), 'Ver serviços'));
        state.serviceId = c.id; state.step = 'pro'; state.misses = 0;
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
        if (!c) return naoEntendi(() => this.sendMenu(conversationId, 'Escolha o profissional:', asOpts(state.pros!), 'Ver profissionais'));
        state.professionalId = c.id; state.step = 'slot'; state.misses = 0;
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
      if (!c) return naoEntendi(() => send('Escolha um dos horários, responda "mais" para outros ou "cancelar".'));
      state.chosen = { startAt: c.id, label: c.title }; state.step = 'confirm'; state.misses = 0;
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
      if (a !== '1' && !/^(sim|s|ok|confirmar)$/i.test(a)) {
        return naoEntendi(() => this.sendMenu(conversationId, 'Confirma o horário?', [{ id: 'yes', title: 'Sim, confirmar' }, { id: 'other', title: 'Outro horário' }]));
      }
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
    if (cur?.type !== 'menu' && cur?.type !== 'question') return;
    // volta a esperar ANTES de reenviar: resposta rápida do contato não pode achar o run "running"
    await this.awaitReply(run.id, cur);
    if (cur.type === 'menu') await this.sendMenu(run.conversationId, invalidText, cur.data.options.map((o) => ({ id: o.id, title: o.label })));
    else await this.send(run.conversationId, invalidText);
  }

  // ---------- nós ----------

  /** Devolve 'ended' (o run acabou aqui), a saída a seguir ('error' do webhook) ou undefined (saída normal). */
  private async act(node: Extract<FlowNode, { type: 'action' }>, run: FlowRun & { flow: { name: string }; conversation: Conversation & { contact: { name: string | null; phone: string } } }): Promise<'ended' | string | undefined> {
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
        return 'ended';
      case 'set_department': {
        // sem departamento escolhido = card importado ainda não reconfigurado: não mexe
        if (!d.departmentId) break;
        const ok = await this.conversations.setDepartmentSystem(run.conversationId, d.departmentId === DEPARTMENT_NONE ? null : d.departmentId);
        if (!ok) await this.warnTeam(run, 'Definir departamento: o departamento não existe mais ou está desativado. A conversa ficou no departamento em que estava.');
        break;
      }
      case 'webhook':
        return this.webhook(d, run);
      case 'set_var': {
        if (!d.varName) break;
        const vars = { ...(run.vars as Record<string, string>) };
        vars[d.varName] = interpolate(d.value ?? '', { contact: run.conversation.contact, vars });
        await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars } });
        return undefined;
      }
    }
    this.gateway.emitConversation(run.tenantId, await this.prisma.conversation.findUniqueOrThrow({ where: { id: run.conversationId } }));
    return undefined;
  }

  /**
   * Ação "Chamar webhook". Corpo vazio = JSON com o contexto da conversa (formato antigo); com
   * corpo, as {{variáveis}} entram com escape de JSON quando o corpo é JSON. Falha (rede, tempo
   * limite, endereço interno, status ≠ 2xx) → saída "Erro" (sem ela, segue pela normal, como
   * antes); a resposta guardada fica vazia.
   */
  private async webhook(d: Extract<FlowNode, { type: 'action' }>['data'], run: FlowRun & { conversation: { contact: InterpolateCtx['contact'] } }): Promise<string | undefined> {
    if (!d.url) return undefined; // URL removida na importação: o card mostra "Reconfigurar"
    const vars = { ...(run.vars as Record<string, string>) };
    const ctx = { contact: run.conversation.contact, vars };
    const method = d.method ?? 'POST';
    const headers = (d.headers ?? []).map((h) => ({ key: h.key, value: interpolate(h.value ?? '', ctx) }));
    const contentType = headers.find((h) => h.key.trim().toLowerCase() === 'content-type')?.value ?? 'application/json';
    const body = d.body?.trim()
      ? interpolate(d.body, ctx, /json/i.test(contentType) ? jsonEscape : undefined)
      : JSON.stringify({
        event: 'flow.webhook',
        flowId: run.flowId,
        conversationId: run.conversationId,
        contact: { name: run.conversation.contact.name, phone: run.conversation.contact.phone },
        vars: Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith('_'))),
      });
    const timeoutSec = Math.min(WEBHOOK_MAX_TIMEOUT_SEC, Math.max(1, Number(d.timeoutSec) || WEBHOOK_DEFAULT_TIMEOUT_SEC));
    let handle: string | undefined;
    try {
      const res = await callWebhook(interpolate(d.url, ctx, encodeURIComponent), { method, headers, body, timeoutMs: timeoutSec * 1000 });
      if (d.responseVar) vars[d.responseVar] = res.body;
    } catch (err) {
      // webhook fora do ar não para o atendimento: registra e sai por "Erro"
      this.log.warn(`webhook do fluxo ${run.flowId}: ${err instanceof Error ? err.message : err}`);
      if (d.responseVar) vars[d.responseVar] = '';
      handle = WEBHOOK_ERROR_HANDLE;
    }
    if (d.responseVar) await this.prisma.flowRun.update({ where: { id: run.id }, data: { vars } });
    return handle;
  }

  /**
   * Conectar com outro fluxo: este run termina e o destino começa do início, com as variáveis
   * deste (menos as internas). Destino apagado/desativado ou saltos demais seguidos (A → B → A…)
   * não saltam: registra, avisa a equipe e entrega a conversa para um atendente — quem já está
   * atribuído continua com ela; sem ninguém, vai para "Aguardando".
   */
  private async connectFlow(run: FlowRun & { flow: { name: string }; conversation: { assigneeId: string | null } }, node: Extract<FlowNode, { type: 'connect_flow' }>, vars: Record<string, string>) {
    const hops = Number(vars[HOPS_VAR] ?? 0) + 1;
    const target = node.data.flowId ? await this.prisma.flow.findFirst({ where: { id: node.data.flowId, tenantId: run.tenantId }, select: { id: true, name: true, isActive: true } }) : null;
    const problem = !target ? 'o fluxo de destino não existe mais (ou não foi escolhido)'
      : !target.isActive ? `o fluxo de destino "${target.name}" está desativado`
        : hops > MAX_FLOW_HOPS ? `${MAX_FLOW_HOPS} saltos seguidos entre fluxos sem resposta do contato (loop?)`
          : null;
    if (problem || !target) {
      const assignee = run.conversation.assigneeId ?? undefined;
      await this.warnTeam(run, `Conectar com outro fluxo: ${problem}. A automação parou e a conversa ${assignee ? 'ficou com o atendente atribuído' : 'foi para a fila'}.`);
      return this.handoff(run.id, `conectar fluxo: ${problem}`.slice(0, 1000), assignee);
    }
    const carried = Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith('_')));
    await this.finish(run.id, 'done', `seguiu para o fluxo "${target.name}"`);
    await this.start(target.id, run.conversationId, undefined, { vars: { ...carried, [HOPS_VAR]: String(hops) } });
  }

  /** Entrega para humano: volta para a fila (ou atribui) e encerra o run. */
  private async handoff(runId: string, reason: string, agentId?: string) {
    const run = await this.prisma.flowRun.findUniqueOrThrow({ where: { id: runId } });
    await this.prisma.conversation.update({ where: { id: run.conversationId }, data: agentId ? { assigneeId: agentId, status: 'in_progress' } : { assigneeId: null, status: 'waiting' } });
    await this.finish(runId, 'done', reason);
  }

  /** Condição: devolve a saída (id do ramo ou Senão). Aceita o formato antigo via `normalizeCondition`. */
  private async evaluate(node: Extract<FlowNode, { type: 'condition' }>, conv: Conversation & { tags: { tagId: string }[] }, ctx: InterpolateCtx) {
    const tenant = once(() => this.tenantSettings.get(conv.tenantId));
    const schedule = once(() => this.schedules.now(conv.tenantId, conv.numberId));
    const env: RuleEnv = {
      ...ctx,
      now: new Date(),
      timezone: async () => (await tenant()).timezone,
      lastMessage: once(async () => {
        const m = await this.prisma.message.findFirst({ where: { conversationId: conv.id, direction: 'in' }, orderBy: { createdAt: 'desc' }, select: { text: true } });
        return m?.text ?? '';
      }),
      hasTag: async (tagId) => {
        if (conv.tags.some((t) => t.tagId === tagId)) return true;
        return !!(await this.prisma.contactTag.findFirst({ where: { contactId: conv.contactId, tagId } }));
      },
      isOpen: async (hours) => {
        // horário próprio na regra (formato antigo): no fuso do cliente. Sem ele, vale o quadro de
        // horários do número da conversa — inclusive a chave "atendimento ativo".
        if (hours) {
          const t = await tenant();
          return isOpenAt({ now: new Date(), timezone: t.timezone, hours: hours.days.map((weekday) => ({ weekday, start: hours.start, end: hours.end })), attendanceActive: t.attendanceActive });
        }
        return (await schedule()).open;
      },
      currentBand: async () => (await schedule()).band.name,
    };
    return pickBranch(normalizeCondition(node.data), env);
  }

  /**
   * Quando o Atraso inteligente vence. 'duration': agora + tempo, empurrado para o horário de
   * atendimento se pedido. 'next_open': próxima abertura (agora, se já estiver aberto). O horário
   * é o quadro do número da conversa (ou o padrão do cliente) — docs/horarios.md.
   */
  private async waitUntil(tenantId: string, numberId: string, node: Extract<FlowNode, { type: 'wait' }>): Promise<Date> {
    if (node.data.mode === 'next_open') return this.schedules.nextOpen(tenantId, numberId, new Date());
    const due = new Date(Date.now() + Math.max(1, Number(node.data.minutes) || 1) * 60_000);
    return node.data.businessHours ? this.schedules.nextOpen(tenantId, numberId, due) : due;
  }

  /** Bloco "Salvar" com destino na ficha: o que o contato respondeu vira dado dele. */
  private async saveContactField(conversationId: string, field: 'name' | 'email' | 'address' | 'note1' | 'note2', value: string) {
    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { contactId: true } });
    await this.prisma.contact.update({ where: { id: conv.contactId }, data: { [field]: value.slice(0, 500) } });
  }

  /**
   * Distribuidor. Candidatos: os escolhidos no bloco (ou todos os ativos), sempre filtrados
   * por quem opera o número da conversa — atribuir a quem não enxerga o número esconderia o
   * atendimento. Com departamento no bloco, a conversa entra nele e só quem é do departamento
   * concorre. Devolve false quando ninguém pode receber (saída "Ninguém disponível").
   */
  private async distribute(node: Extract<FlowNode, { type: 'distributor' }>, run: FlowRun & { conversation: Conversation; flow: { name: string } }): Promise<boolean> {
    const conv = run.conversation;
    const departmentId = node.data.departmentId;
    if (departmentId) {
      // departamento excluído/desativado: não distribui para ninguém de fora dele — vai pela
      // saída "Ninguém disponível", com aviso para a equipe
      if (!(await this.conversations.setDepartmentSystem(conv.id, departmentId))) {
        await this.warnTeam(run, 'Distribuidor: o departamento escolhido não existe mais ou está desativado.');
        return false;
      }
    }
    if (node.data.mode === 'queue') {
      await this.conversations.setStatusSystem(conv.id, 'waiting');
      return true;
    }
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: run.tenantId,
        isActive: true,
        role: { not: 'super_admin' },
        ...(node.data.agentIds?.length && { id: { in: node.data.agentIds } }),
        // sem linha em user_numbers = opera todos os números
        OR: [{ numbers: { none: {} } }, { numbers: { some: { numberId: conv.numberId } } }],
        // com departamento: só quem é dele (aqui não vale "sem vínculo = todos": distribuir
        // Vendas para quem nunca foi posto em Vendas é justamente o que o bloco evita)
        ...(departmentId && { departments: { some: { departmentId } } }),
      },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    let chosen: string | undefined;
    if (node.data.mode === 'least_busy') {
      const open = await this.prisma.conversation.groupBy({ by: ['assigneeId'], where: { tenantId: run.tenantId, assigneeId: { in: ids }, status: { not: 'closed' } }, _count: { _all: true } });
      chosen = leastBusy(ids, Object.fromEntries(open.map((o) => [o.assigneeId!, o._count._all])));
    } else {
      const last = await this.prisma.conversationEvent.findFirst({
        where: { tenantId: run.tenantId, type: 'transferred', reason: DISTRIBUTION_REASON, targetId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { targetId: true },
      });
      chosen = nextInRotation(ids, last?.targetId);
    }
    if (!chosen) return false;
    const updated = await this.prisma.conversation.update({ where: { id: conv.id }, data: { assigneeId: chosen, status: conv.status === 'closed' ? 'closed' : 'in_progress' } });
    await this.prisma.conversationEvent.create({ data: { tenantId: run.tenantId, conversationId: conv.id, type: 'transferred', targetId: chosen, fromStatus: conv.status, toStatus: updated.status, reason: DISTRIBUTION_REASON } });
    this.gateway.emitConversation(run.tenantId, updated);
    return true;
  }

  private async send(conversationId: string, text?: string) {
    if (!text) return;
    await this.conversations.sendAsSystem(conversationId, text);
  }

  /** Uma mensagem do Conteúdo. Anexo removido na importação (`_reconfig`) é pulado; áudio não leva legenda. */
  private async sendItem(conversationId: string, it: ContentItem, ctx: InterpolateCtx | null) {
    // ctx nulo = texto já interpolado (mensagens automáticas)
    const text = it.text ? (ctx ? interpolate(it.text, ctx) : it.text) : undefined;
    if (it.kind === 'text') return this.send(conversationId, text);
    if (!it.mediaKey) return;
    const audio = it.kind === 'audio';
    await this.conversations.sendAsSystem(conversationId, audio ? undefined : text || undefined, { key: it.mediaKey, type: it.kind, name: it.mediaName, ...(audio && { voice: it.voice !== false }) });
  }

  /** Pergunta com opções: botões/lista na Meta, lista numerada na Evolution. */
  private async sendMenu(conversationId: string, text: string, options: { id: string; title: string; description?: string }[], listButton?: string) {
    await this.conversations.sendAsSystem(conversationId, text, undefined, { options, listButton });
  }

  /**
   * Algo no fluxo não saiu como desenhado, mas não é motivo para parar o atendimento.
   * A equipe precisa saber: nota interna na conversa (só a equipe vê) + aviso na execução
   * (aparece na lista de execuções do editor). Falhar em silêncio não é opção.
   */
  private async warnTeam(run: FlowRun & { flow: { name: string } }, text: string) {
    this.log.warn(`fluxo ${run.flowId} run ${run.id}: ${text}`);
    await this.prisma.flowRun.update({ where: { id: run.id }, data: { error: `aviso — ${text}`.slice(0, 1000) } });
    await this.conversations.systemNote(run.conversationId, `Fluxo "${run.flow.name}" — ${text}`).catch((err) => {
      this.log.warn(`nota de aviso do fluxo não gravada: ${err instanceof Error ? err.message : err}`);
    });
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

/**
 * Boas-vindas + resposta da faixa de uma mensagem recebida, numa sequência só: a resposta da
 * faixa entra depois das boas-vindas com pelo menos 1 s de intervalo (ordem de chegada).
 * Variáveis: `{{contact.*}}`, `{{faixa}}`, `{{proxima_abertura}}`.
 */
class AutoReply {
  private items: ContentItem[] = [];
  private ctx?: InterpolateCtx;
  constructor(private readonly engine: FlowEngineService, private readonly conv: Conversation, private readonly now: ScheduleNow) {}

  private async push(items: ContentItem[]) {
    this.ctx ??= { contact: await this.engine.contactOf(this.conv), vars: { faixa: this.now.band.name, proxima_abertura: this.now.nextOpenLabel } };
    const ctx = this.ctx;
    items.forEach((it, i) => {
      const delay = i === 0 && this.items.length ? Math.max(1, Number(it.delay) || 0) : it.delay;
      this.items.push({ ...it, text: it.text ? interpolate(it.text, ctx) : it.text, delay });
    });
  }

  async welcome() {
    const w = await this.engine.nextWelcome(this.conv.tenantId);
    if (w) await this.push(w.items);
  }

  /** Resposta da faixa, se ainda não saiu neste período. Fluxo: envia o que estiver pendente e inicia o fluxo. */
  async band(): Promise<'flow' | 'message' | null> {
    const r = await this.engine.claimBandNotice(this.conv, this.now);
    if (!r) return null;
    if (r.kind === 'message') {
      await this.push(r.items);
      return 'message';
    }
    await this.flush();
    try {
      await this.engine.startBandFlow(r.flowId, this.conv.id);
      return 'flow';
    } catch {
      return null;
    }
  }

  async flush() {
    if (!this.items.length) return;
    const items = this.items;
    this.items = [];
    await this.engine.deliverAuto(this.conv.id, items);
  }
}
