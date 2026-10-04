'use client';
import { useState } from 'react';
import { Image as ImageIcon, Mic, Video, FileText, Folder, FolderOpen, Zap, Workflow, Play, Lock, ChevronDown, ChevronRight, Copy, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { type QuickReplyItem, useFlows, useHasFeature, useActiveRun } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useQuickReplies, useConversation, useMe } from '@/lib/hooks';
import { useUI } from '@/lib/store';
import { Settings2 } from 'lucide-react';
import { usePersistedState } from '@/lib/persisted';
import { useStartFlowConfirm } from './useStartFlowConfirm';

/** Painel direito: sessões (pastas) com mensagens pré-configuradas. Clique insere no composer. */
export function QuickRepliesPanel() {
  const { toggleRightPanel } = useUI();
  // a aba escolhida também fica guardada: trocar de conversa não deve devolver o painel ao padrão
  const [tab, setTab] = usePersistedState<'replies' | 'flows'>('painel-aba', 'replies');
  return (
    <>
      <div className="h-12 px-2 flex items-center gap-1.5 border-b border-line">
        {/* recolher fica aqui dentro, como no menu da esquerda: quem quer mais espaço para a
            conversa fecha de onde está olhando, sem procurar o botão no cabeçalho do chat
            (que continua existindo, porque fechado é de lá que se reabre) */}
        <button onClick={toggleRightPanel} className="shrink-0 p-1 rounded-md text-faint hover:text-ink hover:bg-field" title="Recolher painel">
          <PanelRightClose size={17} />
        </button>
        <div className="grid grid-cols-2 flex-1 min-w-0 rounded-lg bg-field p-0.5 text-[12px] font-semibold">
          <button onClick={() => setTab('replies')} className={cn('rounded-md py-1 flex items-center justify-center gap-1.5', tab === 'replies' ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Zap size={13} /> Mensagens</button>
          <button onClick={() => setTab('flows')} className={cn('rounded-md py-1 flex items-center justify-center gap-1.5', tab === 'flows' ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Workflow size={13} /> Fluxos</button>
        </div>
      </div>
      <DadosDaConversa />
      {tab === 'replies' ? <RepliesTab /> : <FlowsTab />}
    </>
  );
}

/**
 * Dados da conversa aberta, à mão.
 *
 * Durante o atendimento a pessoa precisa do nome, do telefone ou do e-mail do contato para
 * escrever a mensagem, e hoje isso obriga a abrir a ficha, ler, lembrar e voltar — ou pior,
 * digitar de cabeça e errar o e-mail. Aqui um clique joga o valor no campo de mensagem, já
 * resolvido: o que entra é "Tiago", não `{{contact.name}}`.
 *
 * Fica fechável porque divide espaço com a lista de respostas, que é o que mais se usa.
 */
function DadosDaConversa() {
  const [aberto, setAberto] = usePersistedState('painel-dados', true);
  const { conversationId } = useUI();
  const conv = useConversation(conversationId).data;
  const me = useMe();
  if (!conv) return null;

  const c = conv.contact;
  const primeiro = (c.name ?? '').trim().split(/\s+/)[0] || null;
  const linhas: { rotulo: string; valor: string | null | undefined }[] = [
    { rotulo: 'Nome', valor: c.name },
    { rotulo: 'Primeiro nome', valor: primeiro && primeiro !== c.name ? primeiro : null },
    { rotulo: 'Telefone', valor: c.phone ? `+${c.phone}` : null },
    { rotulo: 'E-mail', valor: c.email },
    { rotulo: 'Endereço', valor: c.address },
    { rotulo: 'Atendente', valor: me.data?.name },
  ];
  const uteis = linhas.filter((l) => !!l.valor);
  if (uteis.length === 0) return null;

  const inserir = (v: string) => window.dispatchEvent(new CustomEvent('atendo:insert-text', { detail: v }));
  const copiar = (v: string) => navigator.clipboard?.writeText(v).then(() => toast.ok('Copiado')).catch(() => undefined);

  return (
    <div className="border-b border-line">
      <button onClick={() => setAberto((a) => !a)} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint hover:text-ink">
        {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Dados da conversa
      </button>
      {aberto && (
        <ul className="pb-1.5">
          {uteis.map((l) => (
            <li key={l.rotulo} className="group flex items-center gap-2 pl-6 pr-2 py-0.5 hover:bg-field">
              <span className="text-[10.5px] text-faint w-20 shrink-0">{l.rotulo}</span>
              <button onClick={() => inserir(l.valor!)} title="Inserir no campo de mensagem" className="text-[12px] text-ink truncate flex-1 text-left hover:text-accent-ink">
                {l.valor}
              </button>
              <button onClick={() => copiar(l.valor!)} title="Copiar" className="opacity-0 group-hover:opacity-100 text-faint hover:text-ink shrink-0">
                <Copy size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Aba Fluxos: dispara um fluxo na conversa aberta. Plugável no plano. */
function FlowsTab() {
  const { conversationId } = useUI();
  const feature = useHasFeature('flows');
  const flows = useFlows();
  const { run, dialog, start } = useStartFlowConfirm();
  const active = useActiveRun(conversationId);
  // só os marcados como atalho: fluxo que roda sozinho não precisa poluir esta lista
  const list = flows.data?.filter((f) => f.isActive && f.showInChat) ?? [];
  if (!feature.loading && !feature.has) {
    return (
      <div className="p-5 text-center space-y-2">
        <div className="mx-auto w-10 h-10 rounded-xl bg-accent-soft text-accent-ink grid place-items-center"><Lock size={18} /></div>
        <p className="text-sm font-semibold text-ink">Fluxos de automação</p>
        <p className="text-xs text-muted">Disponível nos planos Pro e Business.</p>
        <Link href="/plano" className="text-xs text-accent-ink underline">Ver planos</Link>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {dialog}
      {!conversationId && <p className="p-5 text-xs text-muted text-center">Abra uma conversa para disparar um fluxo nela.</p>}
      {active.data && <div className="m-2.5 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-ink">🤖 <b>{active.data.flow.name}</b> está rodando nesta conversa{active.data.status === 'waiting' ? ' (esperando o contato)' : ''}. Disparar outro substitui este.</div>}
      {list.length === 0 && flows.data && <p className="p-5 text-xs text-muted text-center">Nenhum fluxo marcado como atalho. Marque em <Link href="/fluxos" className="text-accent-ink underline">Fluxos</Link>.</p>}
      <ul className="divide-y divide-line">
        {list.map((f) => {
          const running = active.data?.flow.id === f.id;
          return (
            <li key={f.id} className={cn('flex items-center gap-2 px-3 py-2', running && 'bg-accent-soft/60')}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate flex items-center gap-1.5">{running && <span className="animate-pulse">🤖</span>}{f.name}{running && <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-ink bg-accent-soft rounded px-1">rodando</span>}</div>
                {f.description && <div className="text-[11px] text-muted truncate">{f.description}</div>}
              </div>
              <Button size="sm" variant={running ? 'ghost' : 'primary'} icon={<Play size={12} />} disabled={!conversationId} loading={start.isPending && start.variables?.flowId === f.id} onClick={() => conversationId && run(f, conversationId, `Fluxo "${f.name}" ${running ? 'reiniciado' : 'iniciado'}`)}>{running ? 'Reiniciar' : 'Iniciar'}</Button>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-3 text-[10.5px] text-faint">Enquanto o fluxo roda, o robô responde. Você pode parar a qualquer momento no cabeçalho da conversa. <Link href="/fluxos" className="underline">Gerenciar fluxos</Link></p>
    </div>
  );
}

/** Ícone do tipo de anexo, para o atendente saber o que vai mandar antes de clicar. */
function MediaIcon({ type }: { type: NonNullable<QuickReplyItem['mediaType']> }) {
  const props = { size: 12, className: 'text-accent shrink-0' };
  if (type === 'image') return <ImageIcon {...props} />;
  if (type === 'audio') return <Mic {...props} />;
  if (type === 'video') return <Video {...props} />;
  return <FileText {...props} />;
}

function RepliesTab() {
  const folders = useQuickReplies();
  // quais pastas ficaram abertas. Antes era estado local: sair da aba e voltar fechava tudo,
  // e quem estava procurando uma resposta perdia o lugar
  const [abertas, setAbertas] = usePersistedState<string[]>('pastas-respostas', []);
  const [q, setQ] = useState('');

  const me = useMe();
  const { conversationId } = useUI();
  const conv = useConversation(conversationId).data;

  /**
   * Manda a resposta para o composer. Com anexo, vai o arquivo + legenda; o atendente ainda
   * revisa e clica em enviar, como em qualquer mensagem.
   */
  const insert = (r: QuickReplyItem) => {
    const contactName = conv?.contact.name ?? conv?.contact.phone ?? '';
    const agentName = me.data?.name ?? '';
    const text = r.body.replace(/\{\{\s*contact\.name\s*\}\}/g, contactName).replace(/\{\{\s*agent\.name\s*\}\}/g, agentName);
    if (r.mediaKey && r.mediaUrl) {
      window.dispatchEvent(new CustomEvent('atendo:insert-media', {
        detail: { key: r.mediaKey, url: r.mediaUrl, mimeType: r.mediaMime ?? '', fileName: r.mediaName ?? 'arquivo', size: 0, caption: text },
      }));
      return;
    }
    window.dispatchEvent(new CustomEvent('atendo:insert-text', { detail: text }));
  };
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());

  return (
    <>
      <div className="p-2.5 border-b border-line flex items-center gap-2">
        <Link href="/respostas" className="text-faint hover:text-ink shrink-0" title="Gerenciar respostas"><Settings2 size={16} /></Link>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar resposta…" className="w-full rounded-lg bg-field px-3 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40" />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {folders.data?.map((f) => {
          const replies = f.replies.filter((r) => !q || match(r.title) || match(r.body));
          if (q && replies.length === 0) return null;
          // buscando, tudo abre: esconder resultado atrás de pasta fechada não ajuda ninguém
          const isOpen = q ? true : abertas.includes(f.id);
          return (
            <div key={f.id}>
              <button
                onClick={() => setAbertas((a) => (a.includes(f.id) ? a.filter((x) => x !== f.id) : [...a, f.id]))}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-field"
              >
                {isOpen ? <FolderOpen size={14} className="text-warn shrink-0" /> : <Folder size={14} className="text-warn shrink-0" />}
                <span className="flex-1 text-left truncate">{f.name}</span>
                <span className="text-[11px] text-faint tnum">{f.replies.length}</span>
              </button>
              {isOpen &&
                replies.map((r) => (
                  // uma linha por resposta: o trecho do corpo em duas linhas fazia dez
                  // respostas ocuparem a tela inteira, e procurar virava rolagem
                  <button key={r.id} onClick={() => insert(r)} title={r.body || r.mediaName || r.title} className={cn('w-full text-left pl-8 pr-3 py-1 hover:bg-accent-soft border-l-2 border-transparent hover:border-accent')}>
                    {/* só o título: o corpo vai no `title` do botão (tooltip). Dez respostas com
                        duas linhas cada tomavam a tela, e o texto completo raramente é o que
                        se procura — o título é que identifica */}
                    <div className="text-[12.5px] font-medium truncate flex items-center gap-1.5">
                      {r.mediaType && <MediaIcon type={r.mediaType} />}
                      <span className="truncate">{r.title}</span>
                    </div>
                  </button>
                ))}
            </div>
          );
        })}
        {folders.data?.length === 0 && <p className="p-6 text-sm text-faint text-center">Nenhuma resposta ainda. <Link href="/respostas" className="text-accent underline">Criar</Link></p>}
      </div>
    </>
  );
}
