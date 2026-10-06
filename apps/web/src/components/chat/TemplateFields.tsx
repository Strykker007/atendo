'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { renderTemplatePreview, type MessageTemplate, type TemplateValues } from '@atendo/shared';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useTemplates } from '@/lib/hooks';

/** O que vai para a API: nome + idioma e os valores (podem ter `{{contact.first_name}}`). */
export interface TemplateChoice { name: string; language: string; header?: TemplateValues; body?: TemplateValues }

const keyOf = (t: Pick<MessageTemplate, 'name' | 'language'>) => `${t.name}|${t.language}`;

/**
 * Estado do seletor de template de um número. `initial` reabre uma escolha salva (Agenda);
 * sem ela, o `{{1}}` do corpo já começa com o primeiro nome — é o caso comum.
 */
export function useTemplateChoice(numberId: string | null, enabled = true, initial?: TemplateChoice | null) {
  const templates = useTemplates(numberId, enabled);
  const [sel, setSel] = useState(initial ? keyOf(initial) : '');
  const [header, setHeader] = useState<TemplateValues>(initial?.header ?? {});
  const [body, setBody] = useState<TemplateValues>(initial?.body ?? {});
  const tpl = templates.data?.find((t) => keyOf(t) === sel);
  const [primeira, setPrimeira] = useState(true);

  function escolher(key: string) {
    setSel(key);
    const t = templates.data?.find((x) => keyOf(x) === key);
    setHeader({});
    setBody(t?.bodyParams[0] ? { [t.bodyParams[0]]: '{{contact.first_name}}' } : {});
  }
  // trocou de número: o template de outra conta não vale aqui (a escolha salva só na 1ª carga)
  useEffect(() => { if (primeira) { setPrimeira(false); return; } setSel(''); setHeader({}); setBody({}); }, [numberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const faltando = !!tpl && [...tpl.headerParams.map((k) => header[k]), ...tpl.bodyParams.map((k) => body[k])].some((v) => !v?.trim());
  const valid = !!tpl && !tpl.unsupported && !faltando;
  const value: TemplateChoice | null = tpl ? { name: tpl.name, language: tpl.language, header, body } : null;
  return { templates, sel, escolher, tpl, header, setHeader, body, setBody, valid, value, reset: () => escolher('') };
}

export type TemplateChoiceState = ReturnType<typeof useTemplateChoice>;

/**
 * Seletor + campos das variáveis + prévia. `hint` troca o texto de ajuda das variáveis (a Agenda
 * oferece `{{servico}}`, `{{data}}`…). `preview` desliga a prévia onde não cabe.
 */
export function TemplateFields({ choice, hint, preview = true }: { choice: TemplateChoiceState; hint?: React.ReactNode; preview?: boolean }) {
  const { templates, sel, escolher, tpl, header, setHeader, body, setBody } = choice;
  const salvoSumiu = !!sel && !tpl && !templates.isLoading && !!templates.data;
  return (
    <>
      <Field
        label="Template"
        hint={
          templates.isError ? 'Não foi possível buscar os templates na Meta. Confira o WABA ID e o token do número.'
            : salvoSumiu ? `O template "${sel.split('|')[0]}" não está mais aprovado nesta conta. Escolha outro.`
            : !templates.isLoading && !templates.data?.length ? 'Nenhum template aprovado nesta conta. Crie e aprove no Gerenciador do WhatsApp e clique em sincronizar.'
            : tpl?.unsupported
        }
      >
        <div className="flex gap-2">
          <select value={tpl ? sel : ''} onChange={(e) => escolher(e.target.value)} className={inputCls} disabled={templates.isLoading}>
            <option value="">{templates.isLoading ? 'Carregando…' : 'Escolha um template'}</option>
            {templates.data?.map((t) => <option key={keyOf(t)} value={keyOf(t)} disabled={!!t.unsupported}>{t.name} ({t.language}){t.unsupported ? ' — indisponível' : ''}</option>)}
          </select>
          <Button type="button" variant="ghost" title="Sincronizar com a Meta" onClick={() => templates.sync.mutate(undefined, { onError: (e) => toast.err(e) })} loading={templates.sync.isPending}><RefreshCw size={14} /></Button>
        </div>
      </Field>
      {tpl && !tpl.unsupported && (
        <>
          {[...tpl.headerParams.map((k) => ['header', k] as const), ...tpl.bodyParams.map((k) => ['body', k] as const)].map(([onde, k]) => {
            const vals = onde === 'header' ? header : body;
            const set = onde === 'header' ? setHeader : setBody;
            return (
              <Field key={`${onde}-${k}`} label={`${onde === 'header' ? 'Cabeçalho' : 'Corpo'} · {{${k}}}`}>
                <input value={vals[k] ?? ''} onChange={(e) => set((v) => ({ ...v, [k]: e.target.value }))} maxLength={1024} className={inputCls} />
              </Field>
            );
          })}
          {(tpl.headerParams.length > 0 || tpl.bodyParams.length > 0) && <p className="text-xs text-faint">{hint ?? <>Aceita variáveis como {'{{contact.first_name}}'}, {'{{contact.name}}'} e as globais da empresa.</>}</p>}
          {preview && (
            <div className="rounded-lg bg-field px-3 py-2 text-sm text-ink whitespace-pre-wrap break-words">
              {renderTemplatePreview(tpl, header, body)}
              {!!tpl.buttons?.length && <div className="mt-2 flex flex-wrap gap-1">{tpl.buttons.map((b) => <span key={b} className="text-xs rounded-md border border-line px-2 py-0.5 text-accent-ink">{b}</span>)}</div>}
            </div>
          )}
          <p className="text-xs text-faint">Template é cobrado pela Meta por conversa iniciada ({tpl.category === 'marketing' ? 'marketing' : 'utilidade'}).</p>
        </>
      )}
    </>
  );
}
