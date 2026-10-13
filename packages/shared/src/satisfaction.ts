/**
 * Pesquisa de satisfação enviada ao encerrar o atendimento (docs/pesquisa-de-satisfacao.md).
 *
 * Fica no shared porque a API monta a mensagem e lê a resposta, e a tela mostra a mesma
 * prévia — se cada lado escrevesse o seu texto, o que o cliente vê não seria o que a tela mostra.
 */

/** `scale_5` = 1 a 5 · `scale_10` = 1 a 10 (NPS) · `csat_3` = Ruim / Neutro / Bom */
export const SURVEY_SCALES = ['scale_5', 'scale_10', 'csat_3'] as const;
export type SurveyScale = (typeof SURVEY_SCALES)[number];

export const SURVEY_SCALE_LABEL: Record<SurveyScale, string> = {
  scale_5: 'Nota de 1 a 5',
  scale_10: 'Nota de 1 a 10 (NPS)',
  csat_3: 'Bom / Neutro / Ruim',
};

/** nota máxima de cada escala (a mínima é sempre 1; 0 é recusa) */
export const SURVEY_SCALE_MAX: Record<SurveyScale, number> = { scale_5: 5, scale_10: 10, csat_3: 3 };

/** opções da CSAT de 3 pontos: a nota é a posição (Ruim = 1) */
export const CSAT3_OPTIONS = [
  { score: 1, title: 'Ruim 😞' },
  { score: 2, title: 'Neutro 😐' },
  { score: 3, title: 'Bom 😀' },
] as const;

/** nota a partir da qual o cliente conta como satisfeito (base do "% satisfeitos") */
export const SURVEY_SATISFIED_FROM: Record<SurveyScale, number> = { scale_5: 4, scale_10: 9, csat_3: 3 };

/** id do botão de recusa na mensagem interativa */
export const SURVEY_DECLINE_ID = 'survey:decline';
export const surveyOptionId = (score: number) => `survey:${score}`;

export interface SurveyPromptConfig {
  scale: SurveyScale;
  question: string;
  allowDecline: boolean;
  declineLabel: string;
}

/**
 * Texto da pergunta + instrução de como responder. Na CSAT de 3 pontos as opções vão como
 * botões (`surveyInteractive`); nas notas vai só texto — 10 notas + recusa não cabem numa lista
 * da Meta, e no QR as opções viram lista numerada, que embaralharia "1 - 1", "2 - 2"…
 */
export function surveyPromptText(s: SurveyPromptConfig): string {
  const q = s.question.trim();
  if (s.scale === 'csat_3') {
    return s.allowDecline ? `${q}\n\nSe preferir não responder, digite *0* ou toque em “${s.declineLabel}”.` : q;
  }
  const max = SURVEY_SCALE_MAX[s.scale];
  const como = `Responda com uma nota de *1* a *${max}*${s.scale === 'scale_10' ? ` (${max} = recomendaria com certeza)` : ''}.`;
  return `${q}\n\n${como}${s.allowDecline ? `\nSe preferir não responder, digite *0*.` : ''}`;
}

/** Botões da CSAT de 3 pontos (+ recusa). Nas notas, nada: a resposta é digitada. */
export function surveyInteractive(s: SurveyPromptConfig): { options: { id: string; title: string }[] } | undefined {
  if (s.scale !== 'csat_3') return undefined;
  const options: { id: string; title: string }[] = CSAT3_OPTIONS.map((o) => ({ id: surveyOptionId(o.score), title: o.title }));
  if (s.allowDecline) options.push({ id: SURVEY_DECLINE_ID, title: s.declineLabel.slice(0, 20) });
  return { options };
}

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s/]/gu, ' ').replace(/\s+/g, ' ').trim();

const RECUSAS = new Set(['0', 'nao responder', 'nao quero responder', 'nao quero', 'prefiro nao responder', 'prefiro nao', 'pular', 'recusar', 'dispenso', 'agora nao']);
const CSAT3_PALAVRAS: Record<string, number> = {
  ruim: 1, pessimo: 1, pessima: 1, horrivel: 1, 'muito ruim': 1,
  neutro: 2, regular: 2, normal: 2, 'mais ou menos': 2, razoavel: 2,
  bom: 3, boa: 3, otimo: 3, otima: 3, excelente: 3, 'muito bom': 3, 'muito boa': 3,
};

export type SurveyAnswer = { kind: 'score'; score: number } | { kind: 'decline' };

/**
 * Lê a resposta à pergunta. `null` = não é resposta da pesquisa (o cliente mandou outra coisa,
 * "quanto custa o frete?"): a pesquisa sai do caminho e o atendimento reabre normalmente — é a
 * regra de não insistir.
 *
 * Aceita o toque no botão, o número ("8", "nota 8", "8/10", "8!") e, na CSAT, a palavra
 * ("bom", "Ótimo!"). No QR a CSAT chega como lista numerada com a recusa em 4º.
 */
export function parseSurveyAnswer(scale: SurveyScale, m: { text?: string | null; interactiveReplyId?: string | null }, allowDecline = true): SurveyAnswer | null {
  const max = SURVEY_SCALE_MAX[scale];
  const id = m.interactiveReplyId ?? '';
  if (id === SURVEY_DECLINE_ID) return { kind: 'decline' };
  const porId = /^survey:(\d{1,2})$/.exec(id);
  if (porId) {
    const n = Number(porId[1]);
    if (n >= 1 && n <= max) return { kind: 'score', score: n };
  }
  const t = normalizar(m.text ?? '');
  if (!t) return null;
  if (allowDecline && RECUSAS.has(t)) return { kind: 'decline' };
  if (scale === 'csat_3') {
    if (CSAT3_PALAVRAS[t]) return { kind: 'score', score: CSAT3_PALAVRAS[t] };
    if (allowDecline && t === '4') return { kind: 'decline' };
  }
  const num = /^(?:nota\s*)?(\d{1,2})(?:\s*\/\s*\d{1,2})?(?:\s*estrelas?)?$/.exec(t);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= max) return { kind: 'score', score: n };
  }
  return null;
}

/** Resposta ao "quer deixar um comentário?" que significa "não" — fecha sem comentário. */
export function isSurveyCommentSkip(text?: string | null): boolean {
  const t = normalizar(text ?? '');
  return !t || RECUSAS.has(t) || ['nao', 'n', 'nada', 'sem comentarios', 'sem comentario', 'nenhum', 'tudo certo', 'ok'].includes(t);
}

/** Textos com que uma pesquisa nova nasce na tela. */
export const SURVEY_DEFAULTS = {
  question: 'Olá, {{contact.first_name}}! Como você avalia o atendimento que recebeu?',
  declineLabel: 'Não responder',
  commentPrompt: 'Obrigado pela nota! Quer deixar um comentário? É só escrever (ou digite *0* para pular).',
  thanksMessage: 'Obrigado pela sua avaliação! 💚',
  declinedMessage: 'Tudo bem! Obrigado pelo contato. 😊',
  expiresHours: 24,
};
