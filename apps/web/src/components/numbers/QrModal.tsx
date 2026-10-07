'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useConnectNumber, useNumberQr, useNumbers } from '@/lib/hooks';
import { toast } from '@/components/ui/Toast';

/**
 * Mostra o QR da Evolution. O QR inicial vem da resposta de connect/create;
 * atualizações chegam pelo socket (evento `number` com qrCode) e a conexão
 * é detectada quando o status vira `connected`.
 */
export function QrModal({ numberId, initialQr, onClose }: { numberId: string | null; initialQr?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const numbers = useNumbers();
  const live = useNumberQr(numberId);
  const connect = useConnectNumber();
  const number = numbers.data?.find((n) => n.id === numberId);
  const connected = number?.status === 'connected';
  // depois de conectar, QR antigo (do connect inicial) não vale mais: só um QR novo vindo do socket
  const [seenConnected, setSeenConnected] = useState(false);
  // checklist anti-banimento antes de mostrar o QR (docs/04 › Proteção contra bloqueio)
  const [checks, setChecks] = useState([false, false, false]);
  const checklistOk = checks.every(Boolean);
  useEffect(() => { if (connected) setSeenConnected(true); }, [connected]);
  useEffect(() => { setSeenConnected(false); setChecks([false, false, false]); }, [numberId]);
  const qr = live.data ?? (seenConnected ? undefined : initialQr);
  const syncing = !connected && !qr && seenConnected;

  // conectou: fecha sozinho depois de mostrar a confirmação
  useEffect(() => {
    if (!connected || !numberId) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [connected, numberId, onClose]);

  // Segurança além do socket: enquanto o modal está aberto e não conectou, consulta a cada 3 s
  useEffect(() => {
    if (!numberId || connected) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['numbers'] }), 3000);
    return () => clearInterval(t);
  }, [numberId, connected, qc]);

  async function refresh() {
    if (!numberId) return;
    // o modal só abre depois de passar pela pausa (ou de confirmar o risco): QR novo não pergunta de novo
    const r = await connect.mutateAsync({ id: numberId, force: true });
    if (r.qrCode) qc.setQueryData(['number-qr', numberId], r.qrCode);
  }

  return (
    <Modal open={!!numberId} onClose={onClose} title={`Conectar ${number?.label ?? ''}`} width="max-w-md">
      <div className="text-center space-y-4">
        {connected ? (
          <div className="py-8 text-accent">
            <CheckCircle2 size={56} className="mx-auto" />
            <p className="mt-3 font-medium">Número conectado!</p>
          </div>
        ) : syncing ? (
          <div className="py-8 text-muted text-sm">
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-accent border-t-transparent animate-spin mb-3" />
            Sincronizando com o celular… se o WhatsApp pedir um QR novo, ele aparece aqui.
          </div>
        ) : !checklistOk ? (
          <ChecklistAntesDoQr checks={checks} onChange={setChecks} />
        ) : qr ? (
          <>
            <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR code" className="mx-auto w-64 h-64 rounded-lg border border-line bg-white p-1" />
            <ol className="text-left text-sm text-muted space-y-1 mx-auto max-w-xs">
              <li>1. Abra o WhatsApp no celular deste número</li>
              <li>2. Toque em <b>Mais opções ⋮ → Dispositivos conectados</b></li>
              <li>3. Toque em <b>Conectar dispositivo</b> e aponte para o QR</li>
            </ol>
            <p className="text-xs text-faint">O QR expira em ~40s. Se expirar, gere outro.</p>
          </>
        ) : (
          <div className="py-8 text-muted text-sm">
            <div className="w-64 h-64 mx-auto rounded-lg border border-line bg-field animate-pulse mb-3" />
            Gerando QR code… (a Evolution leva alguns segundos)
          </div>
        )}
        <div className="flex justify-center gap-2">
          {!connected && checklistOk && (
            <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => refresh().catch(toast.err)} loading={connect.isPending} loadingText="Gerando…">Gerar novo QR</Button>
          )}
          <Button variant="ghost" onClick={onClose}>{connected ? 'Fechar' : 'Depois'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * O que o sistema não consegue medir e mais derruba número não oficial: chip sem histórico,
 * pareado logo após registrar, e aparelhos antigos sobrando. Não bloqueia — o QR aparece quando
 * a pessoa confirma os três —, mas obriga a ler antes de conectar.
 */
const ITENS = [
  { t: 'O número já é usado no celular há pelo menos 14 dias', d: 'Conversas, áudios e grupos de verdade. Chip novo conectado direto no sistema é o padrão que o WhatsApp mais pune.' },
  { t: 'O chip foi registrado no WhatsApp há mais de 24 horas', d: 'Registrar e conectar logo em seguida é sinal de automação.' },
  { t: 'Removi os aparelhos antigos em "Dispositivos conectados"', d: 'Faça isso antes de ler o QR, não depois — remover depois derruba a conexão nova.' },
];

function ChecklistAntesDoQr({ checks, onChange }: { checks: boolean[]; onChange: (c: boolean[]) => void }) {
  return (
    <div className="text-left space-y-3">
      <p className="text-sm text-muted">Antes de conectar, confirme. Número que cai na primeira semana quase sempre falha em um destes pontos:</p>
      {ITENS.map((it, i) => (
        <label key={i} className="flex gap-3 rounded-lg border border-line p-3 cursor-pointer hover:bg-field">
          <input type="checkbox" className="mt-0.5" checked={checks[i]} onChange={(e) => onChange(checks.map((c, j) => (j === i ? e.target.checked : c)))} />
          <span className="text-sm">
            <span className="font-medium text-ink">{it.t}</span>
            <span className="block text-xs text-faint mt-0.5">{it.d}</span>
          </span>
        </label>
      ))}
      <p className="text-xs text-faint">Depois de conectar, o número passa 7 dias aquecendo: poucos contatos novos e menos mensagens automáticas por hora no começo.</p>
    </div>
  );
}
