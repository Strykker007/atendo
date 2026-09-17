'use client';
import { Megaphone, Link2, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationOrigin, LeadReferral } from '@/lib/hooks';

export const ORIGIN_META: Record<ConversationOrigin, { label: string; icon: React.ReactNode | null; cls: string }> = {
  organic: { label: 'Orgânico', icon: null, cls: '' },
  ad: { label: 'Anúncio', icon: <Megaphone size={11} />, cls: 'bg-wait-soft text-wait' },
  post: { label: 'Publicação', icon: <Newspaper size={11} />, cls: 'bg-meta-soft text-meta-ink' },
  link: { label: 'Link', icon: <Link2 size={11} />, cls: 'bg-field text-muted' },
};

/** Chip "de onde veio o lead". Orgânico não mostra nada (é o padrão). */
export function OriginBadge({ origin, data, detailed }: { origin: ConversationOrigin; data?: LeadReferral | null; detailed?: boolean }) {
  const m = ORIGIN_META[origin];
  if (!m.icon) return null;
  const title = data?.headline ? `${m.label}: ${data.headline}` : m.label;
  const chip = (
    <span title={title} className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md', m.cls)}>
      {m.icon}{detailed && data?.headline ? `${m.label} · ${data.headline}` : m.label}
    </span>
  );
  return data?.sourceUrl && detailed ? <a href={data.sourceUrl} target="_blank" rel="noreferrer">{chip}</a> : chip;
}
