/**
 * Dados de teste dos VogoPartners — SÓ banco local (docs/37-vogopartners.md#testar-localmente).
 *
 *   pnpm --filter @atendo/api exec tsx scripts/vogopartners-dev.ts seed     # apaga o seed anterior e cria 10 parceiros, clientes e pagamentos
 *   pnpm --filter @atendo/api exec tsx scripts/vogopartners-dev.ts reset    # desfaz os fechamentos (pagamentos/comissões/auditoria); mantém parceiros e pagamentos dos clientes
 *   pnpm --filter @atendo/api exec tsx scripts/vogopartners-dev.ts pagar    # novos pagamentos de clientes no último mês e na última semana fechados
 *   pnpm --filter @atendo/api exec tsx scripts/vogopartners-dev.ts codigo   # código atual do autenticador do admin@atendo.local
 *   pnpm --filter @atendo/api exec tsx scripts/vogopartners-dev.ts limpar   # remove tudo o que o seed criou
 *
 * Tudo que o seed cria tem slug `vp-seed-…` (clientes) e id começando por `5eed` (UUID válido —
 * as rotas validam UUID), e só isso é apagado.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { base32Decode, hotp, newTotpSecret, otpauthUrl, totpStep } from '../src/modules/partners/totp';

const P = 'vp-seed-';
/** UUIDs reconhecíveis: `5eed0000-…` parceiros, `5eed0001-…` clientes */
const ID = '5eed000';
const uuid = (tipo: number, n: number) => `5eed000${tipo}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = 'admin@atendo.local';
const SENHA_PARCEIRO = 'parceiro123';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url)) {
  console.error('Recusado: DATABASE_URL não é local. Este script só roda no banco de desenvolvimento.');
  process.exit(1);
}

const prisma = new PrismaClient();
const crypto = new CryptoService();

// gerador determinístico: o seed sai igual toda vez
let semente = 42;
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

/** meio-dia de SP do dia (sem susto de fuso nos limites de mês/semana) */
const dia = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
const mesStr = (dt: Date) => dt.toISOString().slice(0, 7);
const addDias = (dt: Date, n: number) => new Date(dt.getTime() + n * 86_400_000);
const hoje = () => { const n = new Date(); return dia(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()); };
/** primeiro dia do mês `k` meses atrás (0 = este mês) */
const inicioMes = (k: number) => { const n = new Date(); return dia(n.getUTCFullYear(), n.getUTCMonth() + 1 - k, 1); };
/** segunda-feira da semana `k` semanas atrás (0 = esta semana, ISO) */
const segunda = (k: number) => { const h = hoje(); const dow = (h.getUTCDay() + 6) % 7; return addDias(h, -dow - 7 * k); };

interface ParceiroSeed {
  nome: string;
  email: string;
  clientes: number;
  faixas?: [number, number][];
  instalacao?: number;
  status?: 'active' | 'suspended';
  pix?: 'ok' | 'sem' | 'recente';
  login?: boolean;
}

const PARCEIROS: ParceiroSeed[] = [
  { nome: 'Tiago Parceiro', email: 'parceiro1@atendo.local', clientes: 12, faixas: [[0, 20], [8, 25], [11, 30]], login: true },
  { nome: 'Marina Souza Consultoria', email: 'parceiro2@atendo.local', clientes: 9, faixas: [[0, 15], [3, 22], [8, 28]], instalacao: 35, login: true },
  { nome: 'Rafael Lima Digital', email: 'rafael@exemplo.invalid', clientes: 7 },
  { nome: 'Agência Ponto Alto', email: 'pontoalto@exemplo.invalid', clientes: 6, instalacao: 40 },
  { nome: 'Carla Mendes', email: 'carla@exemplo.invalid', clientes: 5, pix: 'recente' },
  { nome: 'Bruno Tech Soluções', email: 'bruno@exemplo.invalid', clientes: 4 },
  { nome: 'Juliana Rocha', email: 'juliana@exemplo.invalid', clientes: 3, pix: 'sem' },
  { nome: 'Grupo Norte Vendas', email: 'norte@exemplo.invalid', clientes: 3, status: 'suspended' },
  { nome: 'Pedro Alves ME', email: 'pedro@exemplo.invalid', clientes: 2 },
  { nome: 'Fernanda Costa', email: 'fernanda@exemplo.invalid', clientes: 1 },
];

const NEGOCIOS = ['Farmácia', 'Pet Shop', 'Clínica', 'Ótica', 'Imobiliária', 'Auto Peças', 'Academia', 'Padaria', 'Salão', 'Escola', 'Mercado', 'Floricultura', 'Lavanderia', 'Odonto'];
const LUGARES = ['Central', 'Bem Estar', 'Vida', 'Sol', 'do Bairro', 'Primavera', 'Real', 'Nova Era', 'Boa Vista', 'Estrela'];

async function limparSeed() {
  const tenants = (await prisma.tenant.findMany({ where: { slug: { startsWith: P } }, select: { id: true } })).map((t) => t.id);
  const partners = (await prisma.partner.findMany({ where: { OR: [{ id: { startsWith: ID } }, { id: { startsWith: P } }] }, select: { id: true } })).map((p) => p.id);
  const payouts = (await prisma.partnerPayout.findMany({ where: { partnerId: { in: partners } }, select: { id: true } })).map((p) => p.id);
  await prisma.$transaction([
    prisma.financeEntry.deleteMany({ where: { OR: [{ tenantId: { in: tenants } }, { partnerPayoutId: { in: payouts } }] } }),
    prisma.partnerEvent.deleteMany({ where: { OR: [{ partnerId: { in: partners } }, { payoutId: { in: payouts } }, { action: { startsWith: 'payout' } }] } }),
    prisma.partnerCommission.deleteMany({ where: { partnerId: { in: partners } } }),
    prisma.partnerPayout.deleteMany({ where: { partnerId: { in: partners } } }),
    prisma.invoice.deleteMany({ where: { tenantId: { in: tenants } } }),
    prisma.subscription.deleteMany({ where: { tenantId: { in: tenants } } }),
    prisma.user.deleteMany({ where: { OR: [{ partnerId: { in: partners } }, { tenantId: { in: tenants } }] } }),
    prisma.tenant.deleteMany({ where: { id: { in: tenants } } }),
    prisma.partnerTier.deleteMany({ where: { partnerId: { in: partners } } }),
    prisma.partner.deleteMany({ where: { id: { in: partners } } }),
  ]);
  return { tenants: tenants.length, partners: partners.length };
}

/** Fechamentos do zero: o que a apuração/autorização/pagamento criou some; pagamentos dos clientes ficam. */
async function reset() {
  const partners = (await prisma.partner.findMany({ where: { OR: [{ id: { startsWith: ID } }, { id: { startsWith: P } }] }, select: { id: true } })).map((p) => p.id);
  const payouts = (await prisma.partnerPayout.findMany({ where: { partnerId: { in: partners } }, select: { id: true } })).map((p) => p.id);
  const [fin, ev, com, pay] = await prisma.$transaction([
    prisma.financeEntry.deleteMany({ where: { partnerPayoutId: { in: payouts } } }),
    // auditoria dos fechamentos (apuração é evento sem parceiro; o resto aponta o pagamento)
    prisma.partnerEvent.deleteMany({ where: { OR: [{ payoutId: { in: payouts } }, { action: { startsWith: 'payout' } }] } }),
    prisma.partnerCommission.deleteMany({ where: { partnerId: { in: partners } } }),
    prisma.partnerPayout.deleteMany({ where: { partnerId: { in: partners } } }),
  ]);
  console.log(`Fechamentos desfeitos: ${pay.count} pagamento(s), ${com.count} linha(s) de comissão, ${fin.count} saída(s) no financeiro, ${ev.count} evento(s).`);
  console.log('As comissões são recriadas na próxima apuração a partir dos pagamentos dos clientes.');
}

async function garantirAutenticadorAdmin() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN }, select: { id: true, totpSecret: true, totpConfirmedAt: true } });
  if (!admin) { console.log(`(sem ${ADMIN}: cadastre o autenticador pela tela Parceiros → Segurança)`); return; }
  if (admin.totpSecret && admin.totpConfirmedAt) { console.log(`Autenticador do ${ADMIN} já existe — código: tsx scripts/vogopartners-dev.ts codigo`); return; }
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: admin.id }, data: { totpSecret: crypto.encrypt(secret), totpConfirmedAt: new Date() } });
  console.log(`Autenticador do ${ADMIN} criado. Use o comando "codigo" ou adicione no celular:`);
  console.log(`  ${otpauthUrl(secret, ADMIN, 'Atendo (local)')}`);
}

async function codigo() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN }, select: { totpSecret: true } });
  if (!admin?.totpSecret) { console.log('O admin ainda não tem autenticador. Rode "seed" ou cadastre em Parceiros → Segurança.'); return; }
  const secret = base32Decode(crypto.decrypt(admin.totpSecret));
  const s = totpStep();
  const resta = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${hotp(secret, s)}  (vale mais ${resta}s; cada código só serve UMA vez — para outra ação, espere o próximo)`);
}

/** Mensalidade paga do cliente no mês `inicio` (fatura do Asaas já baixada). */
function fatura(tenantId: string, valor: number, pagoEm: Date, status: 'paid' | 'open' | 'failed' = 'paid') {
  return {
    tenantId, period: mesStr(pagoEm), baseAmount: valor, totalAmount: valor, status,
    dueAt: pagoEm, paidAt: status === 'paid' ? pagoEm : null,
  };
}

async function seed() {
  const removido = await limparSeed();
  if (removido.partners) console.log(`Seed anterior removido (${removido.partners} parceiros, ${removido.tenants} clientes).`);
  const planos = await prisma.plan.findMany({ where: { isActive: true, isFree: false, billingCycle: 'monthly' }, orderBy: { priceMonth: 'asc' }, take: 2 });
  if (!planos.length) throw new Error('Nenhum plano pago mensal ativo no banco local.');
  const hash = await argon2.hash(SENHA_PARCEIRO, { type: argon2.argon2id });
  const agora = hoje();
  let nCli = 0;
  let nFat = 0;
  let nInst = 0;

  for (const [i, ps] of PARCEIROS.entries()) {
    const pid = uuid(0, i + 1);
    const pix = ps.pix ?? 'ok';
    await prisma.partner.create({
      data: {
        id: pid, name: ps.nome, email: ps.email, phone: `5500900${String(i + 1).padStart(6, '0')}`,
        document: `000000000${String(i).padStart(2, '0')}`,
        status: ps.status ?? 'active', setupRate: ps.instalacao ?? null,
        ...(pix !== 'sem' && { pixKey: ps.email, pixKeyType: 'EMAIL', pixKeyChangedAt: pix === 'recente' ? addDias(new Date(), 0) : addDias(agora, -40) }),
        notes: 'Criado pelo scripts/vogopartners-dev.ts (dados de teste).',
      },
    });
    if (ps.faixas) await prisma.partnerTier.createMany({ data: ps.faixas.map(([minClients, rate]) => ({ partnerId: pid, minClients, rate })) });
    if (ps.login) await prisma.user.create({ data: { email: ps.email, name: ps.nome, passwordHash: hash, role: 'partner', partnerId: pid, passwordSetAt: new Date() } });

    for (let k = 0; k < ps.clientes; k++) {
      nCli++;
      const plano = planos[rnd() < 0.65 ? 0 : planos.length - 1];
      const valor = Number(plano.priceMonth);
      // vinculado entre ~4 meses e ~1 semana atrás; parte dos clientes é recente (cai só na semana)
      const vinculo = addDias(agora, -entre(7, 125));
      // situação: a maioria ativa; alguns inadimplentes, cancelados ou aguardando ativação
      const r = rnd();
      const situacao = r < 0.72 ? 'active' : r < 0.82 ? 'past_due' : r < 0.92 ? 'canceled' : 'awaiting';
      const tid = uuid(1, nCli);
      const nome = `${NEGOCIOS[entre(0, NEGOCIOS.length - 1)]} ${LUGARES[entre(0, LUGARES.length - 1)]} ${nCli}`;
      await prisma.tenant.create({
        data: {
          id: tid, name: nome, slug: `${P}${String(nCli).padStart(3, '0')}`, partnerId: pid, partnerAttributedAt: vinculo,
          isActive: situacao !== 'canceled', deactivatedAt: situacao === 'canceled' ? addDias(agora, -entre(3, 20)) : null,
          createdAt: vinculo, notes: 'Cliente de teste dos VogoPartners.',
        },
      });
      await prisma.subscription.create({
        data: {
          tenantId: tid, planId: plano.id,
          status: situacao === 'awaiting' ? 'trialing' : situacao === 'past_due' ? 'past_due' : situacao === 'canceled' ? 'canceled' : 'active',
          awaitingActivation: situacao === 'awaiting',
          currentPeriodStart: inicioMes(0), currentPeriodEnd: inicioMes(-1),
          canceledAt: situacao === 'canceled' ? addDias(agora, -entre(3, 20)) : null,
        },
      });
      if (situacao === 'awaiting') continue;

      // instalação paga na semana do vínculo (comissão semanal)
      await prisma.financeEntry.create({
        data: {
          kind: 'income', category: 'instalacao', description: `Instalação — ${nome}`, amount: [297, 397, 497][entre(0, 2)],
          date: addDias(vinculo, 1), paidAt: addDias(vinculo, 1), period: mesStr(addDias(vinculo, 1)), tenantId: tid, paymentMethod: 'pix',
        },
      });
      nInst++;

      // mensalidades: uma por mês desde o vínculo; o mês corrente só para parte (ainda aberto)
      const faturas = [];
      for (let m = 4; m >= 0; m--) {
        const pagoEm = addDias(inicioMes(m), entre(3, 14));
        if (pagoEm < vinculo || pagoEm > agora) continue;
        if (situacao === 'canceled' && m <= 0) continue;
        const ultima = m === 0 || (m === 1 && pagoEm > addDias(agora, -25));
        faturas.push(fatura(tid, valor, pagoEm, situacao === 'past_due' && ultima ? 'open' : 'paid'));
      }
      // cliente que já pagava antes de entrar para o parceiro: essa fatura NÃO pode gerar comissão
      if (k === 0) faturas.push(fatura(tid, valor, addDias(vinculo, -10)));
      if (faturas.length) await prisma.invoice.createMany({ data: faturas });
      nFat += faturas.length;
    }
  }

  // um recebimento "por fora" (sem gateway) de mensalidade — também conta
  const algum = await prisma.tenant.findFirst({ where: { slug: { startsWith: P }, isActive: true }, orderBy: { slug: 'asc' } });
  if (algum) {
    const pagoEm = addDias(inicioMes(1), 20);
    await prisma.financeEntry.create({ data: { kind: 'income', category: 'mensalidade', description: `Mensalidade recebida por fora — ${algum.name}`, amount: 150, date: pagoEm, paidAt: pagoEm, period: mesStr(pagoEm), tenantId: algum.id, paymentMethod: 'dinheiro' } });
  }

  console.log(`Criado: ${PARCEIROS.length} parceiros, ${nCli} clientes, ${nFat} faturas, ${nInst} instalações.`);
  console.log(`Login de parceiro: parceiro1@atendo.local e parceiro2@atendo.local, senha ${SENHA_PARCEIRO}`);
  await garantirAutenticadorAdmin();
}

/** Mais pagamentos no último mês e na última semana fechados — para apurar de novo e ver o rascunho mudar. */
async function pagar() {
  const tenants = await prisma.tenant.findMany({ where: { slug: { startsWith: P }, isActive: true, subscription: { awaitingActivation: false } }, include: { subscription: { include: { plan: true } } } });
  if (!tenants.length) { console.log('Sem clientes do seed. Rode "seed" antes.'); return; }
  const escolhidos = tenants.filter(() => rnd() < 0.3).slice(0, 8);
  const mesPassado = addDias(inicioMes(1), 25);
  const semanaPassada = addDias(segunda(1), 2);
  for (const t of escolhidos) {
    const valor = Number(t.subscription?.plan.priceMonth ?? 97);
    await prisma.invoice.create({ data: fatura(t.id, valor, new Date(mesPassado.getTime() + entre(0, 3600_000))) });
    await prisma.financeEntry.create({ data: { kind: 'income', category: 'instalacao', description: `Instalação extra (número adicional) — ${t.name}`, amount: 197, date: semanaPassada, paidAt: semanaPassada, period: mesStr(semanaPassada), tenantId: t.id, paymentMethod: 'pix' } });
  }
  console.log(`${escolhidos.length} cliente(s) pagaram mensalidade em ${mesStr(mesPassado)} e uma instalação extra na semana de ${semanaPassada.toISOString().slice(0, 10)}.`);
  console.log('Apure de novo: rascunhos são refeitos; o que já foi autorizado/pago fica e o novo entra no próximo ciclo.');
}

const cmd = process.argv[2];
const acoes: Record<string, () => Promise<unknown>> = {
  seed,
  reset,
  pagar,
  codigo,
  limpar: async () => console.log('Removido:', await limparSeed()),
};
if (!acoes[cmd]) {
  console.log('Uso: tsx scripts/vogopartners-dev.ts <seed|reset|pagar|codigo|limpar>');
  process.exit(1);
}
acoes[cmd]()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
