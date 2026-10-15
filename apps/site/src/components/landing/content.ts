/**
 * Textos da landing page — mudar copy, números ou perguntas é só aqui.
 * Links para o painel saem de `APP_URL`; contratação vai para o WhatsApp (`WHATSAPP_URL`).
 */
import type { LucideIcon } from 'lucide-react';
import { Baby, Bot, Inbox, TrendingUp, Users, Zap } from 'lucide-react';

export const NAV_LINKS = [
  { href: '#demonstracao', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#clientes', label: 'Clientes' },
  { href: '#planos', label: 'Valores' },
  { href: '#faq', label: 'Dúvidas' },
];

export const HERO = {
  eyebrow: 'Sua farmácia perde vendas no WhatsApp?',
  title: 'Vários atendentes no mesmo WhatsApp, respondendo rápido e vendendo mais',
  subtitle:
    'Organize seu WhatsApp com o canal multiatendimento e pare de deixar o cliente esperando nos horários de muito movimento. Ideal para farmácias com alto fluxo no balcão.',
  offer: 'Condição especial para operações menores, com até 50 atendimentos por dia',
  ctaPrimary: { href: '#planos', label: 'Saber valores e contratar' },
  ctaSecondary: { href: '#demonstracao', label: 'Assistir demonstração' },
  highlights: ['Sem taxa de adesão', 'Treinamento gratuito', 'Suporte especializado'],
};

export const DEMO = {
  title: 'Assista à demonstração prática do sistema',
  subtitle: 'Veja em poucos minutos como fica o atendimento da sua farmácia.',
  video: { src: '/videos/demonstracao.mp4', poster: '/videos/demonstracao-poster.webp' },
  cta: { href: '#planos', label: 'Saber valores e contratar o sistema' },
};

export const PAINS = {
  title: 'Você provavelmente passa por isso todos os dias',
  items: [
    'O cliente manda mensagem e demora para ser respondido quando a loja lota.',
    'O cliente chama, a equipe começa o atendimento, o movimento aumenta e ele fica sem retorno.',
    'Cada vendedor atende do jeito que acha mais rápido: um atendimento seco e sem padrão que afasta clientes — e você nem percebe.',
    'Produtos a mais não são oferecidos e o WhatsApp virou só um canal para informar preço, em vez de gerar vendas.',
    'Todos atendem na mesma tela: WhatsApp bagunçado, cliente perdido e menos dinheiro no seu bolso.',
    'O atendente só fala o preço, passa para o próximo e você perde a venda por falta de insistência.',
  ],
};

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const FEATURES = {
  title: 'O que o VogoChat resolve',
  subtitle: 'Tudo o que a sua equipe precisa para atender rápido e vender mais pelo WhatsApp.',
  items: [
    {
      icon: Bot,
      title: 'Nunca mais deixe cliente esperando',
      description: 'Pré-atendimento automático enquanto a equipe atende outras conversas ou a farmácia está cheia.',
    },
    {
      icon: Inbox,
      title: 'Organize todo o atendimento',
      description: 'Separe quem está aguardando, em atendimento e finalizado. Cada vendedor vê só as próprias conversas — chega de WhatsApp bagunçado.',
    },
    {
      icon: Zap,
      title: 'Atendimento muito mais rápido',
      description: 'Respostas rápidas, fluxos inteligentes e mensagens prontas na tela para ganhar velocidade.',
    },
    {
      icon: TrendingUp,
      title: 'Aumente o ticket médio',
      description: 'Ofereça perfumaria e promoções ao finalizar a venda com um clique e coloque mais dinheiro no caixa todos os dias.',
    },
    {
      icon: Baby,
      title: 'Fluxos prontos para farmácia',
      description: 'Fraldas, leites, vitaminas, higiene e medicamentos: tudo pronto para o vendedor atender mais rápido.',
    },
    {
      icon: Users,
      title: 'Vários atendentes no mesmo WhatsApp',
      description: 'Canal multiatendimento com a equipe toda organizada no mesmo número e até 4 números de WhatsApp integrados. A quantidade de atendentes depende do plano.',
    },
  ] satisfies Feature[],
  cta: { href: '#planos', label: 'Saber valores e falar com um vendedor' },
};

export const CLIENTS = {
  title: 'Principais clientes',
  subtitle: 'Mais de 600 farmácias já usam o VogoChat para vender mais pelo WhatsApp',
  /** logos em public/clientes/ (cada um com o próprio fundo) */
  logos: Array.from({ length: 16 }, (_, i) => `/clientes/${String(i + 1).padStart(2, '0')}.webp`),
};

export const METRICS = [
  { prefix: '+', value: 692, suffix: '', label: 'farmácias atendidas no Brasil' },
  { prefix: '', value: 40, suffix: '%', label: 'menos tempo de espera no atendimento' },
];

export const EXTRAS = {
  title: 'Funções extras',
  items: [
    'Lembrete para o cliente comprar novamente',
    'Atendimento assinado',
    'Conexão com o inbox do Instagram',
    'Disparo em massa pela API oficial',
    'Separação por departamentos',
    'Envio de fotos por vários celulares',
    'API oficial: coexistência e direta',
    'Multiatendimento com vários atendentes',
    'Mais de um número de WhatsApp conectado',
  ],
};

export const TESTIMONIALS = {
  title: 'Veja o que donos, gerentes e atendentes dizem depois de implantar o VogoChat',
  video: { src: '/videos/depoimentos.mp4', poster: '/videos/depoimentos-poster.webp' },
};

export const OFFER = {
  title: 'Condição especial para grandes operações',
  plan: '1 conexão de WhatsApp · 15 atendentes',
  price: 'R$ 297',
  period: '/mês',
  perks: ['Sem taxa de adesão', 'Treinamento gratuito'],
  cta: 'Falar com um consultor e contratar',
  warning: {
    title: 'Atenção!',
    lead: 'Só clique abaixo se tiver assistido à demonstração prática',
    rest: ', se realmente quiser contratar a ferramenta e tiver ao menos 30 atendimentos por dia.',
    note: 'Donos de farmácia sobrecarregados, sem tempo para capacitar a equipe e sem gerente ou alguém para ajudar na implantação normalmente não se adequam à ferramenta. Farmácias que atendem 100% pelo celular também não.',
  },
  closing:
    'Se organizar o atendimento hoje é uma prioridade para você, nossa equipe vai ajudar — mas é preciso tempo e força de vontade da sua parte.',
};

export const FAQ = [
  {
    q: 'Preciso instalar algum programa no computador da farmácia?',
    a: 'Não. O VogoChat é 100% em nuvem: você acessa pelo navegador, de qualquer lugar, sem instalação complicada nem suporte técnico local.',
  },
  {
    q: 'Quantas pessoas podem atender ao mesmo tempo?',
    a: 'Depende do plano: a quantidade de atendentes no mesmo WhatsApp varia conforme o plano contratado, e cada um vê apenas os próprios clientes. Fale com um consultor para escolher o ideal para a sua farmácia.',
  },
  {
    q: 'Meu atendimento é muito corrido, isso serve para mim?',
    a: 'É justamente para esse cenário. Quando o volume sobe, o improviso vira venda perdida e reclamação. O sistema entra para organizar.',
  },
  {
    q: 'E se eu tiver dúvidas ou precisar de ajuda?',
    a: 'Você tem suporte no horário de farmácia, das 7h às 22h.',
  },
  {
    q: 'Como funciona o teste? Tem fidelidade?',
    a: 'O teste libera todas as funções na prática por 30 dias pelo valor da primeira mensalidade. Não exigimos fidelidade nem cobramos multa de cancelamento: se você não perceber a melhora no fluxo, basta não continuar. O risco é todo nosso.',
  },
  {
    q: 'Meus atendentes podem usar o próprio celular para enviar fotos e vídeos dos remédios?',
    a: 'Sim! É uma das nossas melhores funções. O celular continua livre para postar status, tirar fotos e gravar vídeos, e o atendente pode usar o aparelho dele para enviar fotos dos produtos — tudo fica registrado no sistema da farmácia, sem depender do aparelho físico da loja.',
  },
  {
    q: 'Tenho poucos atendimentos, funciona da mesma forma?',
    a: 'Se a sua farmácia já recebe mais de 10 atendimentos por dia, o sistema é um ótimo investimento: organização, agilidade e oferecer produtos no ato da venda (em vez de só falar preço) aumentam o faturamento.',
  },
  {
    q: 'Tem API oficial certificada pela Meta?',
    a: 'Sim. O sistema é 100% certificado pela Meta, e todo o processo de migração do seu número para a API, se necessário, é feito pela nossa equipe.',
  },
];
