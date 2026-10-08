import type { FlowDefinition, FlowTrigger } from '@atendo/shared';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Fluxos com que todo cliente novo nasce: os atalhos manuais que a operação usa no dia a dia.
 * Vêm só com o Início e DESATIVADOS: a validação não deixa ativar um Início solto, e ativo ele
 * apareceria no chat — o atendente disparava, assumia a conversa e nada era enviado. O cliente
 * monta o conteúdo, ativa, e o atalho aparece. Desativado também não conta para `maxFlows`.
 */
const DEFAULT_FLOWS: { name: string; isPinned: boolean }[] = [
  { name: 'Boas Vindas', isPinned: false },
  { name: 'Boas Vindas - Entregas Encerradas', isPinned: false },
  { name: 'Boas Vindas - Entregas após 08:30', isPinned: false },
  { name: 'Loja Fechada', isPinned: false },
  { name: '🔄 TENTANDO CONTATO IA', isPinned: false },
  { name: '🟡🍼 CATÁLOGO DE FRALDAS', isPinned: true },
  { name: '🟡🔥 CATÁLOGO PERFUMARIA', isPinned: true },
  { name: '👹 OFERTAR PRODUTOS', isPinned: false },
];

const TRIGGER: FlowTrigger = { type: 'manual' };
const DEFINITION: FlowDefinition = { nodes: [{ id: 'start', type: 'start', position: { x: 40, y: 200 }, data: {} as never }], edges: [] };

export async function seedDefaultFlows(prisma: PrismaService, tenantId: string) {
  await prisma.flow.createMany({
    data: DEFAULT_FLOWS.map((f) => ({
      tenantId,
      name: f.name,
      isActive: false,
      isPinned: f.isPinned,
      showInChat: true,
      trigger: TRIGGER as object,
      definition: DEFINITION as object,
    })),
  });
}
