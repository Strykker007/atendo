import type { Metadata } from 'next';

/**
 * Foto protegida: a prévia do link no WhatsApp mostra só este título genérico — nada de imagem
 * (sem og:image) nem do que é o conteúdo. Fora de buscador.
 */
export const metadata: Metadata = {
  title: 'Conteúdo do atendimento',
  description: 'Toque para abrir.',
  robots: { index: false, follow: false },
  openGraph: { title: 'Conteúdo do atendimento', description: 'Toque para abrir.' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
