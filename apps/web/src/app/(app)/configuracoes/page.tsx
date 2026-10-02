'use client';
import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { BusinessHoursSection } from '@/components/settings/BusinessHoursSection';
import { DefaultFlowsSection } from '@/components/settings/DefaultFlowsSection';
import { useMe, useChangePassword } from '@/lib/hooks';

/** Configurações do cliente: aparência, horário, fluxos padrão e segurança. As respostas
 *  rápidas saíram daqui e viraram módulo próprio (/respostas). */
export default function ConfiguracoesPage() {
  const me = useMe();
  const isOwner = me.data?.role === 'super_admin';



  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Configurações" subtitle="Aparência do painel, horário de funcionamento e segurança." />

      <AppearanceSection />
      {!isOwner && <BusinessHoursSection />}
      {!isOwner && <DefaultFlowsSection />}
      {!me.data?.impersonatorId && <SecuritySection />}

    </PageShell>
  );
}


const THEMES: { mode: ThemeMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { mode: 'light', label: 'Claro', desc: 'Semáforo — status em cor forte, área clara', icon: <Sun size={18} /> },
  { mode: 'dark', label: 'Escuro', desc: 'Sala de controle — para turnos longos', icon: <Moon size={18} /> },
  { mode: 'system', label: 'Do sistema', desc: 'Acompanha o modo do seu computador', icon: <Monitor size={18} /> },
];

/** Aparência: escolha de tema (salva no navegador de cada usuário). */
function AppearanceSection() {
  const { mode, setMode } = useTheme();
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink">Aparência</h2>
        <p className="text-sm text-muted">Vale só para este navegador — cada atendente escolhe o seu.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button key={t.mode} type="button" onClick={() => setMode(t.mode)} className={cn('text-left rounded-xl border p-3 transition-colors', mode === t.mode ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line hover:bg-field')}>
            <div className={cn('mb-1', mode === t.mode ? 'text-accent-ink' : 'text-muted')}>{t.icon}</div>
            <div className="text-sm font-semibold text-ink">{t.label}</div>
            <div className="text-xs text-muted mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Segurança: trocar a própria senha. */
function SecuritySection() {
  const change = useChangePassword();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const mismatch = f.confirm.length > 0 && f.password !== f.confirm;
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink">Segurança</h2>
        <p className="text-sm text-muted">Troque a sua senha. As outras sessões abertas serão encerradas.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (mismatch) return; change.mutateAsync({ current: f.current, password: f.password }).then(() => { toast.ok('Senha alterada'); setF({ current: '', password: '', confirm: '' }); }).catch(toast.err); }} className="grid sm:grid-cols-3 gap-3 items-end">
        <Field label="Senha atual"><input type="password" className={inputCls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="Nova senha" hint="mínimo 8"><input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} required autoComplete="new-password" /></Field>
        <Field label="Confirmar"><input type="password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required autoComplete="new-password" /></Field>
        {mismatch && <p className="text-xs text-danger sm:col-span-3">As senhas não conferem.</p>}
        <div className="sm:col-span-3"><Button type="submit" loading={change.isPending} loadingText="Salvando…" disabled={!f.current || !f.password || mismatch}>Alterar senha</Button></div>
      </form>
    </section>
  );
}
