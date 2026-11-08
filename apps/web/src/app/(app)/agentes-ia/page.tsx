'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { Bot, Download, Plus, Upload } from 'lucide-react';
import { downloadJson } from '@/lib/utils';
import type { AgentStage } from '@atendo/shared';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useAiAgents, useCan, useExportAiAgents, useHasFeature, useImportAiAgents, useSaveAiAgent } from '@/lib/hooks';
import { SectionTabs } from '@/components/layout/SectionTabs';

/** Roteiro de exemplo: dá ao cliente o formato das etapas para ele adaptar. */
const EXEMPLO: AgentStage[] = [
  {
    id: 'boas-vindas', name: 'Boas-vindas', tools: [],
    goal: 'Cumprimente pelo nome, se souber, e pergunte como pode ajudar. Não ofereça nada ainda.',
    transitions: [{ to: 'entender', when: 'o contato disse o que precisa' }],
  },
  {
    id: 'entender', name: 'Entender o pedido', tools: ['set_contact_field', 'add_tag'],
    goal: 'Descubra exatamente o que o contato quer (produto ou serviço, quantidade, prazo). Tire dúvidas só com o que está na base de conhecimento. Se ele disser o nome, salve.',
    transitions: [{ to: 'encaminhar', when: 'já está claro o que o contato quer e ele quer comprar ou agendar' }],
  },
  {
    id: 'encaminhar', name: 'Encaminhar', tools: ['transfer_department', 'close'],
    goal: 'Resuma o pedido em uma frase, avise que vai passar para a equipe finalizar e transfira para o departamento certo.',
    transitions: [],
  },
];

/**
 * Agentes de IA (docs/agente-ia.md): a IA atende como uma pessoa da equipe, seguindo um roteiro
 * em etapas. Entra no atendimento pelo bloco IA dos fluxos, no modo Agente.
 */
export default function AgentesIaPage() {
  const pode = useCan('flows.manage');
  const feature = useHasFeature('ai_flows');
  const agentes = useAiAgents(pode && feature.has);
  const save = useSaveAiAgent();
  const router = useRouter();
  const exportar = useExportAiAgents();
  const importar = useImportAiAgents();
  const arquivo = useRef<HTMLInputElement>(null);
  /** Exportar todos: o mesmo arquivo serve para outro cliente e para o modelo de perfil (docs/20). */
  const baixar = () => exportar.mutate(undefined, {
    onSuccess: ({ bundle, warnings }) => { downloadJson(bundle, `agentes-ia-${new Date().toISOString().slice(0, 10)}.json`); warnings.forEach((w) => toast.ok(w)); },
    onError: toast.err,
  });
  async function subir(f: File) {
    try {
      const r = await importar.mutateAsync(JSON.parse(await f.text()));
      toast.ok(`${r.created.length} agente(s) importado(s)`);
      r.warnings.forEach((w) => toast.ok(w));
    } catch (err) { toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err); }
  }

  if (!pode) return <PageShell width="max-w-3xl"><Empty icon={<Bot size={28} />} title="Sem permissão" text="Seu perfil de acesso não inclui montar fluxos e agentes." /></PageShell>;
  if (!feature.loading && !feature.has) return <PageShell width="max-w-3xl"><Empty icon={<Bot size={28} />} title="Fora do plano" text="Agentes de IA fazem parte de “IA nos fluxos”. Fale com o suporte para incluir no seu plano." /></PageShell>;

  const criar = (exemplo: boolean) =>
    save.mutate(
      exemplo
        ? { name: 'Atendente virtual', persona: 'Você é a Ana, atendente da empresa.', stages: EXEMPLO, maxReplies: 20 }
        : { name: 'Novo agente' },
      { onSuccess: (a) => router.push(`/agentes-ia/${a.id}`), onError: (e) => toast.err(e) },
    );

  return (
    <PageShell width="max-w-4xl">
      <PageHeader
        title="Agentes de IA"
        subtitle="A IA atende como uma pessoa da equipe, seguindo um roteiro em etapas. Cada etapa tem o seu prompt e as ações que ela pode fazer no sistema."
        action={<div className="flex flex-wrap gap-2">
          <input ref={arquivo} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subir(f); }} />
          <Button variant="ghost" icon={<Upload size={14} />} loading={importar.isPending} onClick={() => arquivo.current?.click()}>Importar</Button>
          {!!agentes.data?.length && <Button variant="ghost" icon={<Download size={14} />} loading={exportar.isPending} onClick={baixar}>Exportar</Button>}
          <Button onClick={() => criar(false)} loading={save.isPending}><Plus size={14} /> Novo agente</Button>
        </div>}
      />
      <SectionTabs section="fluxos" label="Fluxos e agentes de IA" />

      {agentes.isLoading ? <SkeletonRows /> : !agentes.data?.length ? (
        <div className="rounded-2xl border border-line bg-panel p-6 text-center space-y-3">
          <Bot size={28} className="mx-auto text-muted" />
          <p className="font-medium text-ink">Nenhum agente ainda</p>
          <p className="text-[13px] text-muted max-w-md mx-auto">Comece por um exemplo com três etapas (boas-vindas, entender o pedido, encaminhar) e adapte ao seu atendimento.</p>
          <Button variant="ghost" onClick={() => criar(true)} loading={save.isPending}>Começar com um exemplo</Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {agentes.data.map((a) => (
            <li key={a.id}>
              <Link href={`/agentes-ia/${a.id}`} className="block rounded-2xl border border-line bg-panel p-4 hover:bg-field/60">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-accent shrink-0" />
                  <p className="flex-1 font-medium text-ink truncate">{a.name}</p>
                  {!a.isActive && <span className="text-[11px] rounded bg-field text-muted px-1.5 py-0.5">desligado</span>}
                </div>
                <p className="mt-1 text-[12.5px] text-muted line-clamp-2">{a.persona || 'Sem persona definida.'}</p>
                <p className="mt-2 text-[12px] text-faint">{a.stages.length} etapa{a.stages.length === 1 ? '' : 's'}: {a.stages.map((s) => s.name).join(' → ')}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] text-faint">
        Para colocar um agente no atendimento, abra um fluxo, adicione o bloco <b>IA</b> e escolha <b>Atender como agente</b>.
        Cada resposta do agente consome uma interação de IA do plano.
      </p>
    </PageShell>
  );
}
