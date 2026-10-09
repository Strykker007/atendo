import { describe, expect, it } from 'vitest';
import type { PlanLimits } from '@atendo/shared';
import { decideCanSend, quotaStatus } from '../src/modules/billing/quota';

const base: PlanLimits = {
  maxNumbers: 1,
  maxAgents: 3,
  includedMessagesMonth: 1000,
  includedTemplatesMonth: 100,
  overagePricePerMessage: 0.05,
  overagePricePerTemplate: 0.3,
  hardLimit: false,
  graceDays: 5,
};
const plano = (over: Partial<PlanLimits> = {}, status = 'active') => ({ limits: { ...base, ...over }, status });

describe('decideCanSend — unidade do plano', () => {
  const usoCompleto = (messages: number, conversations: number, templates = 0) => ({ messages, conversations, templates });

  it('plano por conversa limita por conversa, não por mensagem', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: 100, overagePricePerConversation: null, hardLimit: true });
    expect(decideCanSend(p, usoCompleto(999_999, 99), 'messages').ok).toBe(true);
    expect(decideCanSend(p, usoCompleto(0, 100), 'messages').ok).toBe(false);
  });

  it('a mensagem de bloqueio fala em conversas', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: 100, overagePricePerConversation: null, hardLimit: true });
    expect(decideCanSend(p, usoCompleto(0, 100), 'messages').reason).toContain('conversas');
  });

  it('excedente por conversa libera o envio', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: 100, overagePricePerConversation: 0.4, hardLimit: false });
    expect(decideCanSend(p, usoCompleto(0, 100), 'messages')).toEqual({ ok: true, overage: true });
  });

  it('template mantém limite próprio mesmo em plano por conversa', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: 1000, includedTemplatesMonth: 10, overagePricePerTemplate: null, hardLimit: true });
    expect(decideCanSend(p, usoCompleto(0, 0, 10), 'templates').ok).toBe(false);
    expect(decideCanSend(p, usoCompleto(0, 0, 10), 'messages').ok).toBe(true);
  });

  it('plano sem billingUnit continua limitando por mensagem (compatibilidade)', () => {
    const p = plano({ hardLimit: true });
    expect(decideCanSend(p, usoCompleto(1000, 0), 'messages').ok).toBe(false);
  });
});

describe('decideCanSend', () => {
  it('dentro do incluído, envia', () => {
    expect(decideCanSend(plano(), { messages: 999, templates: 0, conversations: 0 }, 'messages')).toEqual({ ok: true });
  });

  it('sem assinatura, não envia', () => {
    expect(decideCanSend(null, { messages: 0, templates: 0, conversations: 0 }, 'messages')).toMatchObject({ ok: false, reason: 'Sem assinatura ativa' });
  });

  it('assinatura suspensa ou cancelada não envia, mesmo com saldo', () => {
    for (const status of ['suspended', 'canceled']) {
      expect(decideCanSend(plano({}, status), { messages: 0, templates: 0, conversations: 0 }, 'messages')).toMatchObject({ ok: false, reason: 'Assinatura suspensa' });
    }
  });

  it('plano flexível: estourou o incluído, envia e cobra excedente', () => {
    const d = decideCanSend(plano({ hardLimit: false }), { messages: 1000, templates: 0, conversations: 0 }, 'messages');
    expect(d).toEqual({ ok: true, overage: true });
  });

  it('plano com limite rígido: estourou, bloqueia com motivo explicando o limite', () => {
    const d = decideCanSend(plano({ hardLimit: true }), { messages: 1000, templates: 0, conversations: 0 }, 'messages');
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('1000');
  });

  it('sem preço de excedente, bloqueia mesmo sem limite rígido (senão enviaríamos de graça)', () => {
    const d = decideCanSend(plano({ hardLimit: false, overagePricePerMessage: null }), { messages: 1000, templates: 0, conversations: 0 }, 'messages');
    expect(d.ok).toBe(false);
  });

  it('mensagens e templates têm contas separadas', () => {
    const uso = { messages: 5000, templates: 10, conversations: 0 };
    expect(decideCanSend(plano({ hardLimit: true }), uso, 'messages').ok).toBe(false);
    expect(decideCanSend(plano({ hardLimit: true }), uso, 'templates').ok).toBe(true);
  });

  it('template estourado sem preço de excedente bloqueia só o template', () => {
    const uso = { messages: 0, templates: 100, conversations: 0 };
    expect(decideCanSend(plano({ overagePricePerTemplate: null }), uso, 'templates').ok).toBe(false);
    expect(decideCanSend(plano({ overagePricePerTemplate: null }), uso, 'messages').ok).toBe(true);
  });

  it('a fronteira é exata: o de número igual ao incluído já é excedente', () => {
    const p = plano({ hardLimit: true, includedMessagesMonth: 10 });
    expect(decideCanSend(p, { messages: 9, templates: 0, conversations: 0 }, 'messages').ok).toBe(true);
    expect(decideCanSend(p, { messages: 10, templates: 0, conversations: 0 }, 'messages').ok).toBe(false);
  });

  it('plano com zero incluído e excedente cobrado envia sempre cobrando', () => {
    expect(decideCanSend(plano({ includedMessagesMonth: 0 }), { messages: 0, templates: 0, conversations: 0 }, 'messages')).toEqual({ ok: true, overage: true });
  });
});

describe('quotaStatus — o que a tela mostra', () => {
  const uso = (messages: number, conversations: number, templates = 0) => ({ messages, conversations, templates });

  it('plano por conversa ilimitado não acusa % por mensagens (caso Drog. mix: 1839/2000 virava 92%)', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: null, includedMessagesMonth: 2000, includedTemplatesMonth: null, overagePricePerMessage: null, hardLimit: true });
    const q = quotaStatus(p, uso(1839, 310))!;
    expect(q.ratio).toBeNull();
    expect(q.blocked).toBe(false);
    // nem passando das 2000 mensagens: o chat não pode travar
    expect(quotaStatus(p, uso(50_000, 310))!.blocked).toBe(false);
  });

  it('plano por conversa com teto usa as conversas', () => {
    const p = plano({ billingUnit: 'conversations', includedConversationsMonth: 500, includedMessagesMonth: 100, hardLimit: true });
    const q = quotaStatus(p, uso(9999, 460))!;
    expect(q.metric).toBe('conversations');
    expect(q.ratio).toBeCloseTo(0.92);
  });

  it('plano por mensagem segue por mensagem e bloqueia no hardLimit', () => {
    const p = plano({ includedTemplatesMonth: null, hardLimit: true, overagePricePerMessage: null });
    expect(quotaStatus(p, uso(920, 0))!.ratio).toBeCloseTo(0.92);
    const q = quotaStatus(p, uso(1000, 0))!;
    expect(q.blocked).toBe(true);
    expect(q.reason).toContain('mensagens');
  });

  it('templates entram no percentual mas só bloqueiam template', () => {
    const p = plano({ includedMessagesMonth: null, includedTemplatesMonth: 10, overagePricePerTemplate: null, hardLimit: true });
    const q = quotaStatus(p, uso(0, 0, 10))!;
    expect(q.metric).toBe('templates');
    expect(q.blocked).toBe(false);
    expect(q.templatesBlocked).toBe(true);
  });

  it('assinatura suspensa bloqueia com o motivo certo', () => {
    const q = quotaStatus(plano({}, 'suspended'), uso(0, 0))!;
    expect(q.blocked).toBe(true);
    expect(q.reason).toContain('suspensa');
  });
});
