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
  useEffect(() => { if (connected) setSeenConnected(true); }, [connected]);
  useEffect(() => { setSeenConnected(false); }, [numberId]);
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
    const r = await connect.mutateAsync(numberId);
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
          {!connected && (
            <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => refresh().catch(toast.err)} loading={connect.isPending} loadingText="Gerando…">Gerar novo QR</Button>
          )}
          <Button variant="ghost" onClick={onClose}>{connected ? 'Fechar' : 'Depois'}</Button>
        </div>
      </div>
    </Modal>
  );
}
