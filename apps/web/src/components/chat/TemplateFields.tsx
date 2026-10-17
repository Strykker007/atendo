'use client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, RefreshCw } from 'lucide-react';
import { renderTemplatePreview, templateHeaderMedia, type MessageTemplate, type TemplateChoice, type TemplateValues } from '@atendo/shared';
import { Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { uploadFile, useTemplates } from '@/lib/hooks';

/** O que vai para a API: nome + idioma, os valores (podem ter `{{contact.first_name}}`), botões e o arquivo do cabeçalho. */
export type { TemplateChoice };

const ACCEPT: Record<string, string> = { image: 'image/jpeg,image/png', video: 'video/mp4,video/3gpp', document: 'application/pdf' };

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
  const [buttons, setButtons] = useState<TemplateValues>(initial?.buttons ?? {});
  const [media, setMedia] = useState<{ key: string; name?: string } | null>(initial?.headerMediaKey ? { key: initial.headerMediaKey, name: initial.headerMediaName } : null);
  const tpl = templates.data?.find((t) => keyOf(t) === sel);
  const [primeira, setPrimeira] = useState(true);

  function escolher(key: string) {
    setSel(key);
    const t = templates.data?.find((x) => keyOf(x) === key);
    setHeader({});
    setButtons({});
    setMedia(null);
    setBody(t?.bodyParams[0] ? { [t.bodyParams[0]]: '{{contact.first_name}}' } : {});
  }
  // trocou de número: o template de outra conta não vale aqui (a escolha salva só na 1ª carga)
  useEffect(() => { if (primeira) { setPrimeira(false); return; } setSel(''); setHeader({}); setBody({}); setButtons({}); setMedia(null); }, [numberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const faltando = !!tpl && (
    [...tpl.headerParams.map((k) => header[k]), ...tpl.bodyParams.map((k) => body[k]), ...(tpl.dynamicButtons ?? []).map((b) => buttons[String(b.index)])].some((v) => !v?.trim())
    || (!!templateHeaderMedia(tpl) && !media)
  );
  const valid = !!tpl && !tpl.unsupported && !faltando;
  const value: TemplateChoice | null = tpl
    ? { name: tpl.name, language: tpl.language, header, body, ...(tpl.dynamicButtons?.length && { buttons }), ...(templateHeaderMedia(tpl) && media && { headerMediaKey: media.key, headerMediaName: media.name }) }
    : null;
  return { templates, sel, escolher, tpl, header, setHeader, body, setBody, buttons, setButtons, media, setMedia, valid, value, reset: () => escolher('') };
}

export type TemplateChoiceState = ReturnType<typeof useTemplateChoice>;

/**
 * Seletor + campos das variáveis + prévia. `hint` troca o texto de ajuda das variáveis (a Agenda
 * oferece `{{servico}}`, `{{data}}`…). `preview` desliga a prévia onde não cabe.
 */
export function TemplateFields({ choice, hint, preview = true }: { choice: TemplateChoiceState; hint?: React.ReactNode; preview?: boolean }) {
  const { templates, sel, escolher, tpl, header, setHeader, body, setBody, buttons, setButtons } = choice;
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
          {(tpl.dynamicButtons ?? []).map((b) => (
            <Field key={`button-${b.index}`} label={`Botão "${b.text}" · ${b.kind === 'url' ? 'final do link' : 'código do cupom'}`} hint={b.kind === 'url' ? b.url : 'Até 15 caracteres.'}>
              <input value={buttons[String(b.index)] ?? ''} onChange={(e) => setButtons((v) => ({ ...v, [String(b.index)]: e.target.value }))} maxLength={b.kind === 'url' ? 1024 : 15} className={inputCls} />
            </Field>
          ))}
          {templateHeaderMedia(tpl) && <HeaderMediaField choice={choice} />}
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

/** Arquivo do cabeçalho de mídia: sobe pelo `/uploads` e guarda a chave na escolha. */
function HeaderMediaField({ choice }: { choice: TemplateChoiceState }) {
  const { tpl, media, setMedia } = choice;
  const input = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);
  const kind = tpl ? templateHeaderMedia(tpl) : null;
  if (!kind) return null;
  const label = kind === 'image' ? 'Imagem' : kind === 'video' ? 'Vídeo' : 'Documento (PDF)';
  async function escolher(file?: File) {
    if (!file) return;
    setSubindo(true);
    try {
      const up = await uploadFile(file);
      setMedia({ key: up.key, name: up.fileName });
    } catch (e) {
      toast.err(e);
    } finally {
      setSubindo(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <Field label={`Cabeçalho · ${label}`} hint="O arquivo vai no topo do template, como a Meta aprovou o formato.">
      <div className="flex items-center gap-2">
        <input ref={input} type="file" accept={ACCEPT[kind]} className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
        <Button type="button" variant="ghost" onClick={() => input.current?.click()} loading={subindo} loadingText="Enviando…"><Paperclip size={14} /> {media ? 'Trocar arquivo' : 'Anexar arquivo'}</Button>
        {media && <span className="text-xs text-faint truncate">{media.name ?? 'arquivo anexado'}</span>}
      </div>
    </Field>
  );
}
