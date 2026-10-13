import { describe, expect, it } from 'vitest';
import { isSurveyCommentSkip, parseSurveyAnswer, surveyInteractive, surveyPromptText } from '@atendo/shared';

const t = (text: string) => ({ text });

describe('parseSurveyAnswer', () => {
  it.each([['5', 5], ['nota 4', 4], ['3!', 3], ['5 estrelas', 5], ['  2 ', 2]])('escala 5: "%s" = %i', (txt, n) => {
    expect(parseSurveyAnswer('scale_5', t(txt))).toEqual({ kind: 'score', score: n });
  });
  it.each(['6', '10', 'quanto custa o frete?', 'oi', ''])('escala 5: "%s" não é resposta', (txt) => {
    expect(parseSurveyAnswer('scale_5', t(txt))).toBeNull();
  });
  it('escala 10 aceita 10 e 8/10', () => {
    expect(parseSurveyAnswer('scale_10', t('10'))).toEqual({ kind: 'score', score: 10 });
    expect(parseSurveyAnswer('scale_10', t('8/10'))).toEqual({ kind: 'score', score: 8 });
  });
  it.each(['0', 'Não responder', 'pular', 'não quero'])('"%s" recusa', (txt) => {
    expect(parseSurveyAnswer('scale_10', t(txt))).toEqual({ kind: 'decline' });
  });
  it('sem recusa permitida, "0" não é resposta', () => {
    expect(parseSurveyAnswer('scale_5', t('0'), false)).toBeNull();
  });
  it('CSAT: botão, palavra e número da lista do QR', () => {
    expect(parseSurveyAnswer('csat_3', { interactiveReplyId: 'survey:3' })).toEqual({ kind: 'score', score: 3 });
    expect(parseSurveyAnswer('csat_3', { interactiveReplyId: 'survey:decline' })).toEqual({ kind: 'decline' });
    expect(parseSurveyAnswer('csat_3', t('Ótimo!'))).toEqual({ kind: 'score', score: 3 });
    expect(parseSurveyAnswer('csat_3', t('ruim'))).toEqual({ kind: 'score', score: 1 });
    expect(parseSurveyAnswer('csat_3', t('4'))).toEqual({ kind: 'decline' });
  });
});

describe('mensagem da pesquisa', () => {
  const base = { question: 'Como foi?', allowDecline: true, declineLabel: 'Não responder' };
  it('nota vai como texto com a instrução e o 0', () => {
    expect(surveyPromptText({ ...base, scale: 'scale_5' })).toContain('*1* a *5*');
    expect(surveyPromptText({ ...base, scale: 'scale_5' })).toContain('*0*');
    expect(surveyInteractive({ ...base, scale: 'scale_10' })).toBeUndefined();
  });
  it('CSAT vai com botões na ordem da nota + recusa', () => {
    expect(surveyInteractive({ ...base, scale: 'csat_3' })?.options.map((o) => o.id)).toEqual(['survey:1', 'survey:2', 'survey:3', 'survey:decline']);
    expect(surveyInteractive({ ...base, allowDecline: false, scale: 'csat_3' })?.options).toHaveLength(3);
  });
});

describe('isSurveyCommentSkip', () => {
  it.each(['0', 'não', 'Nada', 'ok'])('"%s" pula', (txt) => expect(isSurveyCommentSkip(txt)).toBe(true));
  it('texto de verdade vira comentário', () => expect(isSurveyCommentSkip('Demorou um pouco, mas resolveu')).toBe(false));
});
