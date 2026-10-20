'use client';
import { CalendarClock } from 'lucide-react';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { ScheduleSection } from '@/components/settings/ScheduleSection';
import { EscalasTabs } from '@/components/escalas/EscalasTabs';
import { useCan } from '@/lib/hooks';

/**
 * Horário de atendimento da empresa (quadros, faixas e exceções). Morava em Configurações →
 * Atendimento; veio para junto das escalas porque é tudo horário (docs/escalas.md#telas).
 */
export default function HorarioAtendimentoPage() {
  const pode = useCan('settings.manage');
  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<CalendarClock size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui mudar o horário de funcionamento." /></PageShell>;
  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Horário de atendimento" subtitle="Quando a empresa atende. As faixas valem para as mensagens automáticas, os fluxos e os disparos." />
      <EscalasTabs />
      <ScheduleSection />
    </PageShell>
  );
}
