'use client';
import { useState } from 'react';
import { KeyRound, CircleCheck, AlertTriangle } from 'lucide-react';
import { AI_KEY_PROVIDERS, AI_KEY_PROVIDER_IDS, type AiKeyProvider } from '@atendo/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useAiOwnKey, useRemoveAiOwnKey, useSaveAiOwnKey } from '@/lib/hooks';

/**
 * Chave de IA própria (feature `ai_own_key`, docs/15-ia.md#chave-própria-do-cliente). A empresa
 * cola a chave da OpenAI ou da Anthropic; a IA dela passa a rodar nessa conta, fora da cota de
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
        <p className="text-xs text-muted mt-0.5">Use a sua conta da OpenAI (ChatGPT) ou da Anthropic (Claude). O consumo é cobrado direto pelo fornecedor e não entra no limite de interações do plano.</p>
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
            <li>Crie a chave em <a href={info.consoleUrl} target="_blank" rel="noreferrer" className="text-accent underline">{new URL(info.consoleUrl).host}</a> e confira se a conta tem crédito.</li>
            <li>Cole aqui. O sistema confere a chave no fornecedor antes de gravar; ela fica criptografada e não aparece de novo.</li>
          </ol>
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
