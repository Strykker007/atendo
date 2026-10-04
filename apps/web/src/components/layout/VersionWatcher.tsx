'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Avisa quando subiu versão nova.
 *
 * O painel fica aberto o dia inteiro e navega sem recarregar a página, então o atendente
 * continua rodando o código do dia anterior sem saber — e quem corrige um defeito não tem
 * como pedir "recarregue" para cada pessoa. Pior: o atalho de recarregar ignorando cache
 * muda de navegador para navegador.
 *
 * A comparação é com a versão que a API respondeu **no primeiro carregamento** desta aba,
 * não com uma versão compilada aqui dentro: painel e API sobem juntos, e assim não é preciso
 * injetar nada no build do front.
 */
export function VersionWatcher() {
  const [novaVersao, setNovaVersao] = useState(false);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) return;
    let inicial: string | null = null;
    let parado = false;

    async function conferir() {
      try {
        const r = await fetch(`${api}/health`, { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (!version || version === 'dev') return; // ambiente local não fica avisando
        if (inicial === null) inicial = version;
        else if (version !== inicial && !parado) setNovaVersao(true);
      } catch {
        // rede caiu ou API reiniciando: tentar de novo no próximo ciclo é o bastante
      }
    }

    void conferir();
    const t = setInterval(conferir, 120_000);
    return () => { parado = true; clearInterval(t); };
  }, []);

  if (!novaVersao) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-ink text-panel shadow-lg px-4 py-2.5 text-sm">
      <span>Uma versão nova do VogoChat está disponível.</span>
      {/* reload() já busca o HTML de novo, e os arquivos do Next têm hash no nome:
          não é preciso ensinar atalho de navegador para ninguém */}
      <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-2.5 py-1 text-[13px] font-medium hover:bg-accent/90">
        <RefreshCw size={13} /> Atualizar
      </button>
    </div>
  );
}
