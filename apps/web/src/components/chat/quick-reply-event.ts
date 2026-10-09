import type { Upload } from '@/lib/hooks';

/** Evento que os painéis de resposta rápida disparam; o ChatPane decide se envia ou insere no campo. */
export const QUICK_REPLY_EVENT = 'atendo:quick-reply';
export type QuickReplyEventDetail = { title: string; text: string; media?: Upload };
