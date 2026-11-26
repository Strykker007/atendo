/**
 * Conta de DEMONSTRAÇÃO de varejo (farmácia) para testar auditoria, relatórios e Kanban — SÓ banco local.
 * Tudo é fictício: nomes inventados e telefones com DDD 00 (impossíveis). Nada é enviado, e as
 * mensagens não passam pelo ledger de cobrança (não existem de verdade).
 *
 *   cd apps/api && npx tsx scripts/demo-loja.ts criar    # recria a conta do zero
 *   cd apps/api && npx tsx scripts/demo-loja.ts limpar   # remove a conta
 *
 * Login: carla@demo-loja.local / demo12345 (gestora). Atendentes: bruno@, lais@, rafael@, yasmin@.
 *
 * O que tem:
 * - 30 dias de atendimentos encerrados (venda e não venda, valor, motivo, etapa) → relatórios e auditoria;
 * - atendimentos "de auditoria", com falhas de conduta de propósito (ver `CASOS`): o caso do
 *   preservativo sem oferecer o lubrificante em promoção, resposta seca, demora, frete grátis esquecido…;
 * - atendimentos abertos hoje em etapas do Kanban, com origem, departamento, não lidas e donos variados
 *   → para testar os filtros do quadro.
 */
import 'reflect-metadata';
import { PrismaClient, Prisma, type ConversationOrigin } from '@prisma/client';
import * as argon2 from 'argon2';
import { CryptoService } from '../src/common/crypto/crypto.service';

const SLUG = 'demo-loja';
const SENHA = 'demo12345';
const DOMINIO = 'demo-loja.local';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url)) {
  console.error('Recusado: DATABASE_URL não é local.');
  process.exit(1);
}
const prisma = new PrismaClient();
const crypto = new CryptoService();

let semente = 11;
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const min = (n: number) => n * 60_000;

async function limpar() {
  const t = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!t) return false;
  const id = t.id;
  const convs = (await prisma.conversation.findMany({ where: { tenantId: id }, select: { id: true } })).map((c) => c.id);
  await prisma.$transaction([
    prisma.sale.deleteMany({ where: { tenantId: id } }),
    prisma.conversationEvent.deleteMany({ where: { tenantId: id } }),
    prisma.conversationTag.deleteMany({ where: { conversationId: { in: convs } } }),
    prisma.message.deleteMany({ where: { conversationId: { in: convs } } }),
    prisma.conversation.deleteMany({ where: { tenantId: id } }),
    prisma.contact.deleteMany({ where: { tenantId: id } }),
    prisma.closeReason.deleteMany({ where: { tenantId: id } }),
    prisma.tag.deleteMany({ where: { tenantId: id } }),
    prisma.whatsAppNumber.deleteMany({ where: { tenantId: id } }),
    prisma.user.deleteMany({ where: { tenantId: id } }),
    prisma.department.deleteMany({ where: { tenantId: id } }),
    prisma.planOverride.deleteMany({ where: { tenantId: id } }),
    prisma.subscription.deleteMany({ where: { tenantId: id } }),
    prisma.tenantSettings.deleteMany({ where: { tenantId: id } }),
    prisma.tenant.delete({ where: { id } }),
  ]);
  return true;
}

/** [quem, texto, minutos depois do início do atendimento] */
type Fala = [quem: 'c' | 'a', texto: string, minuto: number];
type Pessoa = { id: string; name: string };

/**
 * Atendimentos com falha de conduta de propósito — é o material para o gestor apontar.
 * `falha` não vai para o banco: é só o gabarito de quem testa.
 */
const CASOS: { falha: string; atendente: 0 | 1 | 2 | 3; depto: string; resultado: 'won' | 'lost'; valor?: number; produtos?: string; motivo: string; diasAtras: number; falas: Fala[] }[] = [
  {
    falha: 'Vendeu 10 preservativos e não ofereceu o lubrificante que estava em promoção',
    atendente: 0, depto: 'Vendas', resultado: 'won', valor: 89.9, produtos: '10x Preservativo lubrificado (cx 3un)', motivo: 'Compra concluída', diasAtras: 2,
    falas: [
      ['c', 'Oi, vocês têm preservativo? Queria 10 caixinhas.', 0],
      ['a', 'Oi! Temos sim, o lubrificado sai R$ 8,99 a caixa com 3.', 3],
      ['c', 'Pode separar 10. Entrega hoje?', 5],
      ['a', 'Separado! Entrega hoje até as 18h. Total R$ 89,90, pode ser no Pix?', 7],
      ['c', 'Pode, já mandei.', 9],
      ['a', 'Recebido, obrigado! Já saiu para entrega.', 11],
    ],
  },
  {
    falha: 'Cliente comprou fralda e o atendente não mencionou o frete grátis acima de R$ 150 (faltavam R$ 12)',
    atendente: 1, depto: 'Vendas', resultado: 'won', valor: 138, produtos: '2x Fralda G (pct 60)', motivo: 'Compra concluída', diasAtras: 3,
    falas: [
      ['c', 'Bom dia, tem fralda tamanho G daquela marca azul?', 0],
      ['a', 'Bom dia! Tem sim, R$ 69,00 o pacote com 60.', 4],
      ['c', 'Manda 2 então. Quanto fica o frete?', 6],
      ['a', 'Frete R$ 9,90. Total R$ 147,90.', 8],
      ['c', 'Ok, fechado.', 10],
    ],
  },
  {
    falha: 'Resposta seca e sem cumprimento; não perguntou se a receita estava válida',
    atendente: 2, depto: 'Receitas', resultado: 'lost', motivo: 'Desistiu', diasAtras: 4,
    falas: [
      ['c', 'Boa tarde! Vocês têm amoxicilina 500mg? Tenho a receita.', 0],
      ['a', 'tem', 14],
      ['c', 'Quanto custa? E precisa levar a receita na loja?', 15],
      ['a', 'R$ 32', 41],
      ['c', 'Ah, deixa, vou ver em outro lugar.', 43],
    ],
  },
  {
    falha: 'Demorou mais de 2 horas para responder no horário de pico e perdeu a venda',
    atendente: 3, depto: 'Vendas', resultado: 'lost', motivo: 'Parou de responder', diasAtras: 1,
    falas: [
      ['c', 'Oi, tem protetor solar FPS 50 para pele oleosa?', 0],
      ['c', 'Olá? Preciso para hoje, vou viajar.', 25],
      ['a', 'Oi! Temos sim, R$ 59,90. Ainda precisa?', 148],
    ],
  },
  {
    falha: 'Cliente achou caro e o atendente não ofereceu o genérico mais barato',
    atendente: 0, depto: 'Receitas', resultado: 'lost', motivo: 'Achou caro', diasAtras: 6,
    falas: [
      ['c', 'Quanto está o losartana 50mg com 30?', 0],
      ['a', 'Olá! O de referência está R$ 48,00.', 5],
      ['c', 'Nossa, caro. Obrigado.', 7],
      ['a', 'Por nada!', 8],
    ],
  },
  {
    falha: 'Atendimento exemplar: ofereceu complemento, confirmou endereço e agradeceu (para testar elogio)',
    atendente: 1, depto: 'Vendas', resultado: 'won', valor: 74.8, produtos: 'Vitamina C 1g + Própolis spray', motivo: 'Compra concluída', diasAtras: 5,
    falas: [
      ['c', 'Oi! Tem vitamina C efervescente?', 0],
      ['a', 'Oi, tudo bem? Temos sim! A de 1g com 10 comprimidos sai R$ 24,90.', 2],
      ['a', 'Se for para gripe, o própolis spray está com 20% esta semana: de R$ 62,40 por R$ 49,90. Quer que eu inclua?', 3],
      ['c', 'Boa, pode incluir os dois.', 5],
      ['a', 'Perfeito! Confirmo a entrega na Rua das Acácias, 120? Total R$ 74,80.', 6],
      ['c', 'Isso mesmo.', 7],
      ['a', 'Pedido confirmado, chega em até 1h. Obrigado pela preferência e melhoras! 💚', 8],
    ],
  },
  {
    falha: 'Prometeu entrega em 30 min sem consultar a fila de entregas; cliente reclamou depois',
    atendente: 2, depto: 'Vendas', resultado: 'won', valor: 45.5, produtos: 'Dipirona gotas + Soro fisiológico', motivo: 'Compra concluída', diasAtras: 8,
    falas: [
      ['c', 'Preciso de dipirona em gotas e soro, chega rápido?', 0],
      ['a', 'Chega em 30 minutinhos!', 2],
      ['c', 'Ótimo, pode mandar.', 3],
      ['c', 'Já faz 1h e nada… meu filho está com febre.', 65],
      ['a', 'Desculpa, o motoboy atrasou. Já está a caminho.', 72],
    ],
  },
];

async function criar() {
  if (await limpar()) console.log('Conta de demonstração anterior removida.');
  const plano = await prisma.plan.findFirst({ where: { name: 'Business' } }) ?? await prisma.plan.findFirst({ where: { isFree: false, isActive: true }, orderBy: { priceMonth: 'desc' } });
  if (!plano) throw new Error('Nenhum plano pago no banco local.');
  const limits = { ...(plano.limits as Record<string, unknown>) };
  limits.features = [...new Set([...(((limits.features as string[]) ?? [])), 'flows', 'campaigns', 'satisfaction_surveys', 'daily_report'])];

  const tenant = await prisma.tenant.create({ data: { name: 'Farmácia Bem-Estar', slug: SLUG, legalName: 'Farmácia Bem-Estar (demonstração)', notes: 'Conta fictícia para testar auditoria. scripts/demo-loja.ts' } });
  const T = tenant.id;
  await prisma.tenantSettings.create({ data: { tenantId: T, salesEnabled: true, welcomeEnabled: false } });
  const inicio = new Date(); inicio.setDate(1);
  const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
  await prisma.subscription.create({ data: { tenantId: T, planId: plano.id, status: 'active', currentPeriodStart: inicio, currentPeriodEnd: fim } });
  await prisma.planOverride.create({ data: { tenantId: T, planId: plano.id, limits: limits as Prisma.InputJsonValue, notes: 'demonstração' } });

  const numeros = await Promise.all([['Loja Centro', '#16A34A'], ['Loja Shopping', '#2F5BEA']].map(([label, color], i) => prisma.whatsAppNumber.create({
    data: {
      tenantId: T, label, color, phone: `55009000002${i}${i}`, provider: 'evolution', externalId: `demo-loja-${i}-${Date.now()}`, status: 'connected',
      providerConfig: crypto.encryptJson({ instanceName: `demo-loja-${i}` }), sessionStartedAt: new Date(Date.now() - 86_400_000 * 40),
    },
  })));
  const deptos = Object.fromEntries(await Promise.all(([['Vendas', '#16A34A'], ['Receitas', '#8B5CF6']] as const)
    .map(async ([name, color]) => [name, await prisma.department.create({ data: { tenantId: T, name, color } })])));

  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  const pessoa = (name: string, email: string, role: 'tenant_admin' | 'manager' | 'agent') =>
    prisma.user.create({ data: { tenantId: T, name, email: `${email}@${DOMINIO}`, passwordHash: hash, role, passwordSetAt: new Date() } });
  await pessoa('Carla Mendonça', 'carla', 'tenant_admin');
  const atendentes: Pessoa[] = [
    await pessoa('Bruno Alves', 'bruno', 'agent'),
    await pessoa('Laís Ferreira', 'lais', 'agent'),
    await pessoa('Rafael Costa', 'rafael', 'agent'),
    await pessoa('Yasmin Duarte', 'yasmin', 'agent'),
  ];

  // etapas do Kanban (transição) e uma permanente do contato
  const etapas = await Promise.all(([['Orçamento', '#F59E0B'], ['Separando pedido', '#3B82F6'], ['Aguardando pagamento', '#8B5CF6'], ['Saiu para entrega', '#10B981']] as const)
    .map(([name, color], position) => prisma.tag.create({ data: { tenantId: T, name, color, position, isKanban: true, kind: 'transition' } })));
  await prisma.tag.create({ data: { tenantId: T, name: 'Cliente fiel', color: '#EC4899', position: 10, isKanban: false, kind: 'permanent' } });
  const motivos = Object.fromEntries(await Promise.all(([
    ['Compra concluída', '#16A34A', 'won'], ['Achou caro', '#DC2626', 'lost'], ['Sem estoque', '#F97316', 'lost'], ['Desistiu', '#64748B', 'lost'], ['Parou de responder', '#94A3B8', 'lost'],
  ] as const).map(async ([name, color, outcome], position) => [name, await prisma.closeReason.create({ data: { tenantId: T, name, color, outcome, position } })])));

  let tel = 100;
  const contato = (name: string) => prisma.contact.create({ data: { tenantId: T, name, nameSource: 'manual', phone: `55009${String(81000000 + tel++).padStart(8, '0')}` } });

  /** Um atendimento: conversa + mensagens + eventos (+ venda). `base` = início do atendimento. */
  const atendimento = async (d: {
    nome: string; numero: number; depto: string; quem?: Pessoa; falas: Fala[]; base: Date; origin?: ConversationOrigin;
    fechado?: { outcome: 'won' | 'lost'; valor?: number; produtos?: string; motivo: string; etapa?: string };
    aberto?: { status: 'waiting' | 'in_progress'; etapa?: string; naoLidas?: number };
  }) => {
    const c = await contato(d.nome);
    const at = (m: number) => new Date(d.base.getTime() + min(m));
    const ultima = d.falas[d.falas.length - 1];
    const ultimaIn = [...d.falas].reverse().find((f) => f[0] === 'c');
    const fechadoEm = at(ultima[2] + 2);
    const fechado = d.fechado;
    const conv = await prisma.conversation.create({ data: {
      tenantId: T, numberId: numeros[d.numero].id, contactId: c.id, departmentId: deptos[d.depto].id, origin: d.origin ?? 'organic',
      status: fechado ? 'closed' : d.aberto!.status, assigneeId: d.quem?.id ?? null,
      lastMessageAt: at(ultima[2]), lastInboundAt: ultimaIn ? at(ultimaIn[2]) : null, lastMessagePreview: ultima[1].slice(0, 120),
      awaitingSince: !fechado && ultima[0] === 'c' ? at(ultima[2]) : null, unreadCount: d.aberto?.naoLidas ?? 0, createdAt: at(d.falas[0][2]),
      ...(fechado && {
        closedAt: fechadoEm, outcome: fechado.outcome, outcomeAt: fechadoEm, outcomeById: d.quem?.id, outcomeReason: fechado.motivo,
        outcomeValue: fechado.valor ? new Prisma.Decimal(fechado.valor) : null,
        lastClosedAt: fechadoEm, lastCloseOutcome: fechado.outcome, lastCloseReasonId: motivos[fechado.motivo].id,
      }),
    } });
    await prisma.message.createMany({ data: d.falas.map(([q, text, m]) => ({
      conversationId: conv.id, numberId: numeros[d.numero].id, direction: q === 'c' ? 'in' : 'out', type: 'text', text, status: 'read',
      authorId: q === 'a' ? d.quem?.id ?? null : null, authorName: q === 'a' ? d.quem?.name ?? null : null, createdAt: at(m), queuedAt: at(m),
    } as Prisma.MessageCreateManyInput)) });
    // assumiu logo antes da 1ª resposta (a demora conta a partir do contato)
    const primeiraResp = d.falas.find((f) => f[0] === 'a');
    if (d.quem) await prisma.conversationEvent.create({ data: { tenantId: T, conversationId: conv.id, type: 'claimed', actorId: d.quem.id, fromStatus: 'waiting', toStatus: 'in_progress', createdAt: at((primeiraResp?.[2] ?? 1) - 1) } });
    if (d.aberto?.etapa) await prisma.conversationTag.create({ data: { conversationId: conv.id, tagId: etapas.find((e) => e.name === d.aberto!.etapa)!.id, isPrimary: true } });
    if (fechado) {
      const etapa = fechado.etapa ? etapas.find((e) => e.name === fechado.etapa)!.id : null;
      await prisma.conversationEvent.create({ data: {
        tenantId: T, conversationId: conv.id, type: 'closed', actorId: d.quem?.id, fromStatus: 'in_progress', toStatus: 'closed', outcome: fechado.outcome,
        outcomeValue: fechado.valor ? new Prisma.Decimal(fechado.valor) : null, reason: fechado.motivo, closeReasonId: motivos[fechado.motivo].id,
        stageTagId: etapa, tagSnapshot: etapa ? [etapa] : [], createdAt: fechadoEm,
      } });
      if (fechado.outcome === 'won' && fechado.valor) {
        await prisma.sale.create({ data: { tenantId: T, conversationId: conv.id, contactId: c.id, userId: d.quem?.id ?? null, amount: new Prisma.Decimal(fechado.valor), products: fechado.produtos ?? null, closedAt: fechadoEm } });
      }
    }
    return conv;
  };

  const prenomes = ['Ana', 'Beatriz', 'Caio', 'Débora', 'Eduardo', 'Fabiana', 'Gustavo', 'Helena', 'Igor', 'Juliana', 'Kléber', 'Luana', 'Murilo', 'Nicole', 'Otávio', 'Priscila', 'Ricardo', 'Sabrina', 'Tadeu', 'Vitória'];
  const sobrenomes = ['Moura', 'Pires', 'Nogueira', 'Campos', 'Siqueira', 'Lacerda', 'Brandão', 'Vieira', 'Correia', 'Machado'];
  const nomeFake = () => `${pick(prenomes)} ${pick(sobrenomes)}`;
  const diaAtras = (d: number) => { const b = new Date(Date.now() - d * 86_400_000); b.setHours(entre(8, 19), entre(0, 59), 0, 0); return b; };

  // ---- casos de auditoria ----
  for (const k of CASOS) {
    await atendimento({ nome: nomeFake(), numero: entre(0, 1), depto: k.depto, quem: atendentes[k.atendente], falas: k.falas, base: diaAtras(k.diasAtras),
      fechado: { outcome: k.resultado, valor: k.valor, produtos: k.produtos, motivo: k.motivo, etapa: k.resultado === 'won' ? 'Saiu para entrega' : 'Orçamento' } });
  }

  // ---- histórico de 30 dias (volume para os relatórios) ----
  const vendas: { produtos: string; valor: [number, number]; falas: string[] }[] = [
    { produtos: 'Shampoo anticaspa', valor: [28, 45], falas: ['Tem shampoo anticaspa?', 'Temos sim! Sai R$ {v}. Quer que separe?', 'Pode separar, por favor.', 'Separado! Já sai para entrega.'] },
    { produtos: 'Kit curativo + antisséptico', valor: [35, 60], falas: ['Preciso de curativo e antisséptico.', 'Montei um kit por R$ {v}. Pode ser?', 'Fechado.', 'Pedido confirmado, obrigado!'] },
    { produtos: 'Dermocosmético', valor: [70, 180], falas: ['Vocês têm sérum de vitamina C?', 'Temos! O de 30ml está R$ {v}.', 'Vou levar.', 'Ótimo, segue o link de pagamento.'] },
    { produtos: 'Medicamento de uso contínuo', valor: [40, 120], falas: ['Queria fazer meu pedido do mês.', 'Claro! Mesmos itens do mês passado? Fica R$ {v}.', 'Isso mesmo.', 'Feito! Chega amanhã cedo.'] },
  ];
  const perdas: { motivo: string; falas: string[] }[] = [
    { motivo: 'Achou caro', falas: ['Quanto está o colágeno em pó?', 'Está R$ 119,90.', 'Achei caro, obrigada.'] },
    { motivo: 'Sem estoque', falas: ['Tem o repelente infantil?', 'No momento está em falta, chega semana que vem.', 'Ok, vou procurar em outro lugar.'] },
    { motivo: 'Parou de responder', falas: ['Qual o preço do termômetro digital?', 'R$ 34,90! Quer que reserve?'] },
    { motivo: 'Desistiu', falas: ['Faz teste de glicemia aí?', 'Fazemos sim, R$ 15 na loja.', 'Ah, vou deixar para outro dia.'] },
  ];
  const origens: ConversationOrigin[] = ['organic', 'organic', 'organic', 'ad', 'ad', 'link', 'post'];
  let historico = 0;
  for (let d = 30; d >= 1; d--) {
    const n = entre(4, 9);
    for (let k = 0; k < n; k++) {
      const quem = pick(atendentes);
      const venda = rnd() < 0.6;
      const demora = entre(1, rnd() < 0.15 ? 90 : 15);
      let t = 0;
      const comFalas = (xs: string[], v?: number): Fala[] => xs.map((txt, i) => {
        t += i === 0 ? 0 : i === 1 ? demora : entre(1, 8);
        return [i % 2 === 0 ? 'c' : 'a', txt.replace('{v}', v?.toFixed(2).replace('.', ',') ?? ''), t];
      });
      if (venda) {
        const m = pick(vendas);
        const valor = entre(m.valor[0] * 10, m.valor[1] * 10) / 10;
        await atendimento({ nome: nomeFake(), numero: entre(0, 1), depto: 'Vendas', quem, falas: comFalas(m.falas, valor), base: diaAtras(d), origin: pick(origens),
          fechado: { outcome: 'won', valor, produtos: m.produtos, motivo: 'Compra concluída', etapa: 'Saiu para entrega' } });
      } else {
        const m = pick(perdas);
        await atendimento({ nome: nomeFake(), numero: entre(0, 1), depto: pick(['Vendas', 'Receitas']), quem, falas: comFalas(m.falas), base: diaAtras(d), origin: pick(origens),
          fechado: { outcome: 'lost', motivo: m.motivo, etapa: 'Orçamento' } });
      }
      historico++;
    }
  }

  // ---- abertos hoje (Kanban e filtros) ----
  const hoje = (minAtras: number) => new Date(Date.now() - min(minAtras));
  const abertos: { etapa?: string; status: 'waiting' | 'in_progress'; quem?: number; depto: string; origin: ConversationOrigin; naoLidas?: number; falas: Fala[]; atras: number }[] = [
    { etapa: 'Orçamento', status: 'in_progress', quem: 0, depto: 'Vendas', origin: 'ad', falas: [['c', 'Vi o anúncio do protetor solar, ainda está na promoção?', 0], ['a', 'Está sim! Leve 2 e pague R$ 89,90.', 3]], atras: 40 },
    { etapa: 'Orçamento', status: 'in_progress', quem: 1, depto: 'Vendas', origin: 'organic', naoLidas: 2, falas: [['c', 'Tem fralda geriátrica tamanho M?', 0], ['a', 'Temos! Quantos pacotes?', 2], ['c', 'Uns 4.', 20], ['c', 'Faz desconto?', 21]], atras: 30 },
    { etapa: 'Separando pedido', status: 'in_progress', quem: 2, depto: 'Receitas', origin: 'link', falas: [['c', 'Mandei a foto da receita.', 0], ['a', 'Recebi! Separando aqui.', 4]], atras: 55 },
    { etapa: 'Aguardando pagamento', status: 'in_progress', quem: 3, depto: 'Vendas', origin: 'ad', naoLidas: 1, falas: [['a', 'Segue o Pix: R$ 64,80.', 0], ['c', 'Já paguei, olha o comprovante.', 15]], atras: 15 },
    { etapa: 'Saiu para entrega', status: 'in_progress', quem: 0, depto: 'Vendas', origin: 'organic', falas: [['c', 'Já saiu?', 0], ['a', 'Saiu agora, chega em 20 min!', 2]], atras: 12 },
    { status: 'waiting', depto: 'Vendas', origin: 'post', naoLidas: 1, falas: [['c', 'Oi! Vocês entregam no bairro Jardim América?', 0]], atras: 8 },
    { status: 'waiting', depto: 'Receitas', origin: 'organic', naoLidas: 2, falas: [['c', 'Boa tarde', 0], ['c', 'Tem ozempic?', 1]], atras: 5 },
    { etapa: 'Orçamento', status: 'waiting', depto: 'Vendas', origin: 'ad', naoLidas: 1, falas: [['c', 'Quero saber do kit de skincare do anúncio.', 0]], atras: 3 },
  ];
  for (const a of abertos) {
    await atendimento({ nome: nomeFake(), numero: entre(0, 1), depto: a.depto, quem: a.quem !== undefined ? atendentes[a.quem] : undefined, falas: a.falas, base: hoje(a.atras), origin: a.origin,
      aberto: { status: a.status, etapa: a.etapa, naoLidas: a.naoLidas } });
  }

  console.log(`Conta "Farmácia Bem-Estar" criada: ${CASOS.length} casos de auditoria, ${historico} atendimentos encerrados nos últimos 30 dias, ${abertos.length} abertos hoje.`);
  console.log('Casos de auditoria (gabarito):');
  for (const k of CASOS) console.log(`  - ${atendentes[k.atendente].name}, há ${k.diasAtras} dia(s): ${k.falha}`);
  console.log(`Login: carla@${DOMINIO} / ${SENHA} (gestora). Atendentes: bruno@, lais@, rafael@, yasmin@ — mesma senha.`);
}

const cmd = process.argv[2];
const acoes: Record<string, () => Promise<unknown>> = { criar, limpar: async () => console.log((await limpar()) ? 'Removida.' : 'Nada a remover.') };
if (!acoes[cmd]) { console.log('Uso: tsx scripts/demo-loja.ts <criar|limpar>'); process.exit(1); }
acoes[cmd]().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
