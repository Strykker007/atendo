'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { Modal, btnGhost } from '@/components/ui/Modal';
import { useConnectNumber, useNumberQr, useNumbers } from '@/lib/hooks';

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
  const qr = live.data ?? initialQr;
  const connected = number?.status === 'connected';

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
          <div className="py-8 text-brand">
            <CheckCircle2 size={56} className="mx-auto" />
            <p className="mt-3 font-medium">Número conectado!</p>
          </div>
        ) : qr ? (
          <>
            <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR code" className="mx-auto w-64 h-64 rounded-lg border border-surface-border" />
            <ol className="text-left text-sm text-gray-600 space-y-1 mx-auto max-w-xs">
              <li>1. Abra o WhatsApp no celular deste número</li>
              <li>2. Toque em <b>Mais opções ⋮ → Dispositivos conectados</b></li>
              <li>3. Toque em <b>Conectar dispositivo</b> e aponte para o QR</li>
            </ol>
            <p className="text-xs text-gray-400">O QR expira em ~40s. Se expirar, gere outro.</p>
          </>
        ) : (
          <p className="py-8 text-sm text-gray-500">Gerando QR code…</p>
        )}
        <div className="flex justify-center gap-2">
          {!connected && (
            <button onClick={refresh} disabled={connect.isPending} className={btnGhost}>
              <RefreshCw size={14} className={`inline mr-1 ${connect.isPending ? 'animate-spin' : ''}`} /> Gerar novo QR
            </button>
          )}
          <button onClick={onClose} className={btnGhost}>{connected ? 'Fechar' : 'Depois'}</button>
        </div>
      </div>
    </Modal>
  );
}
