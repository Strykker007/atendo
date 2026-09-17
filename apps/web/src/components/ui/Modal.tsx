'use client';
import { X } from 'lucide-react';
import { useEffect } from 'react';

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${width} bg-white rounded-2xl shadow-xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block text-sm space-y-1">
    <span className="text-gray-700 font-medium">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-400">{hint}</span>}
  </label>
);
export const inputCls = 'w-full rounded-lg border border-surface-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40';
export const btnPrimary = 'rounded-lg bg-brand hover:bg-brand-hover text-white px-4 py-2 text-sm font-medium disabled:opacity-60';
export const btnGhost = 'rounded-lg border border-surface-border px-4 py-2 text-sm text-gray-700 hover:bg-surface-muted disabled:opacity-60';
