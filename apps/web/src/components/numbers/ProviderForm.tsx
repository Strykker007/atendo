'use client';
import { useState } from 'react';
import { ShieldCheck, QrCode, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Field, inputCls } from '@/components/ui/Modal';
import type { ProviderConfig } from '@/lib/hooks';

export type Provider = 'meta' | 'evolution';

/**
 * Escolha do provider + credenciais. Reutilizado no cadastro e na troca.
 * Evolution: não precisa de credencial (a instância é criada pela API e conectada por QR).
 * Meta: precisa de phone_number_id, WABA id e token permanente do System User.
 */
export function ProviderForm({ value, onChange, config, onConfig }: { value: Provider; onChange: (p: Provider) => void; config: Record<string, string>; onConfig: (c: Record<string, string>) => void }) {
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => onConfig({ ...config, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ProviderCard active={value === 'evolution'} onClick={() => onChange('evolution')} icon={<QrCode size={20} />} title="Conexão Web (WhatsApp QR Code)" desc="Qualquer número. Conecta em 2 min. Grátis por mensagem." />
        <ProviderCard active={value === 'meta'} onClick={() => onChange('meta')} icon={<ShieldCheck size={20} />} title="Meta Cloud API" desc="Número de negócio verificado pela Meta, com suporte oficial." />
      </div>

      {value === 'evolution' ? (
        <div className="flex gap-2 rounded-lg bg-warn-soft border border-warn/30 p-3 text-xs text-warn-ink">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Este modo conecta lendo o QR Code, como no WhatsApp Web: o celular precisa continuar com a conta ativa. Indicado para atendimento do dia a dia.</span>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Phone Number ID" hint="Meta Business → WhatsApp → Configuração da API"><input className={inputCls} value={config.phoneNumberId ?? ''} onChange={set('phoneNumberId')} required /></Field>
          <Field label="WABA ID (conta comercial)"><input className={inputCls} value={config.wabaId ?? ''} onChange={set('wabaId')} required /></Field>
          <Field label="Token permanente" hint="Token de System User com permissão whatsapp_business_messaging. Fica criptografado no banco."><input type="password" className={inputCls} value={config.accessToken ?? ''} onChange={set('accessToken')} required /></Field>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('text-left rounded-xl border p-3 transition-colors', active ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line hover:bg-field')}>
      <div className={cn('mb-1', active ? 'text-accent' : 'text-muted')}>{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted mt-0.5">{desc}</div>
    </button>
  );
}

export function toConfig(provider: Provider, c: Record<string, string>): ProviderConfig {
  return provider === 'meta' ? { phoneNumberId: c.phoneNumberId, wabaId: c.wabaId, accessToken: c.accessToken } : {};
}

export function useProviderState(initial: Provider = 'evolution') {
  const [provider, setProvider] = useState<Provider>(initial);
  const [config, setConfig] = useState<Record<string, string>>({});
  return { provider, setProvider, config, setConfig };
}
