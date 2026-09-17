'use client';
import { Modal, btnGhost } from './Modal';

/** Substitui window.confirm — funciona em qualquer navegador e segue o visual do app. */
export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: { open: boolean; title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm">
      <p className="text-sm text-gray-600">{text}</p>
      <div className="flex justify-end gap-2 pt-5">
        <button onClick={onClose} className={btnGhost}>Cancelar</button>
        <button onClick={() => { onConfirm(); onClose(); }} className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-hover'}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
