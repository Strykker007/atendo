'use client';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Aviso obrigatório antes de transmitir pelo QR Code. O aceite fica gravado na campanha (quem e
 * quando) — a API recusa iniciar sem ele (`qr_risk_not_accepted`).
 */
export function QrRiskModal({ onClose, onAccept }: { onClose: () => void; onAccept: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <Modal open onClose={onClose} title="Aviso de segurança" width="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-lg bg-warn-soft p-3 text-[13px] text-warn-ink">
          <ShieldAlert size={18} className="shrink-0 mt-0.5" />
          <p>
            O envio em massa por QR Code para contatos frios possui <b>risco de bloqueio pelo WhatsApp</b>. O teto e os
            delays estão ativos para mitigar riscos, mas a saúde do número é de responsabilidade da empresa.
          </p>
        </div>
        <ul className="list-disc pl-5 text-[12.5px] text-muted space-y-1">
          <li>Uma mensagem a cada 20–60 segundos, só no horário de funcionamento.</li>
          <li>Teto de envios por 24h neste número; o restante continua no dia seguinte.</li>
          <li>Três falhas seguidas pausam a transmissão na hora.</li>
          <li>Quem responder “sair” deixa de receber.</li>
        </ul>
        <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          Li e aceito o risco. A saúde do número é responsabilidade da empresa.
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button disabled={!ok} onClick={onAccept}>Iniciar transmissão</Button>
        </div>
      </div>
    </Modal>
  );
}
