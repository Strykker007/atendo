'use client';
import { useMemo, useState } from 'react';
import { AUTO_MESSAGE_VARS, type ContentItem } from '@atendo/shared';
import { useNumbers } from '@/lib/hooks';
import { ContentPanel } from '@/components/flows/ContentPanel';
import { FlowEditorRefs, type ProviderKind } from '@/components/flows/nodes';
import type { FlowVar } from '@/components/flows/TextWithVars';

/** Variáveis das mensagens automáticas (boas-vindas e faixas), além das do contato. */
export const AUTO_VARS: FlowVar[] = AUTO_MESSAGE_VARS.map((v) => ({ key: v.key, label: v.label, source: 'system' }));

/**
 * Editor de mensagens automáticas fora do editor de fluxos: o mesmo do bloco Conteúdo (texto com
 * formatação, imagem, vídeo, documento, áudio, intervalo), com os avisos dos provedores do cliente.
 */
export function AutoContentEditor({ items, onChange }: { items: ContentItem[]; onChange: (items: ContentItem[]) => void }) {
  const numbers = useNumbers();
  const [media, setMedia] = useState<Record<string, string>>({});
  const refs = useMemo(() => {
    const providers = [...new Set((numbers.data ?? []).map((n) => n.provider))] as ProviderKind[];
    return {
      mediaUrl: (key?: string) => (key ? media[key] : undefined),
      rememberMedia: (key: string, url: string) => setMedia((m) => ({ ...m, [key]: url })),
      providers: providers.length ? providers : (['meta', 'evolution'] as ProviderKind[]),
    };
  }, [numbers.data, media]);
  return (
    <FlowEditorRefs.Provider value={refs}>
      <ContentPanel items={items} onChange={onChange} vars={AUTO_VARS} />
    </FlowEditorRefs.Provider>
  );
}
