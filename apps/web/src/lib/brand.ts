/**
 * Marcas próprias (white-label) servidas pelo mesmo código.
 *
 * A marca ativa sai de `NEXT_PUBLIC_BRAND_ID` (fixa a marca do deploy) ou, sem ela, do domínio
 * da requisição (`resolveBrand`). As cores da marca viram variáveis CSS (`brandCss`) por cima
 * dos tokens de `globals.css` — os componentes continuam usando `bg-accent`, `bg-side` etc.
 * Ver docs/08-frontend.md › Marca.
 */

export interface BrandConfig {
  brandId: string;
  brandName: string;
  /** Logos em `public/`. Ausente → a interface mostra o nome da marca em texto. */
  logo: {
    /** horizontal sobre fundo claro (login, convite, recuperação de senha) */
    horizontal?: string;
    /** horizontal sobre fundo escuro (mesmas telas no tema escuro) */
    horizontalDark?: string;
    /** menu lateral, que é escuro nos dois temas */
    sidebar?: string;
    /** só o símbolo: menu recolhido */
    icon?: string;
  };
  faviconUrl?: string;
  /** botões, links, foco, primeira cor dos gráficos (`--accent`) */
  primaryColor: string;
  /** menu lateral (`--side`) */
  secondaryColor: string;
  /** balão de mensagem enviada (`--bub-out`) */
  accentColor: string;
  supportEmail: string;
  /**
   * Domínios da marca; subdomínios também casam (`app.`, `www.`). Vence o mais específico:
   * uma marca em `clinica.vogochat.com.br` ganha da VogoChat em `vogochat.com.br`.
   */
  domains: string[];
}

/** Nova marca: uma entrada aqui + logos em `public/marca/<id>/`. Ver docs/08-frontend.md › Marca. */
export const BRANDS = {
  vogochat: {
    brandId: 'vogochat',
    brandName: 'VogoChat',
    logo: {
      horizontal: '/marca/vogo-horizontal.png',
      horizontalDark: '/marca/vogo-horizontal-escuro.png',
      sidebar: '/marca/vogo-escuro.png',
      icon: '/marca/vogo-icone.png',
    },
    faviconUrl: '/marca/vogo-icone.png',
    // mesmos valores de globals.css: a VogoChat é a paleta base
    primaryColor: '#2f5bea',
    secondaryColor: '#243043',
    accentColor: '#2563eb',
    supportEmail: 'suporte@vogochat.com.br',
    domains: ['vogochat.com.br'],
  },
} satisfies Record<string, BrandConfig>;

export type BrandId = keyof typeof BRANDS;

/** Marca da paleta de `globals.css`: não precisa de sobrescrita de cores. */
export const BASE_BRAND_ID: BrandId = 'vogochat';

function isBrandId(id: string | undefined | null): id is BrandId {
  return !!id && id in BRANDS;
}

export function getBrand(id: string | undefined | null): BrandConfig {
  return BRANDS[isBrandId(id) ? id : BASE_BRAND_ID] as BrandConfig;
}

/** Marca fixada pelo deploy (`NEXT_PUBLIC_BRAND_ID`), se houver. */
export function envBrandId(): BrandId | null {
  const id = process.env.NEXT_PUBLIC_BRAND_ID;
  return isBrandId(id) ? id : null;
}

/** Env tem prioridade; senão o domínio mais específico que casa com o host; senão a base. */
export function resolveBrand(host?: string | null): BrandConfig {
  const fromEnv = envBrandId();
  if (fromEnv) return getBrand(fromEnv);
  const h = (host ?? '').split(':')[0].toLowerCase();
  let best: { brand: BrandConfig; len: number } | null = null;
  for (const brand of Object.values(BRANDS) as BrandConfig[]) {
    for (const d of brand.domains) {
      if ((h === d || h.endsWith(`.${d}`)) && d.length > (best?.len ?? 0)) best = { brand, len: d.length };
    }
  }
  return best?.brand ?? getBrand(BASE_BRAND_ID);
}

/**
 * Sobrescreve os tokens de cor com as cores da marca. Os tons derivados (hover, soft, versão
 * do escuro) saem de `color-mix`, então a marca só declara as três cores. A marca base devolve
 * vazio: a paleta dela foi afinada à mão em globals.css e derivar pioraria.
 */
export function brandCss(brand: BrandConfig): string {
  if (brand.brandId === BASE_BRAND_ID) return '';
  const { primaryColor: p, secondaryColor: s, accentColor: a } = brand;
  const mix = (c: string, pct: number, other: string) => `color-mix(in srgb, ${c} ${pct}%, ${other})`;
  const light = {
    '--accent': p,
    '--accent-hover': mix(p, 85, 'black'),
    '--accent-soft': mix(p, 12, 'white'),
    '--accent-ink': mix(p, 75, 'black'),
    '--side': s,
    '--side-on-ink': s,
    '--side-line': mix(s, 85, 'white'),
    '--bub-out': a,
    '--bub-out-2': mix(a, 88, 'black'),
    '--c1': p,
  };
  const dark = {
    '--accent': mix(p, 75, 'white'),
    '--accent-hover': mix(p, 60, 'white'),
    '--accent-soft': mix(p, 22, '#171c27'),
    '--accent-ink': mix(p, 45, 'white'),
    '--side-on': mix(p, 22, '#171c27'),
    '--side-on-ink': mix(p, 45, 'white'),
    '--bub-out': a,
    '--bub-out-2': mix(a, 85, 'black'),
    '--c1': mix(p, 80, 'white'),
  };
  const decl = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root{${decl(light)}}.dark{${decl(dark)}}`;
}
