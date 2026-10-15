/**
 * Dados fixos do site. O site é só da VogoChat (domínio próprio), então não usa o
 * white-label do painel — ver docs/21-site.md.
 */
export const SITE = {
  name: 'VogoChat',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'https://vogochat.com.br').replace(/\/$/, ''),
  title: 'Sistema de atendimento no WhatsApp para farmácias venderem mais | VogoChat',
  description:
    'Sua farmácia perde vendas no WhatsApp? Organize o atendimento, tenha vários atendentes no mesmo número, responda mais rápido e pare de deixar o cliente esperando nos horários de movimento.',
  supportEmail: 'suporte@vogochat.com.br',
  cnpj: '60.943.778/0001-66',
  social: {
    instagram: 'https://www.instagram.com/vogochat',
    facebook: 'https://www.facebook.com/profile.php?id=61567563429200',
  },
  logo: {
    light: '/marca/vogo-horizontal.png',
    dark: '/marca/vogo-horizontal-escuro.png',
  },
};

/** Endereço do painel (login). Entra no build, como todo `NEXT_PUBLIC_*`. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Conversa com o consultor: todos os CTAs de contratação terminam aqui. */
const WHATSAPP_PHONE = '5562998519649';
const WHATSAPP_TEXT = 'Gostaria de saber o valor e ver se daria certo esse sistema na minha farmácia';
export const WHATSAPP_URL = `https://api.whatsapp.com/send/?phone=${WHATSAPP_PHONE}&text=${encodeURIComponent(WHATSAPP_TEXT)}`;

/** Pixels de anúncio. Só carregam no build de produção — ver `components/Tracking.tsx`. */
export const TRACKING = {
  metaPixelId: '1367110748099027',
  tiktokPixelId: 'D9R94SRC77UEDJPS8AL0',
  googleAdsId: 'AW-17947136441',
  /** conversão "clique no WhatsApp" do Google Ads */
  googleAdsWhatsappConversion: 'AW-17947136441/RG-9CNTt5NgcELmj7u1C',
  googleSiteVerification: 'g_RjodgFsiavsORH-L-JgjFS47N0By_ccWir1RLADVg',
};
