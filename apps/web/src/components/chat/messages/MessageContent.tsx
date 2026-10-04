'use client';
import type { ReactNode } from 'react';
import { Forward } from 'lucide-react';
import type { Message } from '@/lib/hooks';
import { ButtonsMessage } from './ButtonsMessage';
import { ListMessage } from './ListMessage';
import { ContactMessage } from './ContactMessage';
import { LocationMessage } from './LocationMessage';
import { UnknownMessageFallback } from './UnknownMessageFallback';

/**
 * Corpo das mensagens que não são texto nem mídia. Devolve `null` quando a bolha deve seguir o
 * caminho comum (texto + mídia); quando devolve algo, ele já inclui o texto da mensagem.
 */
export function structuredBody(m: Message): ReactNode | null {
  const c = m.content;
  if (c?.kind === 'buttons') return <ButtonsMessage text={m.text} header={c.header} footer={c.footer} buttons={c.buttons} />;
  if (c?.kind === 'list') return <ListMessage text={m.text} header={c.header} footer={c.footer} buttonText={c.buttonText} sections={c.sections} />;
  if (c?.kind === 'location') return <LocationMessage {...c} text={m.text} />;
  if (c?.kind === 'contacts') return <><ContactMessage contacts={c.contacts} />{m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}</>;
  // tipo estruturado sem `content` (mensagem antiga, gravada antes deste mapeamento) ou unknown
  if (m.type === 'interactive' || m.type === 'unknown' || ((m.type === 'location' || m.type === 'contact') && !c)) {
    return <UnknownMessageFallback text={m.text} interactive={m.type === 'interactive'} />;
  }
  return null;
}

/** Selo "Encaminhada" no topo da bolha, como no WhatsApp. */
export function ForwardedLabel({ score }: { score?: number | null }) {
  const frequente = (score ?? 0) >= 5;
  return (
    <p className="flex items-center gap-1 text-[11px] italic opacity-70 mb-0.5">
      <Forward size={12} className="shrink-0" />
      {frequente ? 'Encaminhada com frequência' : 'Encaminhada'}
    </p>
  );
}
