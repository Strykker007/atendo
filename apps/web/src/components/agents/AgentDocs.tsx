'use client';
import { useRef, useState } from 'react';
import { FileText, Search, Trash2, Upload } from 'lucide-react';
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_MAX_DOCS, KNOWLEDGE_MAX_FILE_MB, type AgentKnowledgeDoc, type KnowledgeHit } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useAgentDocs, useDeleteAgentDoc, useSearchAgentDocs, useUploadAgentDoc } from '@/lib/hooks';

const mil = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));

function Situacao({ d, semantic }: { d: AgentKnowledgeDoc; semantic: boolean }) {
  if (d.status === 'failed') return <span className="text-danger">{d.error ?? 'falhou'}</span>;
  if (!semantic) return <span className="text-ok">pronto</span>;
  if (d.embedded < d.chunks) return <span className="text-warn-ink">preparando a busca por significado… {Math.floor((d.embedded / Math.max(1, d.chunks)) * 100)}%</span>;
  return <span className="text-ok">pronto</span>;
}

/**
 * Documentos do agente (docs/agente-ia.md#documentos): regimento, manual, tabela. O agente busca
 * os trechos que falam do que o contato perguntou e responde só com eles. Vale na hora — não
 * depende do botão Salvar do agente.
 */
export function AgentDocs({ agentId }: { agentId: string }) {
  const q = useAgentDocs(agentId);
  const up = useUploadAgentDoc(agentId);
  const del = useDeleteAgentDoc(agentId);
  const busca = useSearchAgentDocs(agentId);
  const input = useRef<HTMLInputElement>(null);
  const [apagar, setApagar] = useState<AgentKnowledgeDoc | null>(null);
  const [pergunta, setPergunta] = useState('');
  const [achados, setAchados] = useState<KnowledgeHit[] | null>(null);
  const docs = q.data?.docs ?? [];
  const semantic = !!q.data?.semantic;

  function enviar(file?: File) {
    if (!file) return;
    if (file.size > KNOWLEDGE_MAX_FILE_MB * 1024 * 1024) { toast.err(`Arquivo maior que ${KNOWLEDGE_MAX_FILE_MB} MB. Divida em partes.`); return; }
    up.mutate(file, {
      onSuccess: (r) => { toast.ok(`“${file.name}” lido: ${r.chunks} trecho${r.chunks === 1 ? '' : 's'}.`); setAchados(null); },
      onError: (e) => toast.err(e),
    });
  }

  function testar(e: React.FormEvent) {
    e.preventDefault();
    if (!pergunta.trim()) return;
    busca.mutate(pergunta.trim(), { onSuccess: setAchados, onError: (err) => toast.err(err) });
  }

  return (
    <div className="space-y-3">
      <input ref={input} type="file" accept={KNOWLEDGE_ACCEPT} className="hidden" onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ''; }} />

      {docs.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 px-3 py-2">
              <FileText size={16} className="text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-ink truncate" title={d.name}>{d.name}</p>
                <p className="text-[11.5px] text-muted">{mil(d.chars)} caracteres · {d.chunks} trechos · <Situacao d={d} semantic={semantic} /></p>
              </div>
              <button type="button" className="p-1.5 rounded text-muted hover:text-danger" onClick={() => setApagar(d)} aria-label={`Apagar ${d.name}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon={<Upload size={13} />} loading={up.isPending} disabled={docs.length >= KNOWLEDGE_MAX_DOCS} onClick={() => input.current?.click()}>
          {up.isPending ? 'Lendo o documento…' : 'Enviar documento'}
        </Button>
        <p className="text-[11.5px] text-faint">PDF, Word (.docx) ou texto · até {KNOWLEDGE_MAX_FILE_MB} MB · {KNOWLEDGE_MAX_DOCS} por agente. PDF escaneado (foto) não tem texto para ler.</p>
      </div>

      {docs.some((d) => d.status === 'ready') && (
        <div className="rounded-xl bg-field/50 p-3 space-y-2">
          <form onSubmit={testar} className="flex gap-2">
            <input className={cn(inputCls, 'flex-1 min-w-0')} value={pergunta} onChange={(e) => setPergunta(e.target.value)} maxLength={1000} placeholder="Teste a busca: pergunte como um cliente perguntaria" aria-label="Pergunta de teste" />
            <Button type="submit" size="sm" variant="ghost" icon={<Search size={13} />} loading={busca.isPending} disabled={!pergunta.trim()}>Buscar</Button>
          </form>
          {achados && (achados.length ? (
            <ol className="space-y-1.5">
              {achados.map((h, i) => <Trecho key={`${h.docId}-${h.position}`} h={h} i={i} />)}
            </ol>
          ) : <p className="text-[12px] text-muted">Nenhum trecho fala disso. Nesse caso o agente diz que vai verificar e chama um atendente.</p>)}
          {!achados && <p className="text-[11.5px] text-faint">Mostra os trechos que o agente leria para responder. Não gasta interação de IA.</p>}
        </div>
      )}

      <ConfirmDialog
        open={!!apagar}
        title="Apagar documento"
        text={`O agente deixa de consultar “${apagar?.name ?? ''}” na hora.`}
        confirmLabel="Apagar"
        danger
        onClose={() => setApagar(null)}
        onConfirm={() => (apagar ? del.mutateAsync(apagar.id).then(() => { toast.ok('Documento apagado.'); setAchados(null); setApagar(null); }, (e) => toast.err(e)) : undefined)}
      />
    </div>
  );
}

/** Um trecho achado: documento, capítulo e o texto (recolhido). */
export function Trecho({ h, i }: { h: KnowledgeHit; i?: number }) {
  return (
    <li className="rounded-lg border border-line bg-panel px-2.5 py-1.5">
      <details>
        <summary className="cursor-pointer text-[12px] text-ink">
          {i !== undefined && <span className="text-faint">{i + 1}. </span>}
          <b className="font-medium">{h.docName}</b>{h.heading && <span className="text-muted"> · {h.heading}</span>}
          <span className="ml-1.5 text-[10.5px] text-faint">{h.via.map((v) => (v === 'keyword' ? 'palavra' : 'significado')).join(' + ')}</span>
        </summary>
        <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">{h.text}</p>
      </details>
    </li>
  );
}
