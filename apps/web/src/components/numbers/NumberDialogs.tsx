'use client';
import { useState } from 'react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ProviderForm, toConfig, useProviderState } from './ProviderForm';
import { useCreateNumber, useSwitchProvider, type NumberItem } from '@/lib/hooks';

type Done = (r: { id: string; qrCode?: string; provider: 'meta' | 'evolution' }) => void;

export function CreateNumberModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: Done }) {
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ps = useProviderState();
  const create = useCreateNumber();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await create.mutateAsync({ phone: phone.replace(/\D/g, ''), label, provider: ps.provider, config: toConfig(ps.provider, ps.config) });
      onDone({ id: r.id, qrCode: r.qrCode, provider: ps.provider });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo número">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome (como aparece no painel)"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vendas, Suporte…" required /></Field>
          <Field label="Telefone com DDI" hint="Ex.: 5511999998888"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55…" required /></Field>
        </div>
        <ProviderForm value={ps.provider} onChange={ps.setProvider} config={ps.config} onConfig={ps.setConfig} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button type="submit" loading={create.isPending} loadingText={ps.provider === 'evolution' ? 'Criando e gerando QR…' : 'Validando na Meta…'}>{ps.provider === 'evolution' ? 'Criar e gerar QR' : 'Criar e validar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** A troca oficial <-> não-oficial. Uma tela, um clique. */
export function SwitchProviderModal({ number, onClose, onDone }: { number: NumberItem | null; onClose: () => void; onDone: Done }) {
  const ps = useProviderState(number?.provider === 'meta' ? 'evolution' : 'meta');
  const [error, setError] = useState<string | null>(null);
  const sw = useSwitchProvider();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number) return;
    setError(null);
    try {
      const r = await sw.mutateAsync({ id: number.id, provider: ps.provider, config: toConfig(ps.provider, ps.config) });
      onDone({ id: number.id, qrCode: r.qrCode, provider: ps.provider });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    }
  }

  return (
    <Modal open={!!number} onClose={onClose} title={`Trocar provider · ${number?.label ?? ''}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Atualmente em <b>{number?.provider === 'meta' ? 'Oficial (Meta)' : 'Não-oficial (QR)'}</b>. As conversas e o histórico continuam intactos; só a forma de enviar e receber muda.
        </p>
        <ProviderForm value={ps.provider} onChange={ps.setProvider} config={ps.config} onConfig={ps.setConfig} />
        {ps.provider === 'meta' && (
          <p className="text-xs text-gray-500">Lembrete: na Meta, mensagens fora da janela de 24h só saem por template aprovado.</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={sw.isPending}>Cancelar</Button>
          <Button type="submit" loading={sw.isPending} loadingText="Trocando…" disabled={ps.provider === number?.provider}>Trocar agora</Button>
        </div>
      </form>
    </Modal>
  );
}
