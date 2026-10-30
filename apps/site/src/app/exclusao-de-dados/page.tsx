import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Exclusão de dados | ${SITE.name}`,
  description: `Como pedir à ${SITE.name} a exclusão dos seus dados pessoais.`,
  alternates: { canonical: '/exclusao-de-dados' },
  robots: { index: true, follow: true },
};

/**
 * Instruções de exclusão de dados em página própria: o app da Meta exige uma URL sem `#`, então
 * a seção 9 da política (`/privacidade#exclusao-de-dados`) não serve lá (docs/21-site.md).
 * O texto é o mesmo da seção 9 — mudou um, muda o outro.
 */
export default function ExclusaoDeDadosPage() {
  const email = SITE.supportEmail;
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4 sm:px-6">
          <Link href="/" aria-label={`${SITE.name} — página inicial`}><Logo className="h-7 w-auto" /></Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Exclusão de dados</h1>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink [&_p]:mt-2 [&_p]:text-muted [&_li]:text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-accent [&_a]:underline">
          <p>Para pedir que a {SITE.name} (CNPJ {SITE.cnpj}) exclua os seus dados pessoais:</p>
          <ul>
            <li>Envie um e-mail para <a href={`mailto:${email}?subject=${encodeURIComponent('Exclusão de dados')}`}>{email}</a> com o assunto “Exclusão de dados”, informando seu nome e o número de telefone (com DDD) ou e-mail usado.</li>
            <li>Se você conversou com uma empresa pelo WhatsApp, diga também o nome dela: a exclusão das conversas é feita junto com a empresa, que é a controladora desses dados.</li>
            <li>Podemos pedir uma confirmação de identidade antes de atender, para proteger você.</li>
            <li>Respondemos em até 15 dias. Dados que a lei nos obriga a guardar ficam bloqueados até o fim do prazo legal e depois são excluídos.</li>
          </ul>
          <p>Para parar de receber mensagens automáticas de uma empresa pelo WhatsApp, você também pode responder “sair” na conversa.</p>
          <p>Mais detalhes na <Link href="/privacidade">Política de Privacidade</Link>.</p>
        </div>
      </main>

      <LandingFooter />
    </>
  );
}
