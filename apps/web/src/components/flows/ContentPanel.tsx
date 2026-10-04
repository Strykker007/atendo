'use client';
import { useContext, useState } from 'react';
import { ArrowUp, ArrowDown, X, Type, Image as ImageIcon, Film, FileText, Mic, Paperclip, AlertTriangle, Timer } from 'lucide-react';
import { CONTENT_MAX_DELAY_SEC, CONTENT_MEDIA_RULES, contentMediaError, type ContentItem, type ContentItemKind, type ContentMediaKind } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { uploadFile } from '@/lib/hooks';
import { TextWithVars, type FlowVar } from './TextWithVars';
import { ContentPreview, FlowEditorRefs, contentWarnings } from './nodes';

const KIND_META: Record<ContentItemKind, { label: string; icon: React.ReactNode }> = {
  text: { label: 'Texto', icon: <Type size={13} /> },
  image: { label: 'Imagem', icon: <ImageIcon size={13} /> },
  video: { label: 'Vídeo', icon: <Film size={13} /> },
  document: { label: 'Documento', icon: <FileText size={13} /> },
  audio: { label: 'Áudio', icon: <Mic size={13} /> },
};

/** Extensões além dos MIME: alguns sistemas mandam documento do Office sem tipo. */
const ACCEPT: Record<ContentMediaKind, string> = {
  image: CONTENT_MEDIA_RULES.image.mimes.join(','),
  video: CONTENT_MEDIA_RULES.video.mimes.join(','),
  audio: CONTENT_MEDIA_RULES.audio.mimes.join(',') + ',.ogg,.opus,.mp3,.m4a,.aac',
  document: CONTENT_MEDIA_RULES.document.mimes.join(',') + ',.pdf,.doc,.docx,.xls,.xlsx,.pptx',
};

const shortId = () => crypto.randomUUID().slice(0, 8);
const DEFAULT_DELAY_SEC = 1;

/**
 * Editor do bloco Conteúdo: mensagens em sequência, reordenáveis, com intervalo opcional.
 * O arquivo é checado contra os limites do WhatsApp antes de subir (a API checa de novo ao salvar).
 */
export function ContentPanel({ items, onChange, vars }: { items: ContentItem[]; onChange: (items: ContentItem[]) => void; vars: FlowVar[] }) {
  const refs = useContext(FlowEditorRefs);
  const [uploading, setUploading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upd = (id: string, patch: Partial<ContentItem>) => onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const setError = (id: string, msg?: string) => setErrors((e) => {
    const { [id]: _old, ...rest } = e;
    void _old;
    return msg ? { ...rest, [id]: msg } : rest;
  });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // mensagem nova depois de outra já nasce com 1 s de intervalo: ajuda a manter a ordem de chegada
  const add = (kind: ContentItemKind) => onChange([...items, { id: shortId(), kind, ...(items.length > 0 && { delay: DEFAULT_DELAY_SEC }), ...(kind === 'text' && { text: '' }), ...(kind === 'audio' && { voice: true }) }]);

  async function pick(it: ContentItem, file: File) {
    const kind = it.kind as ContentMediaKind;
    // navegador sem tipo (alguns .docx): o tamanho ainda é checado; o tipo, a API confere no upload
    const err = contentMediaError(kind, file.type || undefined, file.size);
    if (err) return setError(it.id, err);
    setError(it.id);
    setUploading(it.id);
    try {
      const up = await uploadFile(file);
      refs.rememberMedia(up.key, up.url);
      upd(it.id, { mediaKey: up.key, mediaName: up.fileName, mimeType: up.mimeType, size: up.size });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(it.id, /too large|413/i.test(msg) ? 'Arquivo maior que o limite de upload do servidor.' : msg);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const media = it.kind !== 'text' ? CONTENT_MEDIA_RULES[it.kind] : null;
        const warnings = contentWarnings(it, refs.providers);
        return (
          <div key={it.id} className="space-y-2">
            {i > 0 && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <Timer size={12} /> Esperar
                <input type="number" min={0} max={CONTENT_MAX_DELAY_SEC} className={cn(inputCls, 'w-16 py-0.5')} value={it.delay ?? 0} onChange={(e) => upd(it.id, { delay: Math.min(CONTENT_MAX_DELAY_SEC, Math.max(0, Math.round(Number(e.target.value) || 0))) || undefined })} />
                segundos antes
              </label>
            )}
            <div className="rounded-lg border border-line p-2 space-y-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <span className="tnum font-mono text-[11px] text-faint w-4">{i + 1}</span>
                {KIND_META[it.kind].icon} {KIND_META[it.kind].label}
                <span className="ml-auto flex items-center">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-faint hover:text-ink disabled:opacity-30" title="Subir"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 text-faint hover:text-ink disabled:opacity-30" title="Descer"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} disabled={items.length <= 1} className="p-1 text-faint hover:text-danger disabled:opacity-30" title="Remover mensagem"><X size={13} /></button>
                </span>
              </div>

              {it.kind === 'text' && <TextWithVars formatting value={it.text ?? ''} onChange={(v) => upd(it.id, { text: v })} vars={vars} placeholder="Olá {{contact.name}}! *Promoção* de hoje…" />}

              {media && (
                <>
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[12.5px] text-muted cursor-pointer hover:bg-field">
                    <Paperclip size={14} />
                    <span className="truncate">{uploading === it.id ? 'Enviando…' : it.mediaKey ? 'Trocar arquivo' : `Escolher ${media.label.toLowerCase()}`}</span>
                    <input type="file" hidden accept={ACCEPT[it.kind as ContentMediaKind]} disabled={!!uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(it, f); }} />
                  </label>
                  <p className="text-[10.5px] text-faint">{media.formats} · até {media.maxMb} MB{it.kind === 'video' ? ' · na API oficial (Meta) o vídeo precisa ser H.264 com áudio AAC' : ''}</p>
                  {it.kind === 'document' && it.mediaKey && (
                    <input className={inputCls} value={it.mediaName ?? ''} onChange={(e) => upd(it.id, { mediaName: e.target.value })} placeholder="Nome do arquivo que o contato vê (ex.: tabela.pdf)" />
                  )}
                  {it.kind === 'audio' ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {([[true, 'Áudio gravado'], [false, 'Arquivo de áudio']] as const).map(([v, l]) => (
                        <button type="button" key={l} onClick={() => upd(it.id, { voice: v })} className={cn('rounded-lg border px-2 py-1 text-[12px]', (it.voice !== false) === v ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:bg-field')}>{l}</button>
                      ))}
                    </div>
                  ) : (
                    <TextWithVars formatting value={it.text ?? ''} onChange={(v) => upd(it.id, { text: v || undefined })} vars={vars} placeholder="Legenda (opcional)" />
                  )}
                </>
              )}

              {errors[it.id] && <p className="text-[11px] text-danger">{errors[it.id]}</p>}
              {warnings.map((w) => <p key={w} className="flex items-start gap-1 rounded px-2 py-1 text-[11px] bg-warn-soft text-warn-ink"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}</p>)}
              {(it.kind === 'text' ? !!it.text : !!it.mediaKey) && <ContentPreview item={it} />}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-1">
        {(Object.keys(KIND_META) as ContentItemKind[]).map((k) => (
          <button key={k} type="button" onClick={() => add(k)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-muted hover:bg-field hover:text-ink">
            + {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted rounded-lg bg-field px-3 py-2">As mensagens saem nesta ordem. Texto e legenda aceitam {'{{variáveis}}'} e a formatação do WhatsApp: *negrito*, _itálico_, ~tachado~. O intervalo segura a próxima mensagem (até {CONTENT_MAX_DELAY_SEC}s); para esperas maiores use o <b>Atraso inteligente</b>.</p>
    </div>
  );
}
