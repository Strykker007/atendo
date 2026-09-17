'use client';
import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * Substitui window.confirm. `onConfirm` pode ser async: o botão mostra spinner
 * até terminar e o diálogo só fecha quando der certo.
 */
export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: { open: boolean; title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      /* quem chamou já mostrou o toast */
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title} width="max-w-sm">
      <p className="text-sm text-gray-600">{text}</p>
      <div className="flex justify-end gap-2 pt-5">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
