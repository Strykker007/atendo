'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useMetaSignup, useMetaSignupConfig } from '@/lib/hooks';

/**
 * Cadastro incorporado da Meta (docs/meta-cadastro-incorporado.md): abre a janela da Meta, o cliente
 * escolhe/cria a conta do WhatsApp e o número, e o painel recebe o código (vale 30 s) e os ids —
 * sem copiar token nem ID. O servidor troca o código, registra o número e cadastra.
 */

interface FbSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window { FB?: FbSdk; fbAsyncInit?: () => void }
}

let sdk: Promise<FbSdk> | null = null;
function carregarSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdk) return sdk;
  sdk = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => { sdk = null; reject(new Error('Não deu para carregar a janela da Meta. Confira se algum bloqueador está ativo.')); };
    document.body.appendChild(s);
  });
  return sdk;
}

/** coexistência: a janela pode devolver só a WABA (o servidor acha o número) */
interface Resultado { wabaId: string; phoneNumberId?: string }

/** dados que a janela da Meta manda por postMessage ao terminar (ou cancelar) */
function esperarJanela(coexist: boolean): { promise: Promise<Resultado>; parar: () => void } {
  let parar = () => {};
  const promise = new Promise<Resultado>((resolve, reject) => {
    const ouvir = (ev: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      let msg: { type?: string; event?: string; data?: Record<string, string> };
      try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (msg?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (!coexist && msg.event === 'FINISH' && msg.data?.waba_id && msg.data?.phone_number_id) resolve({ wabaId: msg.data.waba_id, phoneNumberId: msg.data.phone_number_id });
      else if (coexist && msg.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' && msg.data?.waba_id) resolve({ wabaId: msg.data.waba_id, phoneNumberId: msg.data.phone_number_id || undefined });
      else if (msg.event === 'CANCEL') reject(new Error('Cadastro cancelado na janela da Meta.'));
      else if (msg.event === 'ERROR') reject(new Error(msg.data?.error_message || 'A Meta recusou o cadastro.'));
      else if (msg.event?.startsWith('FINISH')) reject(new Error(coexist
        ? 'A janela terminou sem conectar o aplicativo WhatsApp Business. Escolha a opção de conectar a conta do aplicativo.'
        : 'A janela terminou sem um número para a API oficial. Escolha ou adicione um número de telefone.'));
    };
    window.addEventListener('message', ouvir);
    parar = () => window.removeEventListener('message', ouvir);
  });
  return { promise, parar };
}

/**
 * `coexist`: o número continua no aplicativo WhatsApp Business do celular e passa a funcionar
 * também pela API oficial (docs/meta-cadastro-incorporado.md#coexistência).
 */
export function MetaSignupButton({ label, coexist = false, onDone, onError }: { label: string; coexist?: boolean; onDone: (r: { id: string; registerError: string | null; syncErrors: string[] }) => void; onError: (msg: string) => void }) {
  const cfg = useMetaSignupConfig();
  const signup = useMetaSignup();
  const [abrindo, setAbrindo] = useState(false);
  if (!cfg.data?.enabled) return null;

  async function conectar() {
    if (!cfg.data?.appId || !cfg.data.configId) return;
    if (!label.trim()) return onError('Dê um nome ao número antes (ex.: Vendas).');
    setAbrindo(true);
    const janela = esperarJanela(coexist);
    try {
      const FB = await carregarSdk(cfg.data.appId, cfg.data.graphVersion);
      // o código vale 30 s: pede o login e, assim que a janela fecha, manda tudo ao servidor
      const code = await new Promise<string>((resolve, reject) => {
        FB.login((r) => (r.authResponse?.code ? resolve(r.authResponse.code) : reject(new Error('Cadastro cancelado na janela da Meta.'))), {
          config_id: cfg.data!.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: coexist ? { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } : { setup: {} },
        });
      });
      const ids = await Promise.race([janela.promise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('A Meta não devolveu o número escolhido. Tente de novo.')), 15_000))]);
      const n = await signup.mutateAsync({ code, ...ids, label: label.trim(), ...(coexist && { coexist: true }) });
      onDone({ id: n.id, registerError: n.registerError, syncErrors: n.syncErrors ?? [] });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erro no cadastro pela Meta');
    } finally {
      janela.parar();
      setAbrindo(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-meta-soft p-3.5 space-y-2">
      <Button type="button" icon={<ShieldCheck size={15} />} onClick={() => void conectar()} loading={abrindo || signup.isPending} loadingText={signup.isPending ? 'Cadastrando…' : 'Janela da Meta aberta…'}>
        {coexist ? 'Conectar mantendo o WhatsApp Business do celular' : 'Conectar com a Meta'}
      </Button>
      {coexist ? (
        <p className="text-xs text-meta-ink">
          Para quem já atende pelo aplicativo WhatsApp Business (versão 2.24.17 ou mais nova): o número continua no celular e passa a funcionar
          também aqui. Na janela, escolha conectar a conta do aplicativo e confirme o código no celular. Contatos e até 6 meses de conversas
          vêm junto. Grupos, listas de transmissão, mensagens temporárias e de visualização única não passam pela API.
        </p>
      ) : (
        <p className="text-xs text-meta-ink">
          Abre uma janela da Meta: entre com o Facebook de quem administra a empresa, escolha (ou crie) a conta do WhatsApp e o número, e confirme.
          O número não pode estar em uso no aplicativo do WhatsApp do celular. Depois, cadastre a forma de pagamento no WhatsApp Manager para enviar templates.
        </p>
      )}
    </div>
  );
}
