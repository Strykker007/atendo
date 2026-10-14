import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type SatisfactionSurvey } from '@prisma/client';
import { isSurveyCommentSkip, parseSurveyAnswer, surveyInteractive, surveyPromptText, type SurveyExtraAnswer, type SurveyExtraQuestion, type SurveyScale } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InterpolationService } from '../../common/interpolation/interpolation.service';
import { ConversationsService } from '../conversations/conversations.service';
import { interpolate } from '../flows/answer';
import { UsageService } from '../billing/usage.service';

/** O que a resposta do cliente pede de volta (`followUp`). */
export interface SurveyClaim {
  responseId: string;
  tenantId: string;
  conversationId: string;
  step: 'ask_next' | 'ask_comment' | 'thanks' | 'declined';
  /** em `ask_next`: qual pergunta adicional (1 ou 2) */
  question?: number;
}

/**
 * Pesquisa de satisfação no encerramento (docs/pesquisa-de-satisfacao.md).
 *
 * Não é um fluxo de propósito: fluxo no encerramento reabre a conversa para poder falar, e a
 * pesquisa não pode devolver o atendimento para a fila — a pessoa só está dando uma nota. Aqui
 * a conversa continua encerrada do envio ao "obrigado"; a resposta entra no histórico sem
 * reabrir (`InboundService` chama `claim` antes de decidir).
 *
 * Sem insistência: uma pergunta, sem reenvio. Recusou ("0" ou botão) → acaba ali. Mandou outra
 * coisa ("e o frete?") ou passou do prazo → a pesquisa sai do caminho e a mensagem reabre o
 * atendimento como qualquer outra.
 */
@Injectable()
export class SurveyRunnerService {
  private readonly log = new Logger(SurveyRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly interpolation: InterpolationService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Qual pesquisa vai neste encerramento. `undefined` = a padrão da empresa (se houver);
   * `null` = o atendente desmarcou. Id inválido recusa ANTES de encerrar.
   */
  async resolve(tenantId: string, surveyId: string | null | undefined): Promise<SatisfactionSurvey | null> {
    if (surveyId === null) return null;
    // fora do plano: a padrão simplesmente não sai; pedir uma explicitamente é erro (antes de encerrar)
    const plano = await this.usage.limits(tenantId);
    if (!plano?.limits.features?.includes('satisfaction_surveys')) {
      if (surveyId === undefined) return null;
      throw new BadRequestException('"Pesquisa de satisfação" não está incluída no seu plano. Faça upgrade em Plano e uso.');
    }
    if (surveyId === undefined) return this.prisma.satisfactionSurvey.findFirst({ where: { tenantId, isActive: true, isDefault: true } });
    const s = await this.prisma.satisfactionSurvey.findFirst({ where: { id: surveyId, tenantId, isActive: true } });
    if (!s) throw new BadRequestException('Pesquisa de satisfação inválida ou desativada.');
    return s;
  }

  /**
   * Envia a pergunta na conversa recém-encerrada. A linha da resposta nasce ANTES do envio: o
   * cliente pode responder antes do worker confirmar. Falha no envio (desconectado, fora da
   * janela da Meta, descadastrado) fica como `failed` — não trava o encerramento.
   */
  async sendOnClose(tenantId: string, conversationId: string, survey: SatisfactionSurvey, agentId: string | null) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { contactId: true } });
    if (!conv) return null;
    // pesquisa anterior ainda aberta nesta conversa (outro atendimento): a nova substitui
    await this.prisma.surveyResponse.updateMany({ where: { conversationId, status: { in: ['pending', 'commenting'] } }, data: { status: 'expired', error: 'substituída por uma pesquisa nova' } });
    const agent = agentId ? await this.prisma.user.findFirst({ where: { id: agentId, tenantId }, select: { id: true, name: true } }) : null;
    const response = await this.prisma.surveyResponse.create({
      data: {
        tenantId,
        surveyId: survey.id,
        conversationId,
        contactId: conv.contactId,
        agentId: agent?.id ?? null,
        agentName: agent?.name ?? null,
        scale: survey.scale,
        // congela as adicionais: editar a pesquisa no meio não muda a pergunta que o cliente vai receber
        questions: (survey.extraQuestions ?? []) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + Math.max(1, survey.expiresHours) * 3_600_000),
      },
    });
    try {
      const ctx = await this.interpolation.forContact(tenantId, conv.contactId, {}, { agentName: agent?.name });
      const cfg = { scale: survey.scale as SurveyScale, question: interpolate(survey.question, ctx), allowDecline: survey.allowDecline, declineLabel: survey.declineLabel };
      await this.conversations.sendAsSystem(conversationId, surveyPromptText(cfg), undefined, surveyInteractive(cfg), { allowClosed: true, idempotencyKey: `survey-${response.id}` });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`Pesquisa ${response.id} não enviada: ${reason}`);
      await this.prisma.surveyResponse.update({ where: { id: response.id }, data: { status: 'failed', error: reason.slice(0, 500) } });
    }
    return response;
  }

  /**
   * A mensagem recebida é resposta da pesquisa aberta nesta conversa? Se for, grava e devolve o
   * próximo passo — e a conversa NÃO reabre. `null` = não é (ou não há pesquisa aberta): segue o
   * caminho normal. Chamado só com a conversa encerrada.
   *
   * Uma resposta do cliente gera no máximo UMA mensagem de volta (a próxima pergunta, o pedido de
   * comentário ou o agradecimento) — nunca "obrigado" + pergunta seguidos. É o que mantém a
   * pesquisa no ritmo de uma conversa normal, e cada envio ainda passa pela fila do número.
   */
  async claim(conversationId: string, msg: { type: string; text?: string | null; interactiveReplyId?: string | null }, at: Date): Promise<SurveyClaim | null> {
    const r = await this.prisma.surveyResponse.findFirst({ where: { conversationId, status: { in: ['pending', 'commenting'] } }, orderBy: { sentAt: 'desc' }, include: { survey: { select: { allowDecline: true, askComment: true } } } });
    if (!r) return null;
    const base = { responseId: r.id, tenantId: r.tenantId, conversationId };
    const extras = (r.questions as unknown as SurveyExtraQuestion[] | null) ?? [];
    const respondidas = (r.answers as unknown as SurveyExtraAnswer[] | null) ?? [];
    // guarda de status e passo em todo update: duas mensagens seguidas não podem gravar duas vezes
    const mover = (data: Prisma.SurveyResponseUpdateManyMutationInput) =>
      this.prisma.surveyResponse.updateMany({ where: { id: r.id, status: r.status, step: r.step }, data }).then((x) => x.count > 0);
    /** o que vem depois da pergunta `passo` (0 = principal): a próxima adicional, o comentário ou o fim */
    const depoisDe = (passo: number): { data: Prisma.SurveyResponseUpdateManyMutationInput; claim: SurveyClaim } =>
      passo < extras.length
        ? { data: { status: 'pending', step: passo + 1 }, claim: { ...base, step: 'ask_next', question: passo + 1 } }
        : r.survey.askComment
          ? { data: { status: 'commenting' }, claim: { ...base, step: 'ask_comment' } }
          : { data: { status: 'answered' }, claim: { ...base, step: 'thanks' } };

    if (r.expiresAt <= at) {
      // passou do prazo: nota já dada continua valendo (só o resto não veio)
      await mover(r.score != null ? { status: 'answered' } : { status: 'expired', error: 'sem resposta no prazo' });
      return null;
    }
    const texto = msg.type === 'text' || msg.type === 'interactive';
    if (r.status === 'pending' && r.step === 0) {
      const ans = texto ? parseSurveyAnswer(r.scale as SurveyScale, msg, r.survey.allowDecline) : null;
      if (!ans) {
        // falou de outra coisa: não insistimos, o atendimento reabre normalmente
        await mover({ status: 'expired', error: 'o cliente respondeu outra coisa' });
        return null;
      }
      if (ans.kind === 'decline') return (await mover({ status: 'declined', answeredAt: at })) ? { ...base, step: 'declined' } : null;
      const prox = depoisDe(0);
      return (await mover({ ...prox.data, score: ans.score, answeredAt: at })) ? prox.claim : null;
    }
    if (r.status === 'pending') {
      // pergunta adicional: a nota principal já está gravada, então daqui nada vira "recusa"
      const q = extras[r.step - 1];
      const ans = q && texto ? parseSurveyAnswer(q.scale, msg, r.survey.allowDecline) : null;
      if (!ans) {
        await mover({ status: 'answered' });
        return null;
      }
      // "0" numa adicional = pular o resto, sem perguntar mais nada
      if (ans.kind === 'decline') return (await mover({ status: 'answered' })) ? { ...base, step: 'thanks' } : null;
      const answers: SurveyExtraAnswer[] = [...respondidas, { questionId: q.id, question: q.text, scale: q.scale, score: ans.score }];
      const prox = depoisDe(r.step);
      return (await mover({ ...prox.data, answers: answers as unknown as Prisma.InputJsonValue })) ? prox.claim : null;
    }
    // comentário: áudio/foto não viram comentário — fecha a pesquisa e a mensagem reabre o atendimento
    if (!texto) {
      await mover({ status: 'answered' });
      return null;
    }
    const comment = isSurveyCommentSkip(msg.text) ? null : (msg.text ?? '').trim().slice(0, 1000);
    return (await mover({ status: 'answered', comment })) ? { ...base, step: 'thanks' } : null;
  }

  /**
   * Responde ao passo da pesquisa: próxima pergunta, pedido de comentário, agradecimento ou
   * resposta à recusa. Sai por `sendAsSystem` como mensagem automática (sem autor), então
   * respeita o intervalo do número, o teto de automáticas por hora e a rajada por conversa.
   */
  async followUp(c: SurveyClaim) {
    const r = await this.prisma.surveyResponse.findUnique({ where: { id: c.responseId }, include: { survey: true } });
    if (!r) return;
    const s = r.survey;
    try {
      const ctx = await this.interpolation.forContact(c.tenantId, r.contactId, {}, { agentName: r.agentName });
      if (c.step === 'ask_next') {
        const q = ((r.questions as unknown as SurveyExtraQuestion[] | null) ?? [])[(c.question ?? 1) - 1];
        if (!q) return;
        const cfg = { scale: q.scale, question: interpolate(q.text, ctx), allowDecline: s.allowDecline, declineLabel: s.declineLabel };
        await this.conversations.sendAsSystem(c.conversationId, surveyPromptText(cfg), undefined, surveyInteractive(cfg), { allowClosed: true, idempotencyKey: `survey-${r.id}-q${c.question}` });
        return;
      }
      const texto = c.step === 'ask_comment' ? s.commentPrompt : c.step === 'thanks' ? s.thanksMessage : s.declinedMessage;
      if (!texto?.trim()) return;
      await this.conversations.sendAsSystem(c.conversationId, interpolate(texto, ctx), undefined, undefined, { allowClosed: true, idempotencyKey: `survey-${r.id}-${c.step}` });
    } catch (err) {
      this.log.warn(`Pesquisa ${r.id} (${c.step}) não respondida: ${err instanceof Error ? err.message : err}`);
    }
  }
}
