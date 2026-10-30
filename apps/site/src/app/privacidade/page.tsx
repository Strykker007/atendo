import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { SITE } from '@/lib/site';

/** Data da versão em vigor: mudou o texto, muda aqui (seção "Alterações"). */
const ATUALIZADA_EM = '28 de outubro de 2026';

export const metadata: Metadata = {
  title: `Política de Privacidade | ${SITE.name}`,
  description: `Como a ${SITE.name} coleta, usa, guarda e protege dados pessoais — e como pedir acesso, correção ou exclusão.`,
  alternates: { canonical: '/privacidade' },
  robots: { index: true, follow: true },
};

/**
 * Política de privacidade (LGPD) — exigida pela Meta para o app da API oficial do WhatsApp,
 * com as instruções de exclusão de dados em `#exclusao-de-dados` e em `/exclusao-de-dados` (a Meta não aceita URL com `#`; docs/21-site.md). Mudou a seção 9, muda a página também.
 */
export default function PrivacidadePage() {
  const email = SITE.supportEmail;
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4 sm:px-6">
          <Link href="/" aria-label={`${SITE.name} — página inicial`}><Logo className="h-7 w-auto" /></Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-muted">Última atualização: {ATUALIZADA_EM}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_p]:mt-2 [&_p]:text-muted [&_li]:text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-accent [&_a]:underline">
          <section>
            <p>
              Esta política explica como a <b className="text-ink">{SITE.name}</b> (CNPJ {SITE.cnpj}) trata dados pessoais no site{' '}
              <a href={SITE.url}>{SITE.url.replace(/^https?:\/\//, '')}</a> e na plataforma de atendimento pelo WhatsApp que oferecemos às empresas
              clientes (o “painel”), em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
            </p>
          </section>

          <section>
            <h2>1. Quem somos e qual o nosso papel</h2>
            <ul>
              <li><b className="text-ink">Controladora:</b> a {SITE.name} é controladora dos dados de quem visita o site, de quem nos contrata e das pessoas que usam o painel (usuários das empresas clientes).</li>
              <li><b className="text-ink">Operadora:</b> nas conversas de WhatsApp entre uma empresa cliente e os clientes dela, a empresa é a controladora e a {SITE.name} trata esses dados apenas para prestar o serviço, conforme as instruções dela. Pedidos sobre essas conversas devem ser feitos primeiro à empresa com quem você conversou — nós ajudamos a atendê-los.</li>
            </ul>
          </section>

          <section>
            <h2>2. Quais dados tratamos</h2>
            <ul>
              <li><b className="text-ink">Visitantes do site:</b> dados de navegação (endereço IP, navegador, páginas visitadas) e cookies de medição e publicidade (Google Ads, Meta Pixel e TikTok Pixel), além do que você nos enviar ao entrar em contato.</li>
              <li><b className="text-ink">Empresas clientes:</b> razão social, CNPJ, nome e contato do responsável, e-mail, telefone e dados de cobrança (os dados de cartão são tratados diretamente pelos intermediadores de pagamento, não por nós).</li>
              <li><b className="text-ink">Usuários do painel:</b> nome, e-mail, perfil de acesso, registros de login e de uso (data, hora, endereço IP e dispositivo), para segurança e auditoria.</li>
              <li><b className="text-ink">Contatos atendidos pelas empresas clientes (via WhatsApp):</b> número de telefone, nome e foto de perfil do WhatsApp, conteúdo das mensagens (texto, áudio, imagens, documentos e localização enviados na conversa), data e hora, e as informações que a empresa registrar no atendimento (por exemplo, etiquetas, observações, orçamentos e pesquisas de satisfação).</li>
            </ul>
          </section>

          <section>
            <h2>3. Para que usamos os dados</h2>
            <ul>
              <li>Prestar o serviço: receber e enviar mensagens do WhatsApp em nome das empresas clientes, organizar o atendimento, gerar relatórios e executar as automações que elas configurarem.</li>
              <li>Criar e administrar contas, autenticar usuários e proteger a plataforma contra acessos indevidos.</li>
              <li>Cobrar pelo serviço e cumprir obrigações legais, fiscais e regulatórias.</li>
              <li>Dar suporte e enviar comunicações sobre o serviço (por exemplo, avisos de manutenção e de segurança).</li>
              <li>Medir e melhorar o site e as nossas campanhas de divulgação.</li>
            </ul>
            <p>Não vendemos dados pessoais. Não usamos o conteúdo das conversas das empresas clientes para publicidade nossa.</p>
          </section>

          <section>
            <h2>4. Bases legais</h2>
            <p>
              Tratamos dados com base na execução de contrato (art. 7º, V, da LGPD), no cumprimento de obrigação legal ou regulatória (art. 7º, II),
              no exercício regular de direitos (art. 7º, VI), no legítimo interesse — para segurança, prevenção a fraudes e melhoria do serviço
              (art. 7º, IX) — e no consentimento, quando exigido, como nos cookies de publicidade (art. 7º, I). Nas conversas, a base legal é
              definida pela empresa cliente, que é a controladora.
            </p>
          </section>

          <section>
            <h2>5. Com quem compartilhamos</h2>
            <p>Somente o necessário para o serviço funcionar, com fornecedores que também têm obrigação de proteger os dados:</p>
            <ul>
              <li><b className="text-ink">Meta Platforms (WhatsApp):</b> as mensagens trafegam pela infraestrutura do WhatsApp, inclusive pela API oficial do WhatsApp Business, sujeitas também às políticas da Meta.</li>
              <li><b className="text-ink">Infraestrutura em nuvem:</b> provedores de servidores, banco de dados e armazenamento de arquivos onde a plataforma é hospedada.</li>
              <li><b className="text-ink">Pagamentos:</b> intermediadores como Asaas e Stripe, para cobranças e pagamentos via Pix e cartão.</li>
              <li><b className="text-ink">E-mail:</b> serviços de envio de e-mails transacionais (convites, recuperação de senha, avisos).</li>
              <li><b className="text-ink">Inteligência artificial:</b> quando a empresa cliente ativa recursos de IA, os trechos de conversa necessários são enviados ao provedor de IA contratado apenas para gerar a resposta solicitada.</li>
              <li><b className="text-ink">Publicidade e medição:</b> Google, Meta e TikTok recebem dados de navegação do site por meio dos pixels.</li>
              <li><b className="text-ink">Autoridades:</b> quando houver obrigação legal ou ordem judicial.</li>
            </ul>
            <p>
              Alguns desses fornecedores podem armazenar dados fora do Brasil. Nesses casos, a transferência segue o art. 33 da LGPD, com
              cláusulas contratuais e garantias de proteção adequadas.
            </p>
          </section>

          <section>
            <h2>6. Por quanto tempo guardamos</h2>
            <ul>
              <li>Dados das conversas e do atendimento: enquanto o contrato com a empresa cliente estiver ativo, ou até ela excluí-los ou pedir a exclusão.</li>
              <li>Dados de conta e de cobrança: durante o contrato e pelos prazos exigidos por lei (por exemplo, obrigações fiscais).</li>
              <li>Registros de acesso: pelo prazo do Marco Civil da Internet (no mínimo 6 meses).</li>
            </ul>
            <p>Encerrado o prazo, os dados são excluídos ou anonimizados.</p>
          </section>

          <section>
            <h2>7. Como protegemos</h2>
            <ul>
              <li>Conexões criptografadas (HTTPS) e credenciais de integração guardadas criptografadas.</li>
              <li>Acesso ao painel por login individual, com perfis de permissão definidos pela empresa e separação dos dados de cada cliente.</li>
              <li>Registro de acessos e de ações sensíveis, e acesso restrito da nossa equipe à infraestrutura.</li>
            </ul>
            <p>Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente relevante, avisaremos os afetados e a ANPD, conforme a LGPD.</p>
          </section>

          <section>
            <h2>8. Seus direitos</h2>
            <p>
              Você pode pedir, a qualquer momento: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação
              de dados desnecessários, portabilidade, informação sobre compartilhamentos, revogação do consentimento e revisão de decisões
              automatizadas (art. 18 da LGPD). Também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
            </p>
          </section>

          <section id="exclusao-de-dados" className="scroll-mt-6">
            <h2>9. Como pedir a exclusão dos seus dados</h2>
            <ul>
              <li>Envie um e-mail para <a href={`mailto:${email}?subject=${encodeURIComponent('Exclusão de dados')}`}>{email}</a> com o assunto “Exclusão de dados”, informando seu nome e o número de telefone (com DDD) ou e-mail usado.</li>
              <li>Se você conversou com uma empresa pelo WhatsApp, diga também o nome dela: a exclusão das conversas é feita junto com a empresa, que é a controladora desses dados.</li>
              <li>Podemos pedir uma confirmação de identidade antes de atender, para proteger você.</li>
              <li>Respondemos em até 15 dias. Dados que a lei nos obriga a guardar ficam bloqueados até o fim do prazo legal e depois são excluídos.</li>
            </ul>
            <p>Para parar de receber mensagens automáticas de uma empresa pelo WhatsApp, você também pode responder “sair” na conversa.</p>
          </section>

          <section>
            <h2>10. Cookies</h2>
            <p>
              O site usa cookies essenciais (funcionamento e preferência de tema) e cookies de medição e publicidade (Google, Meta e TikTok). Você
              pode bloqueá-los ou apagá-los nas configurações do navegador; isso não impede o uso do site.
            </p>
          </section>

          <section>
            <h2>11. Crianças e adolescentes</h2>
            <p>Nossos serviços são destinados a empresas e não são direcionados a menores de 18 anos.</p>
          </section>

          <section>
            <h2>12. Alterações desta política</h2>
            <p>Podemos atualizar esta política. A data da versão em vigor fica no topo da página; mudanças relevantes serão comunicadas às empresas clientes.</p>
          </section>

          <section>
            <h2>13. Contato</h2>
            <p>
              Dúvidas, pedidos e solicitações sobre dados pessoais: <a href={`mailto:${email}`}>{email}</a>. Este é o nosso canal de
              comunicação com os titulares, nos termos da Resolução CD/ANPD nº 2/2022, aplicável a agentes de tratamento de pequeno porte.
              {' '}{SITE.name} — CNPJ {SITE.cnpj}.
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </>
  );
}
