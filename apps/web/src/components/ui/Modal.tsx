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
    <div data-overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] grid place-items-center px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${width} bg-panel rounded-2xl shadow-xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-faint hover:text-ink"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block text-sm space-y-1">
    <span className="text-ink font-medium">{label}</span>
    {children}
    {hint && <span className="block text-xs text-faint">{hint}</span>}
  </label>
);
export const inputCls = 'w-full rounded-lg border border-line bg-panel text-ink placeholder:text-faint px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent';
export const btnPrimary = 'rounded-lg bg-accent hover:bg-accent-hover text-white px-4 py-2 text-sm font-medium disabled:opacity-60';
export const btnGhost = 'rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-field disabled:opacity-60';
