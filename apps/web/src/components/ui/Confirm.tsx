'use client';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * Substitui window.confirm. `onConfirm` pode ser async: o botão mostra spinner
 * até terminar e o diálogo só fecha quando der certo.
 *
 * `typeToConfirm`: para o que é grande e sem volta (excluir em lote), o botão só libera depois
 * de digitar a palavra — um Enter ou clique distraído não apaga nada.
 */
export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirmar', danger, typeToConfirm, onConfirm, onClose }: { open: boolean; title: string; text: string; confirmLabel?: string; danger?: boolean; typeToConfirm?: string; onConfirm: () => void | Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  // reabrir começa vazio: a palavra digitada da vez anterior não pode valer para outra exclusão
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const locked = !!typeToConfirm && typed.trim().toUpperCase() !== typeToConfirm.toUpperCase();
  async function confirm() {
    if (locked) return;
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
      <p className="text-sm text-muted whitespace-pre-line">{text}</p>
      {typeToConfirm && (
        <label className="block text-sm pt-4">
          <span className="text-ink">Digite <strong>{typeToConfirm}</strong> para confirmar</span>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void confirm(); }} disabled={busy} className="mt-1 w-full rounded-lg border border-line px-3 py-2 focus:outline-none focus:ring-2 focus:ring-danger/40" />
        </label>
      )}
      <div className="flex justify-end gap-2 pt-5">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} loading={busy} disabled={locked}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
