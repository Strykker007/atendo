'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Volume2, VolumeX, UserRound, Building2, Headset } from 'lucide-react';
import { useUI } from '@/lib/store';
import { previewMessageSound } from '@/lib/message-sound';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { ScheduleSection } from '@/components/settings/ScheduleSection';
import { WelcomeSection } from '@/components/settings/WelcomeSection';
import { DefaultFlowsSection } from '@/components/settings/DefaultFlowsSection';
import { DepartmentsSection } from '@/components/settings/DepartmentsSection';
import { CompaniesSection } from '@/components/settings/CompaniesSection';
import { GlobalVariablesSection } from '@/components/settings/GlobalVariablesSection';
import { ClosingSection } from '@/components/settings/ClosingSection';
import { SignatureSection } from '@/components/settings/SignatureSection';
import { PixGatewaySection } from '@/components/settings/PixGatewaySection';
import { PublicPagesSection } from '@/components/settings/PublicPagesSection';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { useCan, useMe, useChangePassword, useNumbers, useUpdateMe } from '@/lib/hooks';

type Aba = 'conta' | 'empresa' | 'atendimento';
const ABAS: { id: Aba; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'conta', label: 'Minha conta', icon: <UserRound size={15} />, desc: 'Seu nome, aparência, notificações e senha — só para você.' },
  { id: 'empresa', label: 'Empresa', icon: <Building2 size={15} />, desc: 'Números, empresas/unidades, departamentos e variáveis usadas nas mensagens.' },
  { id: 'atendimento', label: 'Atendimento', icon: <Headset size={15} />, desc: 'Horários, boas-vindas, fluxos padrão e regras do encerramento.' },
];

/**
 * Configurações em abas. Era uma página só com tudo empilhado — perfil, tema, horários,
 * boas-vindas, fluxos, variáveis… — e cada configuração nova a deixava mais comprida. Agora:
 * o que é da pessoa (Minha conta), o que é da empresa (Empresa) e como a empresa atende
 * (Atendimento). Aba sem nada para a pessoa (permissão) não aparece. A aba fica no endereço
 * (`#atendimento`) para dar para mandar o link direto. Respostas rápidas viraram módulo próprio.
 */
export default function ConfiguracoesPage() {
  const me = useMe();
  const isOwner = me.data?.role === 'super_admin';
  // horário e fluxos padrão são configuração da empresa: a API recusa sem `settings.manage`,
  // e mostrar o formulário para quem não pode salvar é convite para perder trabalho digitado
  const podeConfigurar = useCan('settings.manage');
  const podeNumeros = useCan('numbers.manage');
  // departamentos decidem quem vê o quê: é gestão de equipe, não configuração da empresa
  const podeEquipe = useCan('team.manage');
  // a lista é de todos (aparece nos menus de variável); criar/editar/excluir é de quem tem a permissão
  const podeVariaveis = useCan('variables.manage');

  const temEmpresa = !isOwner && (podeNumeros || podeConfigurar || podeEquipe || podeVariaveis);
  const temAtendimento = !isOwner && podeConfigurar;
  const visiveis = ABAS.filter((a) => a.id === 'conta' || (a.id === 'empresa' && temEmpresa) || (a.id === 'atendimento' && temAtendimento));

  const [aba, setAba] = useState<Aba>('conta');
  // lê a aba do endereço depois de montar (no servidor não há `location`)
  useEffect(() => {
    const h = window.location.hash.slice(1) as Aba;
    if (ABAS.some((a) => a.id === h)) setAba(h);
  }, []);
  const escolher = (a: Aba) => { setAba(a); history.replaceState(null, '', `#${a}`); };
  const atual = visiveis.some((a) => a.id === aba) ? aba : 'conta';

  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Configurações" subtitle={ABAS.find((a) => a.id === atual)?.desc} />

      {visiveis.length > 1 && (
        <div role="tablist" aria-label="Seções das configurações" className="sticky top-0 z-10 -mt-1 mb-4 flex gap-1 rounded-xl border border-line bg-panel p-1">
          {visiveis.map((a) => (
            <button key={a.id} role="tab" aria-selected={atual === a.id} onClick={() => escolher(a.id)}
              className={cn('flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', atual === a.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink hover:bg-field')}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {atual === 'conta' && (
          <>
            {!me.data?.impersonatorId && me.data && <ProfileSection name={me.data.name} />}
            <AppearanceSection />
            <NotificationsSection />
            {!me.data?.impersonatorId && <SecuritySection />}
          </>
        )}
        {atual === 'empresa' && (
          <>
            {podeNumeros && <NumbersSection />}
            {podeConfigurar && <CompaniesSection />}
            {podeEquipe && <DepartmentsSection />}
            {podeVariaveis && <GlobalVariablesSection />}
            {podeConfigurar && <PixGatewaySection />}
            {podeConfigurar && <PublicPagesSection />}
          </>
        )}
        {atual === 'atendimento' && (
          <>
            <ScheduleSection />
            <WelcomeSection />
            <SignatureSection />
            <ClosingSection />
            <DefaultFlowsSection />
          </>
        )}
      </div>
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

/**
 * Som de mensagem nova. Preferência do navegador, como a aparência: cada atendente decide o seu
 * (o mesmo liga/desliga tem atalho no alto da lista de conversas).
 */
function NotificationsSection() {
  const { soundMuted, setSoundMuted } = useUI();
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink">Notificações</h2>
        <p className="text-sm text-muted">Vale só para este navegador. Também dá para ligar e desligar pelo ícone de som no alto da lista de conversas.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={!soundMuted}
          onClick={() => setSoundMuted(!soundMuted)}
          className={cn('relative w-9 h-5 rounded-full transition-colors shrink-0', !soundMuted ? 'bg-accent' : 'bg-line')}
          aria-label="Som de mensagem nova"
        >
          <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', !soundMuted ? 'left-[18px]' : 'left-0.5')} />
        </button>
        <span className="text-sm text-ink flex items-center gap-1.5 flex-1">
          {soundMuted ? <VolumeX size={15} className="text-muted" /> : <Volume2 size={15} className="text-accent-ink" />}
          Som ao chegar mensagem {soundMuted ? <span className="text-muted">(desligado)</span> : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void previewMessageSound()} disabled={soundMuted}>Testar som</Button>
      </div>
    </section>
  );
}

/** Meu perfil: o nome que a equipe vê (lista de atendentes, transferências, notas internas). */
function ProfileSection({ name }: { name: string }) {
  const update = useUpdateMe();
  const [value, setValue] = useState(name);
  const changed = value.trim() !== name && !!value.trim();
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink">Meu perfil</h2>
        <p className="text-sm text-muted">O nome que aparece para a equipe e nas transferências.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (!changed) return; update.mutateAsync({ name: value.trim() }).then(() => toast.ok('Nome atualizado')).catch(toast.err); }} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]"><Field label="Nome de exibição"><input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} required autoComplete="name" /></Field></div>
        <Button type="submit" loading={update.isPending} loadingText="Salvando…" disabled={!changed}>Salvar</Button>
      </form>
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
      {/* `items-start`, não `items-end`: a dica "mínimo 8 caracteres" fica abaixo do campo do meio
          e, alinhando pelo fim, era ela que empurrava aquele campo para cima. Os três rótulos têm
          uma linha só, então alinhar pelo topo deixa os três campos na mesma altura. */}
      <form onSubmit={(e) => { e.preventDefault(); if (mismatch) return; change.mutateAsync({ current: f.current, password: f.password }).then(() => { toast.ok('Senha alterada'); setF({ current: '', password: '', confirm: '' }); }).catch(toast.err); }} className="grid sm:grid-cols-3 gap-3 items-start">
        <Field label="Senha atual"><input type="password" className={inputCls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="Nova senha" hint="mínimo 8 caracteres"><input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} required autoComplete="new-password" /></Field>
        <Field label="Confirmar a nova senha"><input type="password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required autoComplete="new-password" /></Field>
        {mismatch && <p className="text-xs text-danger sm:col-span-3">As senhas não conferem.</p>}
        <div className="sm:col-span-3"><Button type="submit" loading={change.isPending} loadingText="Salvando…" disabled={!f.current || !f.password || mismatch}>Alterar senha</Button></div>
      </form>
    </section>
  );
}

/**
 * Números saiu do menu principal: é configuração de uma vez, não tarefa do dia.
 *
 * Fica como atalho e não como tela embutida porque o cadastro tem QR Code, troca de provider
 * e exclusão — coisas que pedem a página inteira.
 */
function NumbersSection() {
  const numbers = useNumbers();
  const conectados = numbers.data?.filter((n) => n.status === 'connected').length ?? 0;
  const total = numbers.data?.length ?? 0;
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 flex flex-wrap items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><Smartphone size={20} /></div>
      <div className="flex-1 min-w-48">
        <h2 className="font-display font-semibold text-ink">Números de WhatsApp</h2>
        <p className="text-sm text-muted">
          {total === 0 ? 'Nenhum número cadastrado ainda.' : `${total} cadastrado(s) · ${conectados} conectado(s).`} Conectar, trocar de provider e proteger o ritmo de envio.
        </p>
      </div>
      <Link href="/numeros" className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-field">Gerenciar números</Link>
    </section>
  );
}
