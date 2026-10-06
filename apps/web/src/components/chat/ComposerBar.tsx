'use client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, Zap, Workflow, Pause, Play, CircleStop, Smile, AtSign, Image as ImageIcon, Video, FileText, Search, AlarmClock } from 'lucide-react';
import { ScheduleMessageModal } from './ScheduledMessages';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { usePersistedState } from '@/lib/persisted';
import { useStartFlowConfirm } from './useStartFlowConfirm';
import { QUICK_REPLY_EVENT, type QuickReplyEventDetail } from './QuickReplyCountdown';
import {
  useAgents, useActiveRun, useFlows, useHasFeature, useMe, useQuickReplies, useConversation, usePauseBot, useResumeBot, useCancelFlow, botPaused, useCan,
  type QuickReplyItem,
} from '@/lib/hooks';

/**
 * Barra de atalhos do campo de mensagem.
 *
 * Fica **abaixo** do campo, como no WhatsApp: a mão está no teclado, e um atalho acima do
 * texto obriga o olho a subir e voltar. Cada botão abre o seu menu ali mesmo, ancorado na
 * barra — nada de abrir modal no meio de uma frase.
 *
 * Antes isto estava espalhado: três botões de mídia soltos acima, o clipe repetindo os mesmos
 * três, fluxo só no painel da direita e resposta rápida só no painel da direita. Quem atende
 * fica no campo de texto, não no painel.
 */

const EMOJIS = ['😀', '😁', '😂', '🙂', '😉', '😊', '😍', '🤔', '😅', '🙏', '👍', '👎', '👋', '💪', '🎉', '✅', '❌', '⚠️', '❤️', '🔥', '⏰', '📌', '📎', '💰', '🚗', '🏠', '📅', '🤝', '😢', '😡'];

export interface ComposerBarProps {
  conversationId: string;
  /** insere texto no campo (no ponto do cursor quando possível) */
  onInserir: (texto: string) => void;
  /** abre o seletor de arquivos já filtrado */
  onEscolherArquivo: (tipos: string) => void;
  enviando?: boolean;
  /** assinatura ligada: o nome do atendente vai junto na mensagem */
  assinando: boolean;
  onAssinando: (v: boolean) => void;
  /** conteúdo extra à direita (copiloto de IA) */
  direita?: React.ReactNode;
  /** texto do campo: vira a mensagem do agendamento */
  texto: string;
  /** agendou com o texto do campo: limpa o campo */
  onAgendado: () => void;
}

export function ComposerBar({ conversationId, onInserir, onEscolherArquivo, enviando, assinando, onAssinando, direita, texto, onAgendado }: ComposerBarProps) {
  const [aberto, setAberto] = useState<'anexo' | 'respostas' | 'fluxos' | 'pausa' | 'emoji' | 'mencao' | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const [agendando, setAgendando] = useState(false);
  // vendido à parte: só aparece para quem tem no perfil
  const podeAgendar = useCan('conversations.schedule_message');
  const activeRun = useActiveRun(conversationId);
  const conv = useConversation(conversationId).data;
  const pausado = !!conv && botPaused(conv);
  const flows = useHasFeature('flows');
  // fora do menu: o menu fecha no clique, a confirmação de "robô pausado" precisa ficar
  const startFlow = useStartFlowConfirm();

  // clique fora e Esc fecham: menu que só fecha no próprio botão prende a pessoa
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => { if (!caixaRef.current?.contains(e.target as Node)) setAberto(null); };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(null);
    document.addEventListener('mousedown', clique);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', clique); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  const inserir = (t: string) => { onInserir(t); setAberto(null); };

  return (
    <div ref={caixaRef} className="relative flex items-center gap-0.5 pt-1">
      <Atalho icone={<Paperclip size={16} />} titulo="Anexar" ativo={aberto === 'anexo'} onClick={() => setAberto(aberto === 'anexo' ? null : 'anexo')} />
      <Atalho icone={<Zap size={16} />} titulo="Respostas rápidas" ativo={aberto === 'respostas'} onClick={() => setAberto(aberto === 'respostas' ? null : 'respostas')} />
      {flows.has && (
        <Atalho icone={<Workflow size={16} />} titulo="Disparar fluxo" ativo={aberto === 'fluxos'} onClick={() => setAberto(aberto === 'fluxos' ? null : 'fluxos')} />
      )}
      {/* pausa: menu com pausar / continuar / cancelar. Âmbar quando pausado, para ninguém
          esquecer que o robô está calado nesta conversa */}
      {flows.has && (
        <Atalho
          icone={<Pause size={16} />}
          titulo={pausado ? 'Fluxo pausado — continuar ou cancelar' : activeRun.data ? `Pausar ou cancelar "${activeRun.data.flow.name}"` : 'Pausar os fluxos nesta conversa'}
          ativo={aberto === 'pausa'}
          destaque={pausado}
          onClick={() => setAberto(aberto === 'pausa' ? null : 'pausa')}
        />
      )}
      {podeAgendar && <Atalho icone={<AlarmClock size={16} />} titulo="Agendar mensagem" ativo={agendando} onClick={() => { setAberto(null); setAgendando(true); }} />}
      <Atalho icone={<Smile size={16} />} titulo="Emojis" ativo={aberto === 'emoji'} onClick={() => setAberto(aberto === 'emoji' ? null : 'emoji')} />
      <Atalho icone={<AtSign size={16} />} titulo="Mencionar alguém da equipe" ativo={aberto === 'mencao'} onClick={() => setAberto(aberto === 'mencao' ? null : 'mencao')} />
      <Atalho
        icone={<span className="text-[15px] font-bold underline underline-offset-2 decoration-2 leading-none">A</span>}
        titulo={assinando ? 'Assinatura ligada: seu nome vai junto' : 'Assinar as mensagens com o seu nome'}
        ativo={assinando}
        onClick={() => onAssinando(!assinando)}
      />
      {enviando && <span className="text-[11px] text-muted ml-1">enviando arquivo…</span>}
      <span className="flex-1" />
      {direita}

      {aberto === 'anexo' && (
        <Menu>
          <ItemMenu icone={<ImageIcon size={14} />} onClick={() => { onEscolherArquivo('image/jpeg,image/png,image/webp,image/gif'); setAberto(null); }}>Foto</ItemMenu>
          <ItemMenu icone={<Video size={14} />} onClick={() => { onEscolherArquivo('video/mp4,video/3gpp'); setAberto(null); }}>Vídeo</ItemMenu>
          <ItemMenu icone={<FileText size={14} />} onClick={() => { onEscolherArquivo('application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'); setAberto(null); }}>Documento</ItemMenu>
        </Menu>
      )}
      {aberto === 'respostas' && <MenuRespostas conversationId={conversationId} onFechar={() => setAberto(null)} />}
      {aberto === 'fluxos' && <MenuFluxos conversationId={conversationId} onStart={startFlow.run} onFechar={() => setAberto(null)} />}
      {startFlow.dialog}
      {aberto === 'pausa' && conv && <MenuPausa conversationId={conversationId} pausado={pausado} pausadoPor={conv.botPausedBy?.name} run={activeRun.data ?? null} onFechar={() => setAberto(null)} />}
      {aberto === 'emoji' && (
        <Menu largura="w-64">
          <div className="grid grid-cols-8 gap-0.5 p-1">
            {EMOJIS.map((e) => (
              // fica aberto para emendar vários; mousedown sem default não tira o foco do campo
              <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => onInserir(e)} className="text-lg rounded hover:bg-field leading-none p-1">{e}</button>
            ))}
          </div>
        </Menu>
      )}
      {aberto === 'mencao' && <MenuMencao onInserir={inserir} />}
      <ScheduleMessageModal open={agendando} onClose={() => setAgendando(false)} conversationId={conversationId} textoInicial={texto} onAgendado={onAgendado} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Atalho({ icone, titulo, onClick, ativo, destaque }: { icone: React.ReactNode; titulo: string; onClick: () => void; ativo?: boolean; destaque?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn(
        'w-8 h-8 rounded-lg grid place-items-center transition-colors',
        destaque ? 'text-warn-ink bg-warn-soft hover:bg-warn-soft/70' : ativo ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:text-ink hover:bg-field',
      )}
    >
      {icone}
    </button>
  );
}

/**
 * Menu ancorado acima da barra — sobe, porque abaixo dela é a borda da janela. Altura limitada
 * com rolagem por dentro: lista longa de fluxos/respostas não pode sair pelo topo da tela.
 */
function Menu({ children, largura = 'w-72' }: { children: React.ReactNode; largura?: string }) {
  return (
    <div className={cn('absolute bottom-full left-0 mb-1 z-30 rounded-xl border border-line bg-panel shadow-lg max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain scrollbar-thin', largura)}>
      {children}
    </div>
  );
}

function ItemMenu({ icone, children, onClick }: { icone?: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-field text-left">
      {icone && <span className="text-faint shrink-0">{icone}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/**
 * Respostas rápidas no composer, com as variáveis já resolvidas — vai "Olá, Tiago", não
 * "Olá, {{contact.name}}". O painel da direita continua existindo; isto é para quem está
 * digitando e não quer tirar a mão do campo.
 */
function MenuRespostas({ conversationId, onFechar }: { conversationId: string; onFechar: () => void }) {
  const folders = useQuickReplies();
  const me = useMe();
  const conv = useConversation(conversationId).data;
  const [q, setQ] = useState('');
  const todas = (folders.data ?? []).flatMap((f) => f.replies.map((r) => ({ ...r, pasta: f.name })));
  const filtradas = todas.filter((r) => !q || `${r.title} ${r.body}`.toLowerCase().includes(q.toLowerCase()));

  const resolver = (r: QuickReplyItem) => {
    const nome = conv?.contact.name ?? conv?.contact.phone ?? '';
    return r.body.replace(/\{\{\s*contact\.name\s*\}\}/g, nome).replace(/\{\{\s*agent\.name\s*\}\}/g, me.data?.name ?? '');
  };

  // mesmo caminho do painel da direita: contagem regressiva e envio (ou só insere, fora do modo de responder)
  const escolher = (r: QuickReplyItem) => {
    const media = r.mediaKey && r.mediaUrl ? { key: r.mediaKey, url: r.mediaUrl, mimeType: r.mediaMime ?? '', fileName: r.mediaName ?? 'arquivo', size: 0 } : undefined;
    window.dispatchEvent(new CustomEvent<QuickReplyEventDetail>(QUICK_REPLY_EVENT, { detail: { title: r.title, text: resolver(r), media } }));
  };

  return (
    <Menu largura="w-80">
      <div className="sticky top-0 z-10 bg-panel p-1.5 border-b border-line flex items-center gap-1.5">
        <Search size={13} className="text-faint shrink-0" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar resposta…" className="w-full bg-transparent text-[12.5px] focus:outline-none" />
      </div>
      <div>
        {filtradas.length === 0 && <p className="px-3 py-3 text-[12px] text-faint">Nenhuma resposta encontrada.</p>}
        {filtradas.map((r) => (
          <button key={r.id} type="button" onClick={() => { escolher(r); onFechar(); }} className="w-full text-left px-3 py-1.5 hover:bg-accent-soft">
            <div className="text-[12.5px] font-medium text-ink truncate">{r.title}</div>
            <div className="text-[11px] text-muted truncate">{r.body || r.mediaName}</div>
          </button>
        ))}
      </div>
    </Menu>
  );
}

function MenuFluxos({ conversationId, onStart, onFechar }: { conversationId: string; onStart: (f: { id: string; name: string }, conversationId: string) => Promise<unknown>; onFechar: () => void }) {
  const flows = useFlows();
  const lista = (flows.data ?? []).filter((f) => f.isActive && f.showInChat);
  return (
    <Menu>
      {lista.length === 0 && <p className="px-3 py-3 text-[12px] text-faint">Nenhum fluxo marcado como atalho.</p>}
      {lista.map((f) => (
        <ItemMenu
          key={f.id}
          icone={<Workflow size={14} />}
          onClick={() => { void onStart(f, conversationId); onFechar(); }}
        >
          {f.name}
        </ItemMenu>
      ))}
    </Menu>
  );
}

/**
 * Pausa do fluxo nesta conversa (docs/fluxos.md → Pausar o fluxo).
 *
 * Pausar congela o fluxo onde está e cala a automação só aqui; continuar segue do mesmo ponto
 * (a pergunta que esperava resposta volta a esperar, o Aguardar retoma o tempo). Cancelar
 * encerra o fluxo de vez e libera a automação.
 */
function MenuPausa({ conversationId, pausado, pausadoPor, run, onFechar }: {
  conversationId: string;
  pausado: boolean;
  pausadoPor?: string;
  run: { status: string; flow: { name: string } } | null;
  onFechar: () => void;
}) {
  const pausar = usePauseBot();
  const continuar = useResumeBot();
  const cancelar = useCancelFlow();
  const acao = (p: Promise<unknown>, ok: string) => { onFechar(); p.then(() => toast.ok(ok)).catch(toast.err); };
  const congelado = run?.status === 'paused';

  return (
    <Menu>
      <div className="px-3 pt-2 pb-1.5 border-b border-line text-[11.5px] text-muted">
        {pausado
          ? <>Fluxo pausado{pausadoPor && <> por <b className="text-ink">{pausadoPor}</b></>}{congelado && <>: <b className="text-ink">{run!.flow.name}</b> parado onde estava</>}.</>
          : run
            ? <><b className="text-ink">{run.flow.name}</b> {run.status === 'waiting' ? 'esperando o contato' : 'rodando'} nesta conversa.</>
            : 'Nenhum fluxo rodando. Pausar impede que fluxos e respostas automáticas respondam aqui.'}
      </div>
      {pausado ? (
        <ItemMenu icone={<Play size={14} />} onClick={() => acao(continuar.mutateAsync(conversationId), congelado ? 'Fluxo continuando de onde parou' : 'Fluxos liberados nesta conversa')}>
          {congelado ? 'Continuar de onde parou' : 'Retomar fluxos nesta conversa'}
        </ItemMenu>
      ) : (
        <ItemMenu icone={<Pause size={14} />} onClick={() => acao(pausar.mutateAsync({ conversationId, minutes: null }), run ? 'Fluxo pausado' : 'Fluxos pausados nesta conversa')}>
          {run ? 'Pausar fluxo' : 'Pausar fluxos nesta conversa'}
        </ItemMenu>
      )}
      {run && (
        <ItemMenu icone={<CircleStop size={14} />} onClick={() => acao(cancelar.mutateAsync(conversationId), 'Fluxo cancelado — a conversa é sua')}>
          Cancelar fluxo
        </ItemMenu>
      )}
    </Menu>
  );
}

/**
 * Menção à equipe.
 *
 * Insere `@Nome` no texto. Serve para a nota interna ("@Ana, esse é seu cliente") — o contato
 * não vê nota. **Não notifica ainda**: o sistema não tem notificação interna, e fingir que
 * avisa seria pior do que não ter.
 */
function MenuMencao({ onInserir }: { onInserir: (t: string) => void }) {
  const agents = useAgents();
  const ativos = (agents.data ?? []).filter((a) => a.isActive);
  return (
    <Menu>
      {ativos.length === 0 && <p className="px-3 py-3 text-[12px] text-faint">Ninguém na equipe ainda.</p>}
      {ativos.map((a) => (
        <ItemMenu key={a.id} icone={<AtSign size={14} />} onClick={() => onInserir(`@${a.name.split(' ')[0]} `)}>{a.name}</ItemMenu>
      ))}
    </Menu>
  );
}
