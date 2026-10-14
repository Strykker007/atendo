'use client';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { useCan } from '@/lib/hooks';

/** Tela de recurso fora do plano (`useHasFeature`): explica o que é e leva para Plano e uso. */
export function FeatureLocked({ title, text }: { title: string; text: string }) {
  const podePlano = useCan('billing.manage');
  return (
    <PageShell width="max-w-3xl">
      <PageHeader title={title} />
      <div className="rounded-2xl border border-line bg-panel p-8 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={22} /></div>
        <p className="font-display font-semibold text-ink">Não incluído no seu plano</p>
        <p className="text-sm text-muted max-w-md mx-auto">{text}</p>
        {podePlano && <Link href="/plano"><Button>Ver planos</Button></Link>}
      </div>
    </PageShell>
  );
}
