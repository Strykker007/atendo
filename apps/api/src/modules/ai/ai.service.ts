import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { AiTaskKind } from '@prisma/client';
import { PLAN_FEATURE_LABEL, type PlanFeature, type RewriteTone } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { UsageService } from '../billing/usage.service';
import { AiProviderRegistry } from './ai-provider.registry';
import { AiUsageService } from './ai-usage.service';
import { decideCanUseAi } from './ai-quota';
import { HISTORY_LIMIT, answerSystemPrompt, classifySystemPrompt, rewriteSystemPrompt, suggestSystemPrompt, summarySystemPrompt, toMessages, toTranscript, transcriptMessage } from './prompts';
import type { AiMessage } from './ai.types';
import { env } from '../../config/env';

@Injectable()
export class AiService {
  private readonly log = new AppLogger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
    private readonly aiUsage: AiUsageService,
    private readonly usage: UsageService,
  ) {}

  get available() {
    return this.registry.configured;
  }

  /** Feature do plano — o guard cobre os endpoints; o motor de fluxos chama isto na mão. */
  async assertFeature(tenantId: string, feature: PlanFeature) {
    const plan = await this.usage.limits(tenantId);
    if (!plan?.limits.features?.includes(feature)) {
      throw new ForbiddenException(`"${PLAN_FEATURE_LABEL[feature]}" não está incluído no seu plano.`);
    }
  }

  /**
   * Chamada ao modelo com quota, teto de gasto e ledger. **Todo** uso de IA passa por aqui —
   * é o equivalente ao `UsageService.record` das mensagens.
   */
  async run(input: {
    tenantId: string;
    kind: AiTaskKind;
    system: string;
    messages: AiMessage[];
    maxTokens?: number;
    temperature?: number;
    conversationId?: string;
    userId?: string;
  }): Promise<string> {
    if (!input.messages.length) throw new BadRequestException('Não há mensagens suficientes para a IA trabalhar.');
    const provider = this.registry.get();

    const [plan, used] = await Promise.all([this.usage.limits(input.tenantId), this.aiUsage.current(input.tenantId)]);
    const decision = decideCanUseAi(plan, used);
    if (!decision.ok) throw new ForbiddenException(decision.reason);

    const started = Date.now();
    const model = env.AI_MODEL || provider.defaultModel;
    try {
      const out = await provider.complete({
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens ?? env.AI_MAX_TOKENS,
        temperature: input.temperature,
        timeoutMs: env.AI_TIMEOUT_MS,
      });
      await this.aiUsage.record({
        tenantId: input.tenantId,
        kind: input.kind,
        provider: provider.kind,
        model: out.model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        conversationId: input.conversationId,
        userId: input.userId,
        latencyMs: Date.now() - started,
      });
      if (!out.text) throw new BadRequestException('A IA não devolveu resposta.');
      return out.text;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // registra a falha (sem custo) para aparecer no diagnóstico em vez de sumir
      await this.aiUsage
        .record({ tenantId: input.tenantId, kind: input.kind, provider: provider.kind, model, tokensIn: 0, tokensOut: 0, conversationId: input.conversationId, userId: input.userId, latencyMs: Date.now() - started, error: reason.slice(0, 300) })
        .catch(() => undefined);
      this.log.warn(`IA (${input.kind}) falhou: ${reason}`, { kind: input.kind });
      throw err;
    }
  }

  // ---------- copiloto ----------

  private async conversationContext(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        tenant: { select: { name: true } },
        contact: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT, select: { direction: true, text: true, internal: true } },
      },
    });
    if (!conv) throw new BadRequestException('Conversa não encontrada');
    return { conv, history: [...conv.messages].reverse() };
  }

  /** Sugere a próxima resposta. O atendente revisa e envia — a IA nunca envia sozinha aqui. */
  async suggest(tenantId: string, conversationId: string, agent: { id: string; name: string }) {
    const { conv, history } = await this.conversationContext(tenantId, conversationId);
    const transcript = toTranscript(history);
    if (!transcript) throw new BadRequestException('A conversa ainda não tem mensagens para a IA ler.');
    return this.run({
      tenantId,
      kind: 'suggest',
      conversationId,
      userId: agent.id,
      system: suggestSystemPrompt({ businessName: conv.tenant.name, agentName: agent.name }),
      messages: [transcriptMessage(transcript, 'Escreva a próxima mensagem do ATENDIMENTO.')],
      temperature: 0.4,
    });
  }

  /** Reescreve o que o atendente digitou, sem inventar conteúdo novo. */
  async rewrite(tenantId: string, text: string, tone: RewriteTone, agentId: string, conversationId?: string) {
    const clean = text.trim();
    if (clean.length < 2) throw new BadRequestException('Escreva a mensagem antes de pedir para reescrever.');
    return this.run({
      tenantId,
      kind: 'rewrite',
      conversationId,
      userId: agentId,
      system: rewriteSystemPrompt(tone),
      messages: [{ role: 'user', content: clean.slice(0, 2000) }],
      temperature: 0.3,
    });
  }

  /** Resumo para quem vai assumir a conversa. */
  async summary(tenantId: string, conversationId: string, agentId: string) {
    const { history } = await this.conversationContext(tenantId, conversationId);
    const transcript = toTranscript(history);
    if (transcript.split('\n').length < 2) throw new BadRequestException('Conversa curta demais para resumir.');
    return this.run({
      tenantId,
      kind: 'summary',
      conversationId,
      userId: agentId,
      system: summarySystemPrompt(),
      messages: [transcriptMessage(transcript, 'Resuma esta conversa.')],
      temperature: 0.2,
    });
  }

  // ---------- usado pelo motor de fluxos ----------

  async flowAnswer(input: { tenantId: string; conversationId: string; businessName: string; instructions: string; knowledge?: string; history: { direction: 'in' | 'out'; text: string | null; internal?: boolean }[]; maxTokens?: number }) {
    const messages = toMessages(input.history);
    return this.run({
      tenantId: input.tenantId,
      kind: 'flow_answer',
      conversationId: input.conversationId,
      system: answerSystemPrompt({ businessName: input.businessName, instructions: input.instructions, knowledge: input.knowledge }),
      messages,
      maxTokens: input.maxTokens,
      temperature: 0.3,
    });
  }

  async flowClassify(input: { tenantId: string; conversationId: string; instructions: string; labels: { id: string; label: string }[]; text: string }) {
    return this.run({
      tenantId: input.tenantId,
      kind: 'flow_classify',
      conversationId: input.conversationId,
      system: classifySystemPrompt({ instructions: input.instructions, labels: input.labels }),
      messages: [{ role: 'user', content: input.text.slice(0, 2000) }],
      maxTokens: 20,
      temperature: 0,
    });
  }

  summaryOfUsage(tenantId: string) {
    return this.aiUsage.summary(tenantId);
  }
}
