/**
 * Conta de DEMONSTRAÇÃO para apresentações (administradora de condomínios) — SÓ banco local.
 * Tudo é fictício: nomes inventados e telefones com DDD 00 (impossíveis). Nada é enviado.
 *
 *   cd apps/api && npx tsx scripts/demo-administradora.ts criar    # recria a conta do zero
 *   cd apps/api && npx tsx scripts/demo-administradora.ts limpar   # remove a conta
 *
 * Login: renata@demo-administradora.local / demo12345 (admin da conta).
 */
import 'reflect-metadata';
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { CryptoService } from '../src/common/crypto/crypto.service';

const SLUG = 'demo-administradora';
const SENHA = 'demo12345';
const DOMINIO = 'demo-administradora.local';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url)) {
  console.error('Recusado: DATABASE_URL não é local.');
  process.exit(1);
}
const prisma = new PrismaClient();
const crypto = new CryptoService();

let semente = 7;
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const min = (n: number) => n * 60_000;
const agora = () => new Date();

async function limpar() {
  const t = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!t) return false;
  const id = t.id;
  const convs = (await prisma.conversation.findMany({ where: { tenantId: id }, select: { id: true } })).map((c) => c.id);
  const tickets = (await prisma.ticket.findMany({ where: { tenantId: id }, select: { id: true } })).map((c) => c.id);
  await prisma.$transaction([
    prisma.ticketEvent.deleteMany({ where: { tenantId: id } }),
    prisma.ticketParticipant.deleteMany({ where: { ticketId: { in: tickets } } }),
    prisma.ticket.deleteMany({ where: { tenantId: id } }),
    prisma.ticketHoldReason.deleteMany({ where: { tenantId: id } }),
    prisma.conversationEvent.deleteMany({ where: { tenantId: id } }),
    prisma.message.deleteMany({ where: { conversationId: { in: convs } } }),
    prisma.conversation.deleteMany({ where: { tenantId: id } }),
    prisma.contact.deleteMany({ where: { tenantId: id } }),
    prisma.whatsAppNumber.deleteMany({ where: { tenantId: id } }),
    prisma.userCompany.deleteMany({ where: { company: { tenantId: id } } }),
    prisma.user.deleteMany({ where: { tenantId: id } }),
    prisma.company.deleteMany({ where: { tenantId: id } }),
    prisma.department.deleteMany({ where: { tenantId: id } }),
    prisma.planOverride.deleteMany({ where: { tenantId: id } }),
    prisma.subscription.deleteMany({ where: { tenantId: id } }),
    prisma.tenantSettings.deleteMany({ where: { tenantId: id } }),
    prisma.tenant.delete({ where: { id } }),
  ]);
  return true;
}

type Fala = [quem: 'c' | 'a', texto: string, minutosAtras: number];

async function criar() {
  if (await limpar()) console.log('Conta de demonstração anterior removida.');
  const plano = await prisma.plan.findFirst({ where: { name: 'Business' } }) ?? await prisma.plan.findFirst({ where: { isFree: false, isActive: true }, orderBy: { priceMonth: 'desc' } });
  if (!plano) throw new Error('Nenhum plano pago no banco local.');
  const limits = { ...(plano.limits as Record<string, unknown>) };
  limits.features = [...new Set([...(((limits.features as string[]) ?? [])), 'tickets', 'flows', 'campaigns', 'satisfaction_surveys', 'daily_report'])];
  limits.maxCompanies = 20;

  const tenant = await prisma.tenant.create({ data: { name: 'Administradora Horizonte', slug: SLUG, legalName: 'Administradora Horizonte (demonstração)', notes: 'Conta fictícia para capturas de tela. scripts/demo-administradora.ts' } });
  const T = tenant.id;
  await prisma.tenantSettings.create({ data: { tenantId: T, salesEnabled: false, companyIsolation: true, wonLabel: 'Resolvido', lostLabel: 'Não resolvido', requireSaleValue: false, requireReasonOnWon: false, requireReasonOnLost: false, welcomeEnabled: false } });
  const inicio = new Date(); inicio.setDate(1);
  const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
  await prisma.subscription.create({ data: { tenantId: T, planId: plano.id, status: 'active', currentPeriodStart: inicio, currentPeriodEnd: fim } });
  await prisma.planOverride.create({ data: { tenantId: T, planId: plano.id, limits: limits as Prisma.InputJsonValue, notes: 'demonstração' } });

  const condos = await Promise.all([
    prisma.company.create({ data: { tenantId: T, name: 'Residencial Alfa', description: 'Residencial · 2 torres' } }),
    prisma.company.create({ data: { tenantId: T, name: 'Centro Empresarial Beta', description: 'Comercial · 14 andares' } }),
    prisma.company.create({ data: { tenantId: T, name: 'Edifício Comercial Gama', description: 'Comercial · salas e lojas' } }),
  ]);
  const cores = ['#2F5BEA', '#0EA5A4', '#D97706'];
  const numeros = await Promise.all(condos.map((c, i) => prisma.whatsAppNumber.create({
    data: {
      tenantId: T, companyId: c.id, label: c.name, color: cores[i], phone: `55009000001${i}${i}`,
      provider: 'evolution', externalId: `demo-adm-${i}-${Date.now()}`, status: 'connected',
      providerConfig: crypto.encryptJson({ instanceName: `demo-adm-${i}` }), sessionStartedAt: new Date(Date.now() - 86_400_000 * 20),
    },
  })));

  const deptos = Object.fromEntries(await Promise.all(([
    ['Administrativo', '#2F5BEA'], ['Financeiro', '#0EA5A4'], ['Reservas', '#8B5CF6'], ['Manutenção', '#D97706'],
  ] as const).map(async ([name, color]) => [name, await prisma.department.create({ data: { tenantId: T, name, color } })])));

  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  const pessoa = (name: string, email: string, role: 'tenant_admin' | 'manager' | 'agent') =>
    prisma.user.create({ data: { tenantId: T, name, email: `${email}@${DOMINIO}`, passwordHash: hash, role, passwordSetAt: new Date() } });
  const renata = await pessoa('Renata Moraes', 'renata', 'tenant_admin');
  const paulo = await pessoa('Paulo Henrique', 'paulo', 'manager');
  const juliana = await pessoa('Juliana Prado', 'juliana', 'agent');
  const marcos = await pessoa('Marcos Lima', 'marcos', 'agent');
  const sandra = await pessoa('Sandra Reis', 'sandra', 'agent');
  const diego = await pessoa('Diego Santos', 'diego', 'agent');
  await prisma.userCompany.createMany({ data: [
    { userId: paulo.id, companyId: condos[0].id }, { userId: paulo.id, companyId: condos[1].id }, { userId: paulo.id, companyId: condos[2].id },
    { userId: juliana.id, companyId: condos[0].id }, { userId: marcos.id, companyId: condos[1].id }, { userId: sandra.id, companyId: condos[2].id },
    { userId: diego.id, companyId: condos[0].id }, { userId: diego.id, companyId: condos[1].id }, { userId: diego.id, companyId: condos[2].id },
  ] });
  const gestorDe = [juliana, marcos, sandra];

  let tel = 100;
  const contato = (name: string) => prisma.contact.create({ data: { tenantId: T, name, nameSource: 'manual', phone: `55009${String(80000000 + tel++).padStart(8, '0')}` } });

  // ---- conversas de hoje (o que aparece na caixa de entrada) ----
  const hoje: { condo: number; nome: string; depto: string; status: 'waiting' | 'in_progress'; quem?: { id: string; name: string }; falas: Fala[]; naoLidas?: number }[] = [
    { condo: 1, nome: 'Fernanda Alves · Sala 1204', depto: 'Manutenção', status: 'in_progress', quem: marcos, falas: [
      ['c', 'Bom dia! O ar-condicionado do 3º andar parou de novo desde ontem à tarde.', 52],
      ['a', 'Bom dia, Fernanda! Já abri o pedido #12 para a manutenção e acionei a empresa do contrato.', 47],
      ['c', 'Obrigada. Vocês têm previsão? Temos reunião com cliente amanhã às 9h.', 45],
      ['a', 'O técnico passa hoje até as 16h. Te aviso aqui assim que ele chegar.', 41],
      ['c', 'Perfeito, fico no aguardo.', 40],
    ] },
    { condo: 0, nome: 'Carlos Mendes · Síndico', depto: 'Administrativo', status: 'in_progress', quem: juliana, falas: [
      ['c', 'Juliana, preciso da ata da última assembleia para enviar aos conselheiros.', 33],
      ['a', 'Olá, Carlos! Segue a ata em PDF. Também deixei o resumo das votações no e-mail.', 30],
      ['c', 'Ótimo. E o orçamento da pintura da fachada, já chegou?', 12],
    ], naoLidas: 1 },
    { condo: 2, nome: 'Loja Bella Moda · Térreo', depto: 'Financeiro', status: 'waiting', falas: [
      ['c', 'Olá, não recebi o boleto do condomínio deste mês. Podem reenviar?', 8],
    ], naoLidas: 1 },
    { condo: 1, nome: 'Rodrigo Tavares · Conj. 801', depto: 'Reservas', status: 'waiting', falas: [
      ['c', 'Boa tarde! Gostaria de reservar a sala de reuniões do 2º andar para quinta, das 14h às 17h.', 5],
    ], naoLidas: 1 },
    { condo: 0, nome: 'Patrícia Lopes · Apto 302', depto: 'Reservas', status: 'in_progress', quem: juliana, falas: [
      ['c', 'Oi! O salão de festas está livre no sábado dia 22?', 95],
      ['a', 'Oi, Patrícia! Está livre sim. Quer que eu reserve das 12h às 22h?', 90],
      ['c', 'Isso, pode reservar. Obrigada!', 88],
      ['a', 'Reservado! Enviei o termo de uso para você assinar.', 86],
    ] },
    { condo: 2, nome: 'Escritório Duarte Advogados · Sala 507', depto: 'Administrativo', status: 'in_progress', quem: sandra, falas: [
      ['c', 'Precisamos cadastrar dois novos funcionários para acesso ao prédio.', 70],
      ['a', 'Claro! Me envie nome completo e documento de cada um, por favor.', 66],
    ] },
    { condo: 1, nome: 'Construtora Prisma · obra 6º andar', depto: 'Manutenção', status: 'waiting', falas: [
      ['c', 'Bom dia. Podemos usar o elevador de serviço amanhã das 7h às 9h para a entrega de material?', 18],
    ], naoLidas: 1 },
    { condo: 0, nome: 'Eduardo Nunes · Apto 1101', depto: 'Financeiro', status: 'waiting', falas: [
      ['c', 'Consigo a 2ª via da taxa extra de outubro?', 26],
    ], naoLidas: 1 },
  ];

  const criarConversa = async (numIdx: number, nome: string, depto: string, status: 'waiting' | 'in_progress' | 'closed', quem: { id: string; name: string } | undefined, falas: Fala[], naoLidas = 0, base = agora()) => {
    const c = await contato(nome);
    const at = (m: number) => new Date(base.getTime() - min(m));
    const ultima = falas[falas.length - 1];
    const ultimaIn = [...falas].reverse().find((f) => f[0] === 'c');
    const conv = await prisma.conversation.create({ data: {
      tenantId: T, numberId: numeros[numIdx].id, contactId: c.id, status, assigneeId: quem?.id ?? null, departmentId: deptos[depto].id,
      lastMessageAt: at(ultima[2]), lastInboundAt: ultimaIn ? at(ultimaIn[2]) : null, lastMessagePreview: ultima[1].slice(0, 120),
      awaitingSince: ultima[0] === 'c' && status !== 'closed' ? at(ultima[2]) : null, unreadCount: naoLidas,
      createdAt: at(falas[0][2]), closedAt: status === 'closed' ? at(ultima[2] - 3) : null,
      outcome: status === 'closed' ? 'won' : 'none', outcomeAt: status === 'closed' ? at(ultima[2] - 3) : null,
    } });
    await prisma.message.createMany({ data: falas.map(([q, text, m]) => ({
      conversationId: conv.id, numberId: numeros[numIdx].id, direction: q === 'c' ? 'in' : 'out', type: 'text', text,
      status: q === 'c' ? 'read' : 'read', authorId: q === 'a' ? quem?.id ?? null : null, authorName: q === 'a' ? quem?.name ?? null : null,
      createdAt: at(m), queuedAt: at(m),
    } as Prisma.MessageCreateManyInput)) });
    if (quem) await prisma.conversationEvent.create({ data: { tenantId: T, conversationId: conv.id, type: 'claimed', actorId: quem.id, fromStatus: 'waiting', toStatus: 'in_progress', createdAt: at(falas[0][2] - 2) } });
    if (status === 'closed') await prisma.conversationEvent.create({ data: { tenantId: T, conversationId: conv.id, type: 'closed', actorId: quem?.id, fromStatus: 'in_progress', toStatus: 'closed', outcome: 'won', createdAt: at(ultima[2] - 3) } });
    return conv;
  };

  const convs: Record<string, string> = {};
  for (const h of hoje) convs[h.nome] = (await criarConversa(h.condo, h.nome, h.depto, h.status, h.quem, h.falas, h.naoLidas)).id;

  // ---- histórico de 30 dias (alimenta os relatórios) ----
  const assuntos: [string, Fala[]][] = [
    ['Financeiro', [['c', 'Preciso da 2ª via do boleto.', 0], ['a', 'Segue a 2ª via atualizada.', 0], ['c', 'Recebi, obrigado!', 0]]],
    ['Reservas', [['c', 'Quero reservar o espaço para sexta.', 0], ['a', 'Reserva confirmada!', 0]]],
    ['Manutenção', [['c', 'A lâmpada do corredor queimou.', 0], ['a', 'Equipe acionada, troca ainda hoje.', 0], ['c', 'Resolvido, obrigado.', 0]]],
    ['Administrativo', [['c', 'Como faço o cadastro de visitante recorrente?', 0], ['a', 'É só me enviar nome e documento que eu cadastro.', 0]]],
  ];
  const prenomes = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Mateus', 'Natália', 'Otávio', 'Renato', 'Simone', 'Tiago', 'Vanessa'];
  const sobrenomes = ['Souza', 'Ribeiro', 'Martins', 'Carvalho', 'Gomes', 'Barbosa', 'Rocha', 'Teixeira', 'Freitas', 'Cardoso'];
  let historico = 0;
  for (let d = 30; d >= 1; d--) {
    const n = entre(3, 8);
    for (let k = 0; k < n; k++) {
      const ci = entre(0, 2);
      const [depto, modelo] = pick(assuntos);
      const quem = pick([gestorDe[ci], gestorDe[ci], paulo, ...(depto === 'Manutenção' ? [diego] : [])]);
      const base = new Date(Date.now() - d * 86_400_000);
      base.setHours(entre(8, 18), entre(0, 59), 0, 0);
      const resposta = entre(2, 25);
      let t = 0;
      const falas: Fala[] = modelo.map(([q, txt], i) => { t += i === 1 ? resposta : entre(3, 30); return [q, txt, -t]; });
      const nome = `${pick(prenomes)} ${pick(sobrenomes)}${ci === 0 ? ` · Apto ${entre(1, 14)}0${entre(1, 4)}` : ` · Sala ${entre(2, 14)}0${entre(1, 9)}`}`;
      await criarConversa(ci, nome, depto, 'closed', quem, falas.map(([q, txt, m]) => [q, txt, m]), 0, base);
      historico++;
    }
  }

  // ---- pedidos entre setores ----
  const motivos = await Promise.all(['Aguardando orçamento do prestador', 'Aguardando peça', 'Aguardando aprovação do síndico'].map((name, position) =>
    prisma.ticketHoldReason.create({ data: { tenantId: T, name, position } })));
  const pedido = async (n: number, d: { title: string; description: string; depto: string; priority: string; status: string; criador: { id: string }; resp: { id: string }; part?: { id: string }[]; diasAtras: number; prazoDias: number; conv?: string; hold?: number; comentarios?: [{ id: string }, string, number][]; resolvido?: boolean }) => {
    const criadoEm = new Date(Date.now() - d.diasAtras * 86_400_000 - min(entre(10, 300)));
    const t = await prisma.ticket.create({ data: {
      tenantId: T, number: n, title: d.title, description: d.description, status: d.status, priority: d.priority, departmentId: deptos[d.depto].id,
      createdById: d.criador.id, conversationId: d.conv ?? null, dueAt: new Date(Date.now() + d.prazoDias * 86_400_000), createdAt: criadoEm,
      ...(d.hold !== undefined && { holdReasonId: motivos[d.hold].id, holdSince: new Date(Date.now() - min(90)) }),
      ...(d.resolvido && { resolvedAt: new Date(Date.now() - 86_400_000) }),
    } });
    await prisma.ticketParticipant.createMany({ data: [{ ticketId: t.id, userId: d.resp.id, role: 'responsible' }, ...(d.part ?? []).map((p) => ({ ticketId: t.id, userId: p.id, role: 'participant' }))], skipDuplicates: true });
    await prisma.ticketEvent.create({ data: { ticketId: t.id, tenantId: T, type: 'created', actorId: d.criador.id, data: { departmentId: deptos[d.depto].id, responsibleId: d.resp.id, participantIds: (d.part ?? []).map((p) => p.id) }, createdAt: criadoEm } });
    for (const [autor, body, minAtras] of d.comentarios ?? []) await prisma.ticketEvent.create({ data: { ticketId: t.id, tenantId: T, type: 'comment', actorId: autor.id, body, createdAt: new Date(Date.now() - min(minAtras)) } });
    if (d.hold !== undefined) await prisma.ticketEvent.create({ data: { ticketId: t.id, tenantId: T, type: 'hold', actorId: d.resp.id, body: 'Prestador vem amanhã avaliar o compressor.', data: { reason: motivos[d.hold].name, until: null, from: 'in_progress' }, createdAt: new Date(Date.now() - min(90)) } });
    return t;
  };
  let num = 1;
  const antigos: [string, string, string][] = [
    ['Troca das lâmpadas da garagem', 'Manutenção', 'normal'], ['Renovação do seguro predial', 'Administrativo', 'high'], ['Cotação de limpeza da fachada', 'Administrativo', 'normal'],
    ['Conserto do portão da garagem', 'Manutenção', 'urgent'], ['Inadimplência sala 704', 'Financeiro', 'normal'], ['Vistoria dos extintores', 'Manutenção', 'normal'],
    ['Atualizar cadastro de condôminos', 'Administrativo', 'low'], ['Revisão do contrato de elevadores', 'Administrativo', 'normal'], ['Reparo na bomba d’água', 'Manutenção', 'high'],
    ['Reserva do auditório para assembleia', 'Reservas', 'normal'], ['Acordo de débito loja 03', 'Financeiro', 'normal'],
  ];
  for (const [title, depto, priority] of antigos) {
    const resolvido = num <= 7;
    await pedido(num++, { title, description: title, depto, priority, status: resolvido ? 'resolved' : pick(['open', 'in_progress']), criador: pick(gestorDe), resp: depto === 'Manutenção' ? diego : paulo, diasAtras: entre(2, 25), prazoDias: entre(-2, 6), resolvido });
  }
  await pedido(12, {
    title: 'Ar-condicionado do 3º andar parado', depto: 'Manutenção', priority: 'high', status: 'on_hold', criador: marcos, resp: diego, part: [paulo],
    description: 'Ar-condicionado central do 3º andar parou ontem à tarde. Condôminos da sala 1204 relataram pelo WhatsApp. Empresa do contrato acionada.',
    diasAtras: 0, prazoDias: 3, conv: convs['Fernanda Alves · Sala 1204'], hold: 0,
    comentarios: [[diego, 'Técnico do contrato confirmou visita hoje até as 16h.', 40], [paulo, 'Se passar de R$ 2 mil, preciso aprovar com o síndico antes.', 30]],
  });

  console.log(`Conta "Administradora Horizonte" criada: 3 condomínios, ${hoje.length} conversas abertas hoje, ${historico} encerradas nos últimos 30 dias, 12 pedidos.`);
  console.log(`Login: renata@${DOMINIO} / ${SENHA} (também paulo@, juliana@, marcos@, sandra@, diego@)`);
}

const cmd = process.argv[2];
const acoes: Record<string, () => Promise<unknown>> = { criar, limpar: async () => console.log((await limpar()) ? 'Removida.' : 'Nada a remover.') };
if (!acoes[cmd]) { console.log('Uso: tsx scripts/demo-administradora.ts <criar|limpar>'); process.exit(1); }
acoes[cmd]().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
