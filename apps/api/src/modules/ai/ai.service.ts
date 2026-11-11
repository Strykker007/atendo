import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AiTaskKind } from '@prisma/client';
import { PLAN_FEATURE_LABEL, type PlanFeature, type RewriteTone } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { UsageService } from '../billing/usage.service';
import { AiProviderRegistry } from './ai-provider.registry';
import { AiUsageService } from './ai-usage.service';
import { AiOwnKeyService, type OwnKey } from './ai-own-key';
import { AiCreditsService } from './ai-credits';
import { AiBusyError } from './ai-busy';
import { decideCanUseAi, decideWithCredit, platformBudgetStatus } from './ai-quota';
import { HISTORY_LIMIT, answerSystemPrompt, classifySystemPrompt, rewriteSystemPrompt, suggestSystemPrompt, summarySystemPrompt, toMessages, toTranscript, transcriptMessage } from './prompts';
import type { AiMessage, AiProvider } from './ai.types';
import { env } from '../../config/env';

interface RunInput {
  tenantId: string;
  kind: AiTaskKind;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  conversationId?: string;
  userId?: string;
}

@Injectable()
export class AiService {
  private readonly log = new AppLogger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
    private readonly aiUsage: AiUsageService,
    private readonly usage: UsageService,
    private readonly ownKeys: AiOwnKeyService,
    private readonly credits: AiCreditsService,
  ) {}

  /** IA utilizável por este tenant: a da plataforma ou a chave própria dele. */
  async available(tenantId: string) {
    return this.registry.configured || !!(await this.ownKeys.resolve(tenantId));
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
  async run(input: RunInput): Promise<string> {
    if (!input.messages.length) throw new BadRequestException('Não há mensagens suficientes para a IA trabalhar.');

    const plan = await this.usage.limits(input.tenantId);
    // chave do próprio cliente (ai_own_key): roda na conta dele — fora da cota, do teto e do
    // orçamento da plataforma; só a assinatura precisa estar ativa
    const own = await this.ownKeys.resolve(input.tenantId, plan?.limits.features ?? []);
    if (own) {
      if (!plan) throw new ForbiddenException('Sem assinatura ativa');
      if (plan.status === 'suspended' || plan.status === 'canceled') throw new ForbiddenException('Assinatura suspensa');
      try {
        return await this.call(input, this.registry.of(own.provider), own.model, { own });
      } catch (err) {
        // o grátis da chave própria (Gemini) acabou no dia: segue pela IA da plataforma pagando
        // com o saldo de IA, se o cliente deixou ligado (docs/15-ia.md#saldo-de-ia)
        if (!(err instanceof AiBusyError && err.daily) || !this.registry.configured) throw err;
        const w = await this.credits.wallet(input.tenantId);
        if (!w.autoUseOnFreeLimit || w.balanceBrl <= 0) throw err;
        this.log.log(`tenant ${input.tenantId}: chave própria no limite do dia, usando o saldo de IA (${input.kind})`);
        return this.platform(input, plan);
      }
    }
    return this.platform(input, plan);
  }

  /** IA da plataforma: incluído no plano → saldo de IA → excedente → bloqueia. */
  private async platform(input: RunInput, plan: Awaited<ReturnType<UsageService['limits']>>) {
    const provider = this.registry.get();
    const [used, platformSpent] = await Promise.all([this.aiUsage.current(input.tenantId), this.aiUsage.platformCost()]);
    // orçamento da plataforma antes da quota do tenant: protege o crédito da conta do fornecedor
    if (platformBudgetStatus(platformSpent, env.AI_PLATFORM_BUDGET_BRL).blocked) {
      throw new ServiceUnavailableException('IA temporariamente indisponível. Tente novamente mais tarde.');
    }
    const base = decideCanUseAi(plan, used);
    // só lê a carteira quando o incluído do plano não cobre
    const balance = base.ok && !base.overage ? 0 : (await this.credits.wallet(input.tenantId)).balanceBrl;
    const decision = decideWithCredit(plan, used, balance);
    if (!decision.ok) throw new ForbiddenException(decision.reason);
    const creditMarkupPct = decision.credit ? await this.credits.markupPct() : undefined;
    return this.call(input, provider, env.AI_MODEL || provider.defaultModel, { creditMarkupPct });
  }

  /** Chamada + ledger (sucesso e falha). */
  private async call(input: RunInput, provider: AiProvider, model: string, opts: { own?: OwnKey; creditMarkupPct?: number }) {
    const { own } = opts;
    const started = Date.now();
    const base = { tenantId: input.tenantId, kind: input.kind, provider: provider.kind, conversationId: input.conversationId, userId: input.userId, ownKey: !!own };
    try {
      const out = await provider.complete({
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens ?? env.AI_MAX_TOKENS,
        temperature: input.temperature,
        timeoutMs: env.AI_TIMEOUT_MS,
        ...(own && { apiKey: own.apiKey, model }),
      });
      await this.aiUsage.record({ ...base, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, latencyMs: Date.now() - started, creditMarkupPct: opts.creditMarkupPct });
      if (own?.hadError) await this.ownKeys.markError(input.tenantId, null);
      if (!out.text) throw new BadRequestException('A IA não devolveu resposta.');
      return out.text;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // registra a falha (sem custo) para aparecer no diagnóstico em vez de sumir
      await this.aiUsage.record({ ...base, model, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - started, error: reason.slice(0, 300) }).catch(() => undefined);
      // chave revogada / sem crédito na conta do cliente: a tela de configuração mostra o motivo.
      // Limite por minuto do plano grátis não é defeito da chave: não acende o aviso.
      if (own && !(err instanceof AiBusyError && !err.daily)) await this.ownKeys.markError(input.tenantId, reason);
      this.log.warn(`IA (${input.kind}${own ? ', chave própria' : ''}) falhou: ${reason}`, { kind: input.kind });
      throw err;
    }
  }

  // ---------- copiloto ----------

  private async conversationContext(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        tenant: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
        // apagada não entra no contexto da IA (docs/apagar-mensagens.md)
        messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT, select: { direction: true, text: true, internal: true } },
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
      system: suggestSystemPrompt({ businessName: conv.tenant.name, agentName: agent.name, contactName: conv.contact.name, contactPhone: conv.contact.phone }),
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

  /**
   * Resumo para quem vai assumir a conversa. Fica em cache na conversa, amarrado à última
   * mensagem: sem mensagem nova, devolve o salvo sem chamar a IA. `force` gera de novo.
   */
  async summary(tenantId: string, conversationId: string, agentId: string, force = false) {
    const cached = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: {
        summaryCache: true,
        summaryLastMessageId: true,
        summaryUpdatedAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    if (!cached) throw new BadRequestException('Conversa não encontrada');
    const lastMessageId = cached.messages[0]?.id ?? null;
    if (!force && cached.summaryCache && lastMessageId && cached.summaryLastMessageId === lastMessageId) {
      return { text: cached.summaryCache, updatedAt: cached.summaryUpdatedAt, cached: true };
    }

    const { history } = await this.conversationContext(tenantId, conversationId);
    const transcript = toTranscript(history);
    if (transcript.split('\n').length < 2) throw new BadRequestException('Conversa curta demais para resumir.');
    const text = await this.run({
      tenantId,
      kind: 'summary',
      conversationId,
      userId: agentId,
      system: summarySystemPrompt(),
      messages: [transcriptMessage(transcript, 'Resuma esta conversa.')],
      temperature: 0.2,
    });
    const updatedAt = new Date();
    // amarra à mensagem lida no início: se chegou outra durante a chamada, o próximo pedido regenera
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { summaryCache: text, summaryLastMessageId: lastMessageId, summaryUpdatedAt: updatedAt },
    });
    return { text, updatedAt, cached: false };
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
