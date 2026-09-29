import { describe, expect, it } from 'vitest';
import { pickDefaultFlow, type DefaultFlowSettings, type InboundSituation } from '../src/modules/flows/default-flows';

const cfg = (over: Partial<DefaultFlowSettings> = {}): DefaultFlowSettings => ({
  welcomeFlowId: 'f-boas-vindas',
  closedFlowId: 'f-finalizada',
  defaultFlowId: 'f-padrao',
  defaultFlowInactivityHours: 24,
  ...over,
});
const sit = (over: Partial<InboundSituation> = {}): InboundSituation => ({
  isNewContact: false,
  returningAfterClosed: false,
  hoursSinceLastMessage: 1,
  ...over,
});

describe('pickDefaultFlow', () => {
  it('contato novo recebe boas-vindas', () => {
    expect(pickDefaultFlow(sit({ isNewContact: true, hoursSinceLastMessage: null }), cfg())).toEqual({ kind: 'welcome', flowId: 'f-boas-vindas' });
  });

  it('quem volta depois de encerrado recebe o fluxo de conversa finalizada', () => {
    expect(pickDefaultFlow(sit({ returningAfterClosed: true, hoursSinceLastMessage: 100 }), cfg())).toEqual({ kind: 'closed', flowId: 'f-finalizada' });
  });

  it('boas-vindas ganha de conversa finalizada (contato novo não "voltou")', () => {
    expect(pickDefaultFlow(sit({ isNewContact: true, returningAfterClosed: true }), cfg())?.kind).toBe('welcome');
  });

  it('resposta padrão só dispara após o período de inatividade', () => {
    expect(pickDefaultFlow(sit({ hoursSinceLastMessage: 23.9 }), cfg())).toBeNull();
    expect(pickDefaultFlow(sit({ hoursSinceLastMessage: 24 }), cfg())?.kind).toBe('default');
  });

  it('conversa em andamento NÃO recebe resposta padrão — o robô não fala por cima do atendente', () => {
    expect(pickDefaultFlow(sit({ hoursSinceLastMessage: 0.05 }), cfg())).toBeNull();
  });

  it('sem mensagem anterior, a resposta padrão vale', () => {
    expect(pickDefaultFlow(sit({ hoursSinceLastMessage: null }), cfg({ welcomeFlowId: null }))?.kind).toBe('default');
  });

  it('período zerado faz a resposta padrão valer sempre', () => {
    expect(pickDefaultFlow(sit({ hoursSinceLastMessage: 0 }), cfg({ defaultFlowInactivityHours: 0 }))?.kind).toBe('default');
  });

  it('cada fluxo não configurado é simplesmente ignorado', () => {
    expect(pickDefaultFlow(sit({ isNewContact: true }), cfg({ welcomeFlowId: null }))).toBeNull();
    expect(pickDefaultFlow(sit({ returningAfterClosed: true }), cfg({ closedFlowId: null, defaultFlowId: null }))).toBeNull();
  });

  it('nada configurado, nada dispara', () => {
    const vazio = cfg({ welcomeFlowId: null, closedFlowId: null, defaultFlowId: null });
    for (const s of [sit({ isNewContact: true }), sit({ returningAfterClosed: true }), sit({ hoursSinceLastMessage: 999 })]) {
      expect(pickDefaultFlow(s, vazio)).toBeNull();
    }
  });
});
