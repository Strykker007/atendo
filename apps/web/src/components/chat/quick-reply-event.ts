import type { Upload } from '@/lib/hooks';

/** Evento que os painéis de resposta rápida disparam; o ChatPane decide se envia ou insere no campo. */
export const QUICK_REPLY_EVENT = 'atendo:quick-reply';
/** `pixKeyId`: chave Pix cadastrada — a API monta o cartão "Copiar chave Pix"; `text` é a versão em texto */
export type QuickReplyEventDetail = { title: string; text: string; media?: Upload; pixKeyId?: string };
