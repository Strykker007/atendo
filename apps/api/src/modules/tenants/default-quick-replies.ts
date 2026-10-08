import type { PrismaService } from '../../common/prisma/prisma.service';

/** Pasta com que todo cliente novo nasce no painel de respostas rápidas. */
const FOLDER = 'Respostas padrão';

/**
 * Respostas rápidas com que todo cliente novo nasce: os atalhos que a operação usa no dia a dia.
 * Vêm só com o título — cada cliente escreve o texto (ou anexa o catálogo). Enquanto estiverem
 * vazias, o chat avisa em vez de enviar (QuickRepliesPanel): texto de exemplo chegaria no
 * contato de verdade.
 */
const DEFAULT_REPLIES: { title: string; isPinned: boolean }[] = [
  { title: 'Boas Vindas', isPinned: false },
  { title: 'Boas Vindas - Entregas Encerradas', isPinned: false },
  { title: 'Boas Vindas - Entregas após 08:30', isPinned: false },
  { title: 'Loja Fechada', isPinned: false },
  { title: '🔄 TENTANDO CONTATO IA', isPinned: false },
  { title: '🟡🍼 CATÁLOGO DE FRALDAS', isPinned: true },
  { title: '🟡🔥 CATÁLOGO PERFUMARIA', isPinned: true },
  { title: '👹 OFERTAR PRODUTOS', isPinned: false },
];

/**
 * Cria a pasta e as respostas padrão. `maxQuickReplies` do plano é respeitado: o que não cabe
 * fica de fora (fixadas primeiro), em vez de o cliente nascer acima do limite.
 */
export async function seedDefaultQuickReplies(prisma: PrismaService, tenantId: string, maxQuickReplies: number | null | undefined) {
  const room = maxQuickReplies ?? Infinity;
  const replies = [...DEFAULT_REPLIES]
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
    .slice(0, room)
    // de volta à ordem da lista: a posição na pasta é a ordem acima
    .sort((a, b) => DEFAULT_REPLIES.indexOf(a) - DEFAULT_REPLIES.indexOf(b));
  if (!replies.length) return;
  await prisma.quickReplyFolder.create({
    data: {
      tenantId,
      name: FOLDER,
      replies: { create: replies.map((r, position) => ({ title: r.title, body: '', isPinned: r.isPinned, position })) },
    },
  });
}
