'use client';
import { useState } from 'react';
import { KeyRound, CircleCheck, AlertTriangle } from 'lucide-react';
import { AI_KEY_PROVIDERS, AI_KEY_PROVIDER_IDS, type AiKeyProvider } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useAiOwnKey, useAiOwnKeyUsage, useRemoveAiOwnKey, useSaveAiOwnKey } from '@/lib/hooks';

/**
 * Chave de IA própria (feature `ai_own_key`, docs/15-ia.md#chave-própria-do-cliente). A empresa
 * cola a chave da OpenAI, da Anthropic ou do Google (Gemini, que tem plano grátis); a IA dela passa a rodar nessa conta, fora da cota de
 * interações do plano. A chave é validada no fornecedor antes de gravar e nunca volta para a tela.
 */
export function AiOwnKeySection() {
  const q = useAiOwnKey();
  const save = useSaveAiOwnKey();
  const remove = useRemoveAiOwnKey();
  const [provider, setProvider] = useState<AiKeyProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const s = q.data;
  const info = AI_KEY_PROVIDERS[provider];

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({ provider, apiKey: apiKey.trim(), model: model || undefined });
      setApiKey('');
      setTrocando(false);
      toast.ok('Chave validada e gravada — a IA já usa a sua conta');
    } catch (err) { toast.err(err); }
  }

  if (!s) return null;
  // sem o recurso e sem chave gravada: não polui a tela de quem não contratou
  if (!s.feature && !s.connected) return null;

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-2"><KeyRound size={16} className="text-accent" /> Chave de IA própria</h2>
        <p className="text-xs text-muted mt-0.5">Use a sua conta da OpenAI (ChatGPT), da Anthropic (Claude) ou do Google (Gemini, que tem plano grátis). O consumo é cobrado direto pelo fornecedor e não entra no limite de interações do plano.</p>
      </div>

      {!s.feature && s.connected && (
        <p className="rounded-xl bg-field px-4 py-3 text-sm text-muted">Seu plano não inclui mais a chave própria: a IA voltou a usar a do sistema. A chave gravada pode ser apagada abaixo.</p>
      )}

      {s.connected && !trocando && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
            <CircleCheck size={18} className={s.inUse ? 'text-ok shrink-0' : 'text-muted shrink-0'} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-ink">{s.provider ? AI_KEY_PROVIDERS[s.provider].label : s.provider} · final {s.keyLast4}</div>
              <div className="text-xs text-muted">Modelo {s.model}{s.updatedAt ? ` · gravada em ${new Date(s.updatedAt).toLocaleDateString('pt-BR')}` : ''}</div>
            </div>
            {s.feature && <Button variant="ghost" size="sm" onClick={() => { setProvider(s.provider ?? 'openai'); setModel(''); setTrocando(true); }}>Trocar chave</Button>}
            <Button variant="subtle" size="sm" onClick={() => setSaindo(true)}>Apagar</Button>
          </div>
          {s.inUse && <OwnKeyUsage />}
          {s.lastError && (
            <p className="flex items-start gap-2 rounded-xl bg-warn/10 px-4 py-2.5 text-xs text-ink">
              <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
              <span>Última chamada falhou{s.lastErrorAt ? ` em ${new Date(s.lastErrorAt).toLocaleString('pt-BR')}` : ''}: {s.lastError}. Confira a chave e o crédito na conta do fornecedor.</span>
            </p>
          )}
        </div>
      )}

      {s.feature && (!s.connected || trocando) && (
        <form onSubmit={salvar} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {AI_KEY_PROVIDER_IDS.map((p) => (
              <button key={p} type="button" onClick={() => { setProvider(p); setModel(''); }}
                className={`rounded-lg border px-3 py-1.5 text-[13px] ${provider === p ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:text-ink'}`}>
                {AI_KEY_PROVIDERS[p].label}
              </button>
            ))}
          </div>
          <ol className="text-xs text-muted list-decimal pl-4 space-y-0.5">
            <li>Crie a chave em <a href={info.consoleUrl} target="_blank" rel="noreferrer" className="text-accent underline">{new URL(info.consoleUrl).host}</a>{provider === 'gemini' ? '. No plano grátis não precisa de cartão.' : ' e confira se a conta tem crédito.'}</li>
            <li>Cole aqui. O sistema confere a chave no fornecedor antes de gravar; ela fica criptografada e não aparece de novo.</li>
          </ol>
          {provider === 'gemini' && (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-ink">
              <b>Plano grátis do Gemini:</b> tem limite de pedidos por minuto e por dia. Quando um modelo chega no limite, o sistema usa o outro; se os dois estiverem no limite, o agente de IA responde alguns segundos depois. Se o limite do dia acabar, a conversa vai para a equipe até a meia-noite do horário do Pacífico (~4h/5h de Brasília). No plano grátis, o Google pode usar as conversas para melhorar os produtos dele. Para dados sensíveis, ative o faturamento no Google.
            </p>
          )}
          <input className={inputCls} type="password" autoComplete="off" placeholder={info.keyHint} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Modelo padrão ({info.defaultModel})</option>
            {info.models.filter((m) => m !== info.defaultModel).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            {trocando && <Button type="button" variant="ghost" onClick={() => setTrocando(false)}>Cancelar</Button>}
            <Button type="submit" disabled={apiKey.trim().length < 20} loading={save.isPending} loadingText="Validando…">Gravar chave</Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={saindo}
        title="Apagar a chave de IA?"
        text="A IA volta a usar a do sistema, contando no limite de interações do plano. Se o plano não incluir IA, os recursos de IA param."
        confirmLabel="Apagar"
        danger
        onClose={() => setSaindo(false)}
        onConfirm={() => remove.mutateAsync().then(() => toast.ok('Chave apagada'), toast.err)}
      />
    </section>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Uso de hoje e do mês pela chave + situação dos modelos do Gemini (docs/15-ia.md#uso-da-chave-própria). */
function OwnKeyUsage() {
  const u = useAiOwnKeyUsage(true).data;
  if (!u) return null;
  const n = (v: number) => v.toLocaleString('pt-BR');
  return (
    <div className="rounded-xl border border-line px-4 py-3 space-y-2 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Respostas hoje" value={n(u.today.answered)} />
        <Stat label="No limite (respondidas depois)" value={n(u.today.limited)} />
        <Stat label="Pagas com o saldo hoje" value={n(u.today.viaCredit)} />
        <Stat label="No mês" value={`${n(u.month.answered)}${u.month.viaCredit ? ` + ${n(u.month.viaCredit)} pelo saldo` : ''}`} />
      </div>
      {u.models.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {u.models.map((m) => (
            <li key={m.model} className={`rounded-full border px-2.5 py-1 ${m.state === 'free' ? 'border-ok/40 text-ok' : m.state === 'daily' ? 'border-danger/40 text-danger' : 'border-warn/40 text-warn'}`}>
              {m.model}: {m.state === 'free' ? 'livre' : m.state === 'daily' ? `limite do dia até ${m.until ? hora(m.until) : '—'}` : `limite do minuto até ${m.until ? hora(m.until) : '—'}`}
            </li>
          ))}
        </ul>
      )}
      {u.today.failed > 0 && <p className="text-xs text-muted">{n(u.today.failed)} chamada(s) falharam hoje por outro motivo.</p>}
      <p className="text-[11px] text-faint">O limite exato de cada modelo aparece no painel do fornecedor (no Gemini: aistudio.google.com, em Uso). Quando o grátis acaba, o saldo de IA (em Plano e uso) continua respondendo.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-field px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-semibold text-ink">{value}</div>
    </div>
  );
}
