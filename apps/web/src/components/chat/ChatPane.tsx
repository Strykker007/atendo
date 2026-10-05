'use client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileText, Download, X, RefreshCw, Reply, SmilePlus, Forward, WifiOff, Hand, Star, ArrowRightLeft, Undo2, UserRound, Lock, Unlock, CalendarPlus, Image as ImageIcon, Video, Building2 } from 'lucide-react';
import { AppointmentModal } from '@/components/scheduling/AppointmentModal';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, CheckCircle2, RotateCcw, History, BotOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useAiStatus, useDepartments, useSetConversationDepartment } from '@/lib/hooks';
import { DepartmentBadge } from './DepartmentBadge';
import { useConversation, useMessages, useResend, useReact, useClaim, useTransfer, useRelease, useMe, useAgents, useSendNote, useActiveRun, useStopFlow, botPaused, useSetContactTags, useHasFeature, useContactCard, useSendMessage, useSetStatus, useSetTags, useSetPrimaryTag, useTags, useUsage, useTenantSettings, useMarkRead, useCan, useTyping, uploadFile, mediaTypeOf, mensagensEmOrdem, PAGINA_MENSAGENS, type Message, type Upload } from '@/lib/hooks';
import { TagPicker } from './TagPicker';
import { STATUS_META } from './ConversationList';
import { Avatar } from './Avatar';
import { OriginBadge } from './OriginBadge';
import { ChannelBadge, channelColor, channelOffline, formatPhone } from './ChannelBadge';
import { CopilotBar, SummaryButton } from './Copilot';
import { CloseModal } from './CloseModal';
import { ComposerBar } from './ComposerBar';
import { QUICK_REPLY_EVENT, QuickReplyCountdown, type QuickReplyEventDetail, type QuickReplyPending } from './QuickReplyCountdown';
import { QUICK_REPLY_DELAY_DEFAULT_SEC } from '@atendo/shared';
import { HistorySheet } from './HistorySheet';
import { BotPauseBar } from './BotPauseBar';
import { AudioRecorder } from './AudioRecorder';
import { usePersistedState } from '@/lib/persisted';
import { AudioMessage } from './AudioMessage';
import { ContactSheet, ContactSummary } from './ContactSheet';
import { MediaPreview, type Escolhido } from './MediaPreview';
import { ImageViewer } from './ImageViewer';
import { ForwardModal } from './ForwardModal';
import { structuredBody, ForwardedLabel } from './messages/MessageContent';
import { messagePreview } from '@atendo/shared';

/** Tipos que a API aceita (ver ALLOWED em media.controller.ts). */
const ACCEPT_ALL = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/3gpp,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/webm,application/pdf,.doc,.docx,.xls,.xlsx';

/**
 * `conversationId` por prop = modo embutido (mini-chat do Kanban): não lê nem mexe na seleção
 * e nos filtros da tela de conversas, que é outra página.
 */
export function ChatPane({ conversationId: embeddedId }: { conversationId?: string } = {}) {
  const ui = useUI();
  const embedded = !!embeddedId;
  const conversationId = embeddedId ?? ui.conversationId;
  const { setConversation, status } = ui;
  const setFilterStatus: typeof ui.setStatus = embedded ? () => undefined : ui.setStatus;
  const conv = useConversation(conversationId).data;
  const me = useMe();
  const agents = useAgents();
  const claim = useClaim();
  const transfer = useTransfer();
  const release = useRelease();
  const [transferOpen, setTransferOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const departments = useDepartments();
  const setDepartment = useSetConversationDepartment();
  // permissão, não papel (ver ConversationList)
  const isAdmin = useCan('conversations.view_all');
  const podeTransferir = useCan('conversations.transfer_any');
  const podeNota = useCan('conversations.internal_note');
  const mine = !!conv && conv.assignee?.id === me.data?.id;
  const ownedByOther = !!conv && !!conv.assignee && !mine;
  // Cadeado: gerente/admin numa conversa de outra pessoa. Fechado = não envia nada.
  // Aberto = manda NOTA INTERNA (só a equipe vê). Reseta ao trocar de conversa.
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => setUnlocked(false), [conversationId]);
  const sendNote = useSendNote(conversationId);
  const noteMode = podeNota && ownedByOther;
  const activeRun = useActiveRun(conversationId);
  const stopFlow = useStopFlow();
  const sched = useHasFeature('scheduling');
  const flowsFeature = useHasFeature('flows');
  const ai = useAiStatus();
  const [scheduling, setScheduling] = useState(false);
  const [closing, setClosing] = useState(false);
  const [historico, setHistorico] = useState(false);
  const [fichaAberta, setFichaAberta] = useState(false);
  const card = useContactCard(conv?.contact.id ?? null, sched.has);
  const tags = useTags();
  const messages = useMessages(conversationId);
  const mensagens = useMemo(() => mensagensEmOrdem(messages.data), [messages.data]);
  // o canal mostrado na tela vai junto: se a conversa mudou de número, a API recusa (409) em vez de enviar
  const send = useSendMessage(conversationId, conv?.number.id);
  // gravando: a linha inteira vira a gravação, como no WhatsApp
  const [gravando, setGravando] = useState(false);
  const setStatus = useSetStatus();
  const setTags = useSetTags();
  const setPrimary = useSetPrimaryTag();
  const setContactTags = useSetContactTags();
  const usage = useUsage();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  // arquivo escolhido ainda NÃO enviado: fica na prévia até a pessoa confirmar
  const [previa, setPrevia] = useState<File | null>(null);
  // imagens desta conversa, na ordem em que aparecem: as setas do visualizador andam por elas
  const imagens = mensagens.filter((m) => (m.type === 'image' || m.type === 'sticker') && m.mediaUrl).map((m) => ({ url: m.mediaUrl!, nome: m.mediaName }));
  const [vendoImagem, setVendoImagem] = useState<string | null>(null);
  const indiceImagem = imagens.findIndex((i) => i.url === vendoImagem);
  const fileRef = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState(ACCEPT_ALL);
  /**
   * Assinatura: o nome de quem atende vai na frente da mensagem.
   *
   * Em número de empresa, quem lê não sabe com quem está falando — e trocar de atendente no
   * meio do atendimento fica invisível. Fica guardado por navegador, porque é preferência de
   * quem atende, não configuração da empresa.
   */
  const [assinando, setAssinando] = usePersistedState('assinar-mensagens', false);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  /** mensagem que está sendo respondida (citação), como no WhatsApp */
  const [respondendo, setRespondendo] = useState<Message | null>(null);
  const [encaminhando, setEncaminhando] = useState<Message | null>(null);
  /** resposta rápida na contagem para sair; trocar de conversa cancela (não vai para o contato errado) */
  const tenantSettings = useTenantSettings();
  const [rapida, setRapida] = useState<QuickReplyPending | null>(null);
  useEffect(() => setRapida(null), [conversationId]);
  /** o composer está no modo de responder ao contato? (senão a resposta rápida só entra no campo) */
  const podeResponderRef = useRef(false);

  /** Insere no ponto do cursor, não no fim: emoji e menção entram no meio da frase. */
  function inserirNoTexto(trecho: string) {
    const el = campoRef.current;
    if (!el) return setText((t) => (t ? `${t} ` : '') + trecho);
    const ini = el.selectionStart ?? el.value.length;
    const fim = el.selectionEnd ?? ini;
    setText((t) => t.slice(0, ini) + trecho + t.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      const pos = ini + trecho.length;
      el.setSelectionRange(pos, pos);
    });
  }
  const bottomRef = useRef<HTMLDivElement>(null);
  const rolagemRef = useRef<HTMLDivElement>(null);
  /** altura do conteúdo antes de buscar o passado, para devolver a pessoa ao mesmo ponto */
  const alturaAntes = useRef(0);
  /** colado no fim? Falso quando a pessoa subiu para ler o passado. */
  const noFim = useRef(true);
  /** último scrollTop visto em `aoRolar`, para saber se a rolagem subiu ou desceu */
  const ultimaPosicao = useRef(0);
  /** conversa que já foi levada ao fim ao abrir — trocar de conversa sempre recomeça lá embaixo */
  const conversaAberta = useRef<string | null>(null);
  /** id da última mensagem já posicionada: mudou = chegou mensagem nova (rola suave) */
  const ultimaMsg = useRef<string | undefined>(undefined);
  /** até quando há uma rolagem suave em curso; o ResizeObserver acompanha suave nesse intervalo */
  const suaveAte = useRef(0);
  /**
   * O container de rolagem só existe com a conversa carregada (ver o `if (!conv)` abaixo), e
   * conversa e mensagens são consultas separadas. Se as mensagens chegam primeiro, os efeitos
   * de rolagem rodam sem container e não rodam de novo quando ele aparece — o chat abria no
   * topo. Entrar nas dependências faz eles rodarem quando o container monta.
   */
  const temContainer = !!conv;
  const typing = useTyping(conversationId);

  /** Abre o seletor já filtrado pelo tipo escolhido no atalho. */
  function pick(tipos: string) {
    setAccept(tipos);
    // espera o React aplicar o accept antes de abrir o seletor do sistema
    setTimeout(() => fileRef.current?.click(), 0);
  }

  /** Áudio gravado passa pela mesma prévia: dá para ouvir antes de mandar. */
  function sendRecorded(file: File) {
    setPrevia(file);
  }

  /** Escolher arquivo NÃO envia: abre a prévia. Antes, subia direto e a pessoa só via que
   *  tinha escolhido o arquivo errado depois de mandar — e aí já era mensagem gasta. */
  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPrevia(file);
  }

  /** Ctrl/Cmd+V com imagem no clipboard: vai para a mesma prévia do anexo. Texto cola normal. */
  function colar(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    // print colado vem como "image.png": dá um nome que diga de quando é
    setPrevia(img.name && img.name !== 'image.png' ? img : new File([img], `imagem-${Date.now()}.${img.type.split('/')[1] || 'png'}`, { type: img.type }));
  }

  /** Confirmou na prévia: sobe o arquivo (já com os rabiscos, se houver) e envia. */
  async function enviarDaPrevia({ file, caption }: Escolhido) {
    setUploading(true);
    try {
      const up = await uploadFile(file);
      setPrevia(null);
      await send.mutateAsync({ type: mediaTypeOf(up.mimeType), mediaKey: up.key, text: caption || undefined, media: { url: up.url, mimeType: up.mimeType, fileName: up.fileName }, idempotencyKey: crypto.randomUUID() });
      if (status === 'waiting' && conv?.status === 'waiting') setFilterStatus('in_progress', true);
    } catch (err) {
      toast.err(err); // a prévia continua aberta: o arquivo escolhido não se perde no erro
    } finally {
      setUploading(false);
    }
  }

  // trocar de conversa recomeça: a próxima leva de mensagens é de outra pessoa
  // (a posição de rolagem é recomeçada no useLayoutEffect abaixo, que roda antes deste)
  useEffect(() => { setRespondendo(null); }, [conversationId]);

  /**
   * Abriu a conversa = leu. Dispara uma vez por conversa aberta; mensagem que chegar depois,
   * com a conversa já na tela, também entra como lida — é o que o atendente espera, já que
   * ele está olhando para ela.
   */
  const marcarLida = useMarkRead();
  useEffect(() => {
    if (!conversationId) return;
    marcarLida.mutate(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, mensagens.length]);

  /**
   * Manter o fim da conversa à vista.
   *
   * Rolar uma vez quando as mensagens chegam **não basta**: as bolhas crescem depois, quando a
   * imagem carrega e o player de áudio monta, e o chat terminava parado lá em cima. Por isso
   * quem decide é um ResizeObserver — enquanto a pessoa estiver no fim, qualquer crescimento
   * do conteúdo rola junto. Quem subiu para ler o passado não é arrastado para baixo porque o
   * contato respondeu.
   */
  useEffect(() => {
    const el = rolagemRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (alturaAntes.current) return; // restauração de página antiga manda neste quadro
      if (!noFim.current) return;
      // no meio de uma rolagem suave, só corrige o destino; senão o salto instantâneo a cortaria
      if (performance.now() < suaveAte.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
    });
    obs.observe(el);
    for (const filho of Array.from(el.children)) obs.observe(filho);
    return () => obs.disconnect();
  }, [conversationId, mensagens.length, temContainer]);

  /**
   * Para onde a tela vai quando a lista muda, antes da pintura (`useLayoutEffect`, senão o
   * salto aparece):
   *  - carregou o passado: devolver a pessoa ao mesmo ponto. A altura foi medida antes do
   *    pedido, e a diferença é exatamente o que entrou acima;
   *  - abriu/trocou de conversa: ir para o fim na hora, esquecendo onde a anterior estava.
   *    Isso fica aqui, e não num useEffect, porque efeitos comuns rodam depois deste — com o
   *    `noFim` velho da conversa anterior a nova abria parada no meio;
   *  - chegou mensagem com a pessoa no fim: rolar suave até ela. Quem está lendo o passado
   *    fica onde está.
   *
   * O ResizeObserver acima não cobre este caso: ele só reage a mudança de tamanho, e aqui
   * as bolhas estão sendo criadas, não redimensionadas.
   */
  useLayoutEffect(() => {
    const el = rolagemRef.current;
    if (!el) return;
    const ultima = mensagens[mensagens.length - 1]?.id;
    if (conversaAberta.current !== conversationId) {
      noFim.current = true;
      alturaAntes.current = 0;
      if (!mensagens.length) return; // ainda carregando: rola quando as mensagens chegarem
      conversaAberta.current = conversationId;
      ultimaMsg.current = ultima;
      el.scrollTop = el.scrollHeight;
      ultimaPosicao.current = el.scrollTop;
      return;
    }
    if (alturaAntes.current) {
      el.scrollTop = el.scrollHeight - alturaAntes.current;
      alturaAntes.current = 0;
      return;
    }
    const chegouNova = ultima !== ultimaMsg.current;
    ultimaMsg.current = ultima;
    if (!noFim.current) return;
    if (chegouNova) {
      suaveAte.current = performance.now() + 500;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversationId, mensagens, temContainer]);

  // o balão de "digitando" entra no fim da lista: acompanha se a pessoa já estava lá
  useLayoutEffect(() => {
    const el = rolagemRef.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [typing?.state]);

  function aoRolar() {
    const el = rolagemRef.current;
    if (!el) return;
    const subiu = el.scrollTop < ultimaPosicao.current - 1;
    ultimaPosicao.current = el.scrollTop;
    const pertoDoFim = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    // Só a pessoa rola para cima; a rolagem automática sempre desce. Por isso descer nunca
    // solta o chat do fim: uma imagem que carrega entre o `scrollTop = scrollHeight` e este
    // evento aumenta a distância até o fim e, antes, desligava o acompanhamento.
    noFim.current = subiu ? pertoDoFim : noFim.current || pertoDoFim;
    // perto do topo = a pessoa está indo para trás na conversa: busca a página anterior
    if (el.scrollTop > 160 || !messages.hasNextPage || messages.isFetchingNextPage) return;
    alturaAntes.current = el.scrollHeight;
    void messages.fetchNextPage();
  }

  // permite que o painel de respostas rápidas insira texto no composer
  useEffect(() => {
    const h = (e: Event) => setText((t) => (t ? `${t} ` : '') + (e as CustomEvent<string>).detail);
    window.addEventListener('atendo:insert-text', h);
    return () => window.removeEventListener('atendo:insert-text', h);
  }, []);

  // resposta rápida com anexo: entra como arquivo + legenda, ainda revisável antes de enviar
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<Upload & { caption?: string }>).detail;
      setAttachment({ key: d.key, url: d.url, mimeType: d.mimeType, fileName: d.fileName, size: d.size });
      if (d.caption) setText(d.caption);
    };
    window.addEventListener('atendo:insert-media', h);
    return () => window.removeEventListener('atendo:insert-media', h);
  }, []);

  /**
   * Resposta rápida escolhida: sai depois da contagem configurada, com Cancelar/Editar.
   * Fora do modo de responder (nota interna, número caído…), só entra no campo como antes.
   */
  const atrasoRapida = tenantSettings.data?.quickReplyDelaySec ?? QUICK_REPLY_DELAY_DEFAULT_SEC;
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<QuickReplyEventDetail>).detail;
      if (!podeResponderRef.current) {
        if (d.media) setAttachment(d.media);
        setText((t) => (d.media ? d.text : (t ? `${t} ` : '') + d.text));
        return;
      }
      setRapida({ ...d, at: Date.now() + atrasoRapida * 1000, key: crypto.randomUUID() });
    };
    window.addEventListener(QUICK_REPLY_EVENT, h);
    return () => window.removeEventListener(QUICK_REPLY_EVENT, h);
  }, [atrasoRapida]);

  useEffect(() => {
    if (!rapida) return;
    const t = setTimeout(() => {
      setRapida(null);
      const r = rapida;
      const input = r.media
        ? { type: mediaTypeOf(r.media.mimeType), mediaKey: r.media.key, text: r.text || undefined, media: { url: r.media.url, mimeType: r.media.mimeType, fileName: r.media.fileName } } as const
        : { type: 'text', text: r.text } as const;
      send.mutateAsync({ ...input, idempotencyKey: r.key }).catch((err) => {
        // não perde o texto: volta para o campo para revisar e mandar de novo
        if (r.media) setAttachment(r.media);
        setText(r.text);
        toast.err(err);
      });
    }, Math.max(0, rapida.at - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a resposta agendada dispara o envio
  }, [rapida]);

  /** "Editar" na contagem: volta ao comportamento antigo — vai para o campo, sai quando a pessoa enviar. */
  function editarRapida() {
    if (!rapida) return;
    if (rapida.media) setAttachment(rapida.media);
    setText(rapida.media ? rapida.text : (t) => (t ? `${t} ` : '') + rapida.text);
    setRapida(null);
    campoRef.current?.focus();
  }

  if (!conv) {
    return (
      <div className="flex-1 grid place-items-center chat-bg">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-accent/10 text-accent grid place-items-center mb-3"><Send size={20} /></div>
          <p className="font-display font-semibold text-ink">{embedded ? 'Carregando conversa…' : 'Selecione uma conversa'}</p>
          {!embedded && <p className="text-sm text-muted mt-1">A fila à esquerda está separada por status: aguardando, em atendimento e encerrado.</p>}
        </div>
      </div>
    );
  }

  const quotaHit = usage.data?.limits && usage.data.limits.hardLimit && usage.data.limits.includedMessagesMonth != null && usage.data.used.messages >= usage.data.limits.includedMessagesMonth;
  const numberOffline = channelOffline(conv.number);
  const primaryTag = conv.tags.find((t) => t.isPrimary)?.tag;
  podeResponderRef.current = !noteMode && !(ownedByOther && !isAdmin) && !numberOffline && !quotaHit && conv.status !== 'closed';

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = assinando && !noteMode && text.trim() ? `*${me.data?.name ?? ''}*\n${text.trim()}` : text.trim();
    if (noteMode) {
      if (!unlocked || !t || sendNote.isPending) return;
      setText('');
      try {
        await sendNote.mutateAsync(t);
      } catch (err) {
        setText(t);
        toast.err(err);
      }
      return;
    }
    if ((!t && !attachment) || send.isPending) return;
    const att = attachment;
    setText('');
    setAttachment(null);
    // uma chave por envio: se a requisição repetir (rede, clique duplo), a API devolve a mesma mensagem
    const idempotencyKey = crypto.randomUUID();
    try {
      // citação segue o id do provider: é ele que o WhatsApp entende do outro lado
      const citando = respondendo?.externalId ? { quotedExternalId: respondendo.externalId } : {};
      if (att) {
        await send.mutateAsync({ type: mediaTypeOf(att.mimeType), mediaKey: att.key, text: t || undefined, media: { url: att.url, mimeType: att.mimeType, fileName: att.fileName }, ...citando, idempotencyKey });
      } else {
        await send.mutateAsync({ type: 'text', text: t, ...citando, idempotencyKey });
      }
      setRespondendo(null);
      // responder tira a conversa de "Aguardando": acompanha o filtro para ela não sumir da lista
      if (status === 'waiting' && conv?.status === 'waiting') setFilterStatus('in_progress', true);
    } catch (err) {
      setText(t);
      setAttachment(att);
      toast.err(err);
    }
  }

  return (
    <>
      {/* Cabeçalho: contato, tags, ações de status.
          `flex-wrap`: a largura aqui não depende do tamanho da tela, e sim de o painel da
          direita estar aberto — com ele aberto as ações estouravam e o "Encerrar" ficava
          escondido atrás da borda do painel. Quebrar linha adapta à largura real; esconder
          botão por breakpoint não resolveria, porque o breakpoint não sabe do painel. */}
      <header className="bg-panel border-b border-line px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {!embedded && (
          <button className="md:hidden text-muted" onClick={() => setConversation(null)}>
            <ArrowLeft size={20} />
          </button>
        )}
        <Avatar name={conv.contact.name ?? conv.contact.phone} phone={conv.contact.phone} src={conv.contact.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-ink flex items-center gap-1.5 min-w-0">
            <span className="truncate">{conv.contact.name ?? `+${conv.contact.phone}`}</span>
            {/* por qual número esta conversa responde — ao lado do nome, para não passar batido */}
            <ChannelBadge channel={conv.number} phone="full" className="shrink-0" />
            <DepartmentBadge department={conv.department} className="shrink-0 max-w-[140px]" />
            {botPaused(conv) && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink" title="Automação pausada só nesta conversa">
                <BotOff size={10} />Robô pausado
              </span>
            )}
            {/* etapa do atendimento (tag principal) — a mesma coluna em que ele está no Kanban */}
            {primaryTag && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-white rounded-full px-2 py-0.5" style={{ background: primaryTag.color }} title="Tag principal — etapa no Kanban">
                <Star size={9} className="fill-current" />{primaryTag.name}
              </span>
            )}
          </div>
          {typing ? (
            <div className="text-xs text-ok font-medium truncate animate-fade-in" aria-live="polite">
              {conv.contact.name ?? `+${conv.contact.phone}`} {typing.state === 'recording' ? 'está gravando áudio…' : 'está digitando…'}
            </div>
          ) : (
          <div className="text-xs text-muted truncate tnum flex items-center gap-1.5">
            <span className="truncate">+{conv.contact.phone}{conv.assignee && ` · ${conv.assignee.name}`}</span>
            <OriginBadge origin={conv.origin} data={conv.originData} detailed />
          </div>
          )}
        </div>
        <span className={cn('hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1', STATUS_META[conv.status].soft, STATUS_META[conv.status].color)}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_META[conv.status].short}
        </span>
        {sched.has && (
          <Button size="sm" variant="ghost" icon={<CalendarPlus size={14} />} onClick={() => setScheduling(true)} title="Agendar horário para este cliente"><span className="hidden sm:inline">Agendar</span></Button>
        )}
        {conv.status === 'waiting' && (
          <Button size="sm" icon={<Hand size={14} />} loading={claim.isPending} loadingText="Assumindo…" onClick={() => claim.mutateAsync(conv.id).then(() => { toast.ok('Você assumiu este atendimento'); setFilterStatus('in_progress', true); }).catch(toast.err)} title="Assumir atendimento">
            <span className="hidden sm:inline">Assumir</span>
          </Button>
        )}
        {conv.status === 'in_progress' && (mine || podeTransferir) && (
          <div className="relative">
            <Button size="sm" variant="ghost" icon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen((o) => !o)} title="Transferir ou devolver à fila">
              <span className="hidden sm:inline">Transferir</span>
            </Button>
            {transferOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl bg-panel border border-line shadow-lg py-1 text-sm" onMouseLeave={() => setTransferOpen(false)}>
                <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Transferir para</div>
                {agents.data?.filter((a) => a.isActive && a.id !== conv.assignee?.id).map((a) => (
                  <button key={a.id} onClick={() => { setTransferOpen(false); transfer.mutateAsync({ id: conv.id, agentId: a.id }).then(() => toast.ok(`Transferido para ${a.name}`)).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                    <UserRound size={13} className="text-faint" /> {a.name}
                  </button>
                ))}
                {agents.data?.filter((a) => a.isActive && a.id !== conv.assignee?.id).length === 0 && <div className="px-3 py-1.5 text-muted text-xs">Nenhum outro atendente ativo.</div>}
                <div className="border-t border-line my-1" />
                <button onClick={() => { setTransferOpen(false); release.mutateAsync(conv.id).then(() => { toast.ok('Devolvida para a fila'); setFilterStatus('waiting', true); }).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                  <Undo2 size={13} className="text-faint" /> Devolver à fila
                </button>
              </div>
            )}
          </div>
        )}
        {/* Departamento: mesma regra de quem pode do "Devolver à fila" — o dono, quem tem
            permissão, ou qualquer um enquanto a conversa está sem dono */}
        {(departments.data?.some((d) => d.isActive) || conv.department) && (!conv.assignee || mine || podeTransferir) && (
          <div className="relative">
            <Button size="sm" variant="ghost" icon={<Building2 size={14} />} onClick={() => setDeptOpen((o) => !o)} title="Transferir para outro departamento">
              <span className="hidden lg:inline">Departamento</span>
            </Button>
            {deptOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-60 rounded-xl bg-panel border border-line shadow-lg py-1 text-sm" onMouseLeave={() => setDeptOpen(false)}>
                <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Transferir para o departamento</div>
                {departments.data?.filter((d) => d.isActive && d.id !== conv.department?.id).map((d) => (
                  <button key={d.id} onClick={() => { setDeptOpen(false); setDepartment.mutateAsync({ id: conv.id, departmentId: d.id }).then(() => { toast.ok(conv.status === 'closed' ? `Departamento: ${d.name}` : `Enviada para a fila de ${d.name}`); if (conv.status !== 'closed') setFilterStatus('waiting', true); }).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} /> <span className="truncate">{d.name}</span>
                  </button>
                ))}
                {conv.department && (
                  <>
                    <div className="border-t border-line my-1" />
                    <button onClick={() => { setDeptOpen(false); setDepartment.mutateAsync({ id: conv.id, departmentId: null }).then(() => { toast.ok('Conversa sem departamento'); if (conv.status !== 'closed') setFilterStatus('waiting', true); }).catch(toast.err); }} className="w-full text-left px-3 py-1.5 hover:bg-field text-ink flex items-center gap-2">
                      <X size={13} className="text-faint" /> Tirar do departamento
                    </button>
                  </>
                )}
                {conv.status !== 'closed' && <p className="px-3 pt-1.5 pb-1 text-[11px] text-muted border-t border-line mt-1">A conversa volta para a fila (Aguardando) do departamento escolhido.</p>}
              </div>
            )}
          </div>
        )}
        {ai.enabled && <SummaryButton conversationId={conv.id} />}
        <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => setHistorico(true)} title="Quem assumiu, transferiu e encerrou — e quando">
          <span className="hidden lg:inline">Histórico</span>
        </Button>
        {conv.status !== 'closed' ? (
          <Button size="sm" variant="ghost" icon={<CheckCircle2 size={14} />} onClick={() => setClosing(true)} title="Encerrar atendimento e registrar o resultado">
            <span className="hidden sm:inline">Encerrar</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={setStatus.isPending} onClick={() => setStatus.mutateAsync({ id: conv.id, status: 'in_progress' }).then(() => toast.ok('Conversa reaberta')).catch(toast.err)} title="Reabrir">
            <span className="hidden sm:inline">Reabrir</span>
          </Button>
        )}
      </header>

      <ContactSummary contact={conv.contact} onOpen={() => setFichaAberta(true)} />
      {fichaAberta && <ContactSheet contact={conv.contact} onClose={() => setFichaAberta(false)} />}

      {/* Ficha de agendamento do contato */}
      {sched.has && card.data && (card.data.upcoming.length > 0 || card.data.visits > 0) && (
        <div className="bg-panel border-b border-line px-3 py-1 text-[11.5px] text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>💈 {card.data.visits} visita{card.data.visits === 1 ? '' : 's'}{card.data.last ? ` · última ${new Date(card.data.last.startAt).toLocaleDateString('pt-BR')} (${card.data.last.service.name})` : ''}</span>
          {card.data.upcoming.map((a) => <span key={a.id} className="text-ink">Próximo: <b>{new Date(a.startAt).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b> · {a.service.name} com {a.professional.name}{a.status === 'confirmed' ? ' ✅' : ''}</span>)}
        </div>
      )}

      {/* Fluxo de automação rodando */}
      {activeRun.data && (
        <div className="bg-accent-soft border-b border-accent/20 px-3 py-1.5 text-xs text-accent-ink flex items-center gap-2">
          <span className="animate-pulse">🤖</span>
          <span className="flex-1 truncate">Fluxo <b>{activeRun.data.flow.name}</b> está atendendo{activeRun.data.status === 'waiting' && activeRun.data.waitUntil ? ` · aguardando até ${new Date(activeRun.data.waitUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : activeRun.data.status === 'waiting' ? ' · esperando resposta do contato' : ''}</span>
          <Button size="sm" variant="ghost" loading={stopFlow.isPending} onClick={() => conversationId && stopFlow.mutateAsync(conversationId).then(() => toast.ok('Fluxo parado — a conversa é sua')).catch(toast.err)}>Parar e assumir</Button>
        </div>
      )}

      {/* Tags: do atendimento (esta conversa) e da pessoa (valem para sempre) */}
      <div className="bg-panel border-b border-line px-3 py-1 grid sm:grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint shrink-0 w-14" title="Tags deste atendimento">Conversa</span>
          <div className="flex-1 min-w-0"><TagPicker compact tags={tags.data ?? []} value={conv.tags.map((t) => t.tag.id)} onChange={(ids) => setTags.mutate({ id: conv.id, tagIds: ids })} primaryId={primaryTag?.id ?? null} onPrimary={(tagId) => setPrimary.mutateAsync({ id: conv.id, tagId }).catch(toast.err)} placeholder="Adicionar tag" /></div>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint shrink-0 w-14" title="Tags da pessoa — valem em todas as conversas dela">📌 Contato</span>
          <div className="flex-1 min-w-0"><TagPicker compact tags={tags.data ?? []} value={(conv.contact.tags ?? []).map((t) => t.tag.id)} onChange={(ids) => setContactTags.mutate({ contactId: conv.contact.id, tagIds: ids })} placeholder="Tag permanente" /></div>
        </div>
      </div>

      {/* Mensagens */}
      <div ref={rolagemRef} onScroll={aoRolar} className="flex-1 overflow-y-auto chat-bg px-4 py-2.5 space-y-1 scrollbar-thin">
        {messages.isFetchingNextPage && <div className="py-2 text-center text-[11.5px] text-muted">Carregando mensagens anteriores…</div>}
        {!messages.hasNextPage && !messages.isLoading && mensagens.length >= PAGINA_MENSAGENS && (
          <div className="py-2 text-center text-[11px] text-faint">Começo da conversa</div>
        )}
        {messages.isLoading && (
          <div className="space-y-2 pt-2">
            {[60, 40, 75, 35].map((w, i) => (
              <div key={i} className={i % 2 ? 'flex justify-end' : 'flex'}><div className="animate-pulse rounded-lg bg-panel/70 h-9" style={{ width: `${w}%` }} /></div>
            ))}
          </div>
        )}
        {mensagens.map((m, i) => <Fragment key={m.id}>{mudouODia(mensagens[i - 1], m) && <SeparadorDeDia data={m.createdAt} />}<Bubble m={m} canResend={!numberOffline} onVerImagem={setVendoImagem} onResponder={setRespondendo} onEncaminhar={setEncaminhando} citada={m.quotedId ? mensagens.find((x) => x.externalId === m.quotedId) : undefined} /></Fragment>)}
        {typing && <TypingBubble recording={typing.state === 'recording'} />}
        <div ref={bottomRef} />
      </div>

      {closing && <CloseModal conversationId={conv.id} onClose={() => setClosing(false)} />}
      {historico && <HistorySheet conversationId={conv.id} onClose={() => setHistorico(false)} />}

      {encaminhando && <ForwardModal message={encaminhando} onClose={() => setEncaminhando(null)} />}
      {vendoImagem && indiceImagem >= 0 && (
        <ImageViewer
          imagens={imagens}
          indice={indiceImagem}
          onIndice={(i) => setVendoImagem(imagens[i]?.url ?? null)}
          onClose={() => setVendoImagem(null)}
        />
      )}

      {/* prévia do que vai ser enviado, sobre o chat — nada sobe antes de confirmar */}
      {previa && (
        <MediaPreview
          file={previa}
          enviando={uploading || send.isPending}
          onCancel={() => setPrevia(null)}
          onConfirm={enviarDaPrevia}
        />
      )}
      <AppointmentModal open={scheduling} onClose={() => setScheduling(false)} contact={conv.contact} conversationId={conv.id} />

      {/* Composer */}
      {noteMode ? (
        <form onSubmit={submit} className={cn('border-t px-3 py-2 flex items-end gap-2 transition-colors', unlocked ? 'bg-warn-soft border-warn/40' : 'bg-field border-line')}>
          <Button type="button" variant="ghost" className={cn('w-9 h-9 rounded-full p-0 border-0', unlocked ? 'bg-warn text-white hover:bg-warn' : 'bg-transparent text-muted')} onClick={() => setUnlocked((u) => !u)} title={unlocked ? 'Fechar cadeado (parar de enviar notas)' : 'Abrir cadeado para enviar nota interna ao atendente'} icon={unlocked ? <Unlock size={18} /> : <Lock size={18} />} />
          {unlocked ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())} rows={1} placeholder={`Nota interna para ${conv.assignee?.name} — o cliente não vê`} className="flex-1 resize-none max-h-40 rounded-xl bg-panel text-ink placeholder:text-warn-ink/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-warn/50" />
              <Button type="submit" className="w-9 h-9 rounded-full p-0 bg-warn hover:bg-warn/90" disabled={!text.trim()} loading={sendNote.isPending} icon={<Send size={18} />} title="Enviar nota interna" />
            </>
          ) : (
            <div className="flex-1 text-sm text-muted py-2.5"><b className="text-ink">{conv.assignee?.name}</b> está atendendo. Abra o cadeado para mandar uma nota interna, ou transfira para você.</div>
          )}
        </form>
      ) : ownedByOther && !isAdmin ? (
        <div className="bg-field border-t border-line px-4 py-3 text-sm text-muted flex items-center gap-2">
          <UserRound size={16} className="shrink-0" />
          <span className="flex-1"><b className="text-ink">{conv.assignee?.name}</b> está atendendo esta conversa. Peça a transferência ou aguarde a devolução à fila.</span>
        </div>
      ) : numberOffline ? (
        <div className="bg-danger-soft border-t border-danger/30 px-4 py-3 text-sm text-danger-ink flex items-center gap-2">
          <WifiOff size={16} className="shrink-0" />
          <span className="flex-1">O número <b>{conv.number.label}</b> está desconectado. Você continua recebendo, mas não consegue responder.</span>
          <Link href="/numeros" className="underline font-medium whitespace-nowrap">Conectar</Link>
        </div>
      ) : quotaHit ? (
        <div className="bg-warn-soft border-t border-warn/30 px-4 py-3 text-sm text-warn-ink">
          Limite de mensagens do plano <b>{usage.data?.plan}</b> atingido neste mês. Faça upgrade para continuar respondendo.
        </div>
      ) : conv.status === 'closed' ? (
        <div className="bg-panel border-t border-line px-4 py-3 text-sm text-muted text-center">Conversa encerrada. Reabra para responder.</div>
      ) : (
        <form onSubmit={submit} className="bg-panel border-t border-line px-2.5 py-1.5 space-y-1.5">
          {rapida && <QuickReplyCountdown pending={rapida} onCancel={() => setRapida(null)} onEdit={editarRapida} />}
          {/* de qual número a resposta vai sair: com vários canais, é o que evita responder pelo errado */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted rounded-md px-2 py-1" style={{ background: `color-mix(in srgb, ${channelColor(conv.number.color)} 8%, transparent)` }}>
            <span className="shrink-0">Enviando via:</span>
            <ChannelBadge channel={conv.number} phone="none" className="min-w-0" />
            {conv.number.phone && <span className="tnum shrink-0">({formatPhone(conv.number.phone)})</span>}
          </div>
          {attachment && (
            <div className="flex items-center gap-3 rounded-xl bg-field px-3 py-2 text-sm">
              {attachment.mimeType.startsWith('image/') ? <img src={attachment.url} alt="" className="w-12 h-12 rounded object-cover" /> : <FileText size={20} className="text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{attachment.fileName}</div>
                <div className="text-xs text-faint">{(attachment.size / 1024).toFixed(0)} KB · legenda opcional abaixo</div>
              </div>
              <button type="button" onClick={() => setAttachment(null)} className="text-faint hover:text-ink"><X size={16} /></button>
            </div>
          )}
          {respondendo && (
            <div className="flex items-stretch gap-2 rounded-lg bg-field border-l-4 border-accent px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-accent-ink">{respondendo.direction === 'out' ? 'Respondendo a você' : 'Respondendo ao contato'}</div>
                <div className="text-[12px] text-muted truncate">{resumoDaMensagem(respondendo)}</div>
              </div>
              <button type="button" onClick={() => setRespondendo(null)} className="text-faint hover:text-ink self-center" title="Cancelar resposta"><X size={15} /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" hidden onChange={pickFile} accept={accept} />
          {!gravando && (
            <>
              <textarea
                ref={campoRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
                onPaste={colar}
                rows={1}
                placeholder={attachment ? 'Legenda (opcional)' : 'Mensagem… (Enter envia)'}
                className="flex-1 resize-none max-h-40 rounded-xl bg-field text-ink placeholder:text-faint px-3.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </>
          )}
          {/* microfone no lugar do enviar: com algo escrito (ou anexo) vira o botão de enviar */}
          {text.trim() || attachment ? (
            <Button type="submit" className="w-9 h-9 rounded-full p-0" disabled={uploading} loading={send.isPending} icon={<Send size={18} />} title="Enviar" />
          ) : (
            <AudioRecorder disabled={uploading} onRecorded={sendRecorded} onRecordingChange={setGravando} />
          )}
          </div>

          {/* atalhos embaixo do campo, como no WhatsApp: a mão está no teclado */}
          {!gravando && (
            <ComposerBar
              conversationId={conv.id}
              onInserir={inserirNoTexto}
              onEscolherArquivo={pick}
              enviando={uploading}
              assinando={assinando}
              onAssinando={setAssinando}
              direita={ai.enabled ? <CopilotBar conversationId={conv.id} text={text} onText={setText} /> : null}
            />
          )}
          {flowsFeature.has && <BotPauseBar conv={conv} />}
        </form>
      )}
    </>
  );
}

/** Uma linha do que foi citado: texto curto, ou o rótulo da mídia. */
/** Três pontinhos em onda, no lugar onde a próxima mensagem do contato vai aparecer. */
function TypingBubble({ recording }: { recording: boolean }) {
  return (
    <div className="flex animate-fade-in" aria-label={recording ? 'Contato gravando áudio' : 'Contato digitando'}>
      <div className="bub-in bg-chat-in text-chat-in-ink rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-1">
        {recording && <span className="text-[11px] text-muted mr-1">🎙️</span>}
        {[0, 1, 2].map((i) => <span key={i} className="typing-dot w-1.5 h-1.5 rounded-full bg-muted" style={{ animationDelay: `${i * 160}ms` }} />)}
      </div>
    </div>
  );
}

export function resumoDaMensagem(m: Message): string {
  return messagePreview(m);
}

function Bubble({ m, canResend, onVerImagem, onResponder, onEncaminhar, citada }: { m: Message; canResend: boolean; onVerImagem?: (url: string) => void; onResponder?: (m: Message) => void; onEncaminhar?: (m: Message) => void; citada?: Message }) {
  const out = m.direction === 'out';
  const resend = useResend();
  const estruturado = structuredBody(m);
  if (m.internal) {
    return (
      <div className="flex justify-center my-1">
        <div className="max-w-[80%] rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-sm shadow-sm">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-warn-ink mb-0.5"><Lock size={11} /> Nota interna · {m.author?.name ?? 'robô do fluxo'} <span className="text-warn-ink/60 normal-case tracking-normal font-normal">· só a equipe vê</span></div>
          <p className="whitespace-pre-wrap break-words text-ink">{m.text}</p>
          <div className="text-[10px] text-warn-ink/70 text-right tnum font-mono mt-0.5">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
    );
  }
  return (
    <div id={`msg-${m.id}`} className={cn('group flex items-center gap-1 rounded-lg transition-colors duration-700', out ? 'justify-end' : 'justify-start')}>
      {out && <AcoesDaBolha m={m} out onResponder={onResponder} onEncaminhar={onEncaminhar} podeReagir={canResend} />}
      <div className={cn('relative max-w-[72%] px-2.5 py-1.5 text-[13px]', m.reactions?.length && 'mb-3', out ? 'bub-out text-chat-out-ink rounded-2xl rounded-br-md' : 'bub-in bg-chat-in text-chat-in-ink rounded-2xl rounded-bl-md')}>
        {m.forwarded && <ForwardedLabel score={m.forwardingScore} />}
        <Citacao m={m} citada={citada} />
        {estruturado ?? (
          <>
            <MediaBody m={m} onVerImagem={onVerImagem} />
            {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
          </>
        )}
        <div className={cn('flex items-center justify-end gap-1 mt-0.5 text-[10px] tnum font-mono', out ? 'text-chat-out-ink/75' : 'text-faint')}>
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {out && <StatusIcon status={m.status} error={m.error} />}
        </div>
        {(m.status === 'failed' || (m.error && !m.mediaUrl)) && (
          <p className={cn('text-[10px] mt-0.5 flex items-center gap-2', out ? 'text-danger-ink bg-danger-soft rounded px-1.5 py-0.5' : 'text-danger')}>
            <span className="flex-1">{m.error ?? 'Falha ao enviar'}</span>
            {m.status === 'failed' && canResend && (
              <button onClick={() => resend.mutateAsync({ conversationId: m.conversationId, messageId: m.id }).catch(toast.err)} disabled={resend.isPending} className="inline-flex items-center gap-1 rounded bg-panel/70 px-1.5 py-0.5 text-danger-ink hover:bg-panel">
                <RefreshCw size={10} className={resend.isPending ? 'animate-spin' : ''} /> Tentar novamente
              </button>
            )}
          </p>
        )}
        {/* reação fica pendurada na borda da bolha, como no WhatsApp */}
        {!!m.reactions?.length && (
          <div className={cn('absolute -bottom-3.5 flex items-center gap-0.5 rounded-full bg-panel border border-line shadow-sm px-1.5 py-px text-[13px] leading-none', out ? 'right-2' : 'left-2')} title={m.reactions.map((r) => `${r.emoji} ${r.fromMe ? 'você' : 'contato'}`).join(' · ')}>
            {m.reactions.map((r) => <span key={`${r.fromMe}`}>{r.emoji}</span>)}
          </div>
        )}
      </div>
      {!out && <AcoesDaBolha m={m} out={false} onResponder={onResponder} onEncaminhar={onEncaminhar} podeReagir={canResend} />}
    </div>
  );
}

/**
 * Separador de dia, como no WhatsApp.
 *
 * Sem ele a conversa é um rolo contínuo: o atendente lê "às 14:20" e não sabe se foi hoje ou
 * há três semanas — e essa diferença muda o que ele responde.
 */
function SeparadorDeDia({ data }: { data: string }) {
  return (
    <div className="dia-sep flex items-center gap-3 py-2 select-none">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted bg-panel/80 rounded-full px-2.5 py-0.5 shadow-sm">{rotuloDoDia(data)}</span>
    </div>
  );
}

function rotuloDoDia(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  // dentro da semana o dia da semana diz mais que a data: "terça" se localiza melhor que 30/09
  if ((hoje.getTime() - d.getTime()) / 86_400_000 < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === hoje.getFullYear() ? undefined : 'numeric' });
}

function mudouODia(anterior: Message | undefined, atual: Message) {
  if (!anterior) return true;
  return new Date(anterior.createdAt).toDateString() !== new Date(atual.createdAt).toDateString();
}

/**
 * Ações que aparecem no hover, do lado de fora da bolha (para não roubar espaço do texto).
 * Ficam do lado de dentro da conversa: à esquerda das enviadas, à direita das recebidas.
 * Só para mensagem que chegou ao WhatsApp — sem `externalId` não há o que citar nem reagir.
 */
function AcoesDaBolha({ m, out, onResponder, onEncaminhar, podeReagir }: { m: Message; out: boolean; onResponder?: (m: Message) => void; onEncaminhar?: (m: Message) => void; podeReagir: boolean }) {
  if (!m.externalId) return null;
  const reagir = podeReagir && m.status !== 'pending' && m.status !== 'failed' && <BotaoReagir m={m} out={out} />;
  const responder = onResponder && <BotaoResponder m={m} onResponder={onResponder} />;
  // figurinha não sai pelos providers; o resto vira envio normal (mídia, texto ou link)
  const encaminhar = onEncaminhar && m.type !== 'sticker' && <BotaoAcao titulo="Encaminhar" onClick={() => onEncaminhar(m)}><Forward size={14} /></BotaoAcao>;
  return <div className="flex items-center shrink-0">{out ? <>{encaminhar}{reagir}{responder}</> : <>{responder}{reagir}{encaminhar}</>}</div>;
}

function BotaoAcao({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo} className="opacity-0 group-hover:opacity-100 text-faint hover:text-ink shrink-0 p-1">
      {children}
    </button>
  );
}

/** Os mesmos do atalho do WhatsApp: cobre quase toda reação que um atendimento precisa. */
const REACOES = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * Reagir com emoji. Escolher o mesmo emoji que já está lá retira a reação, como no WhatsApp.
 * O menu fica aberto mesmo sem hover (senão some quando o mouse sai da linha) e fecha ao
 * clicar fora.
 */
function BotaoReagir({ m, out }: { m: Message; out: boolean }) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const reagir = useReact();
  const minha = m.reactions?.find((r) => r.fromMe)?.emoji;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixaRef.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  function escolher(emoji: string) {
    setAberto(false);
    reagir.mutateAsync({ conversationId: m.conversationId, messageId: m.id, emoji: emoji === minha ? '' : emoji }).catch(toast.err);
  }

  return (
    <div ref={caixaRef} className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} disabled={reagir.isPending} title="Reagir" aria-label="Reagir" className={cn('text-faint hover:text-ink shrink-0 p-1', aberto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
        <SmilePlus size={14} />
      </button>
      {aberto && (
        <div className={cn('absolute bottom-full mb-1 z-20 flex gap-0.5 rounded-full border border-line bg-panel shadow-lg px-1.5 py-1', out ? 'right-0' : 'left-0')}>
          {REACOES.map((e) => (
            <button key={e} type="button" onClick={() => escolher(e)} title={e === minha ? 'Retirar reação' : undefined} className={cn('text-lg leading-none rounded-full p-1 hover:bg-field', e === minha && 'bg-accent-soft')}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BotaoResponder({ m, onResponder }: { m: Message; onResponder: (m: Message) => void }) {
  return (
    <button type="button" onClick={() => onResponder(m)} title="Responder" aria-label="Responder" className="opacity-0 group-hover:opacity-100 text-faint hover:text-ink shrink-0 p-1">
      <Reply size={14} />
    </button>
  );
}

/**
 * O trecho citado dentro da bolha.
 *
 * Três origens, em ordem de preferência: a mensagem que temos no histórico, o texto que o
 * provider mandou junto (`quotedPreview`) e, no fim, um rótulo genérico. A segunda existe
 * por causa do **status**: o story some em 24h e não é mensagem da conversa, então sem o
 * texto guardado sobraria "quero esse" sem ninguém saber o quê.
 */
function Citacao({ m, citada }: { m: Message; citada?: Message }) {
  const q = m.quoted;
  if (!q && !m.quotedId && !m.quotedPreview) return null;
  const texto = q?.preview || (citada ? resumoDaMensagem(citada) : m.quotedPreview) || 'Mensagem';
  const fromStatus = q?.fromStatus ?? m.quotedFromStatus;
  const direcao = q?.direction ?? citada?.direction;
  const autor = fromStatus ? 'Resposta ao status' : q?.authorName ?? (direcao === 'out' ? 'Você' : direcao === 'in' ? 'Contato' : 'Mensagem citada');
  const alvo = q?.messageId ?? citada?.id;
  const conteudo = (
    <>
      <div className="text-[10.5px] font-semibold opacity-80">{autor}</div>
      <div className="text-[11.5px] opacity-80 line-clamp-2 break-words">{texto}</div>
    </>
  );
  const caixa = 'mb-1 block w-full text-left rounded-md border-l-[3px] border-accent bg-black/5 dark:bg-white/10 px-2 py-1';
  if (!alvo) return <div className={caixa}>{conteudo}</div>;
  return (
    <button type="button" onClick={() => irParaMensagem(alvo)} title="Ir para a mensagem citada" className={cn(caixa, 'hover:bg-black/10 dark:hover:bg-white/15 cursor-pointer')}>
      {conteudo}
    </button>
  );
}

const DESTAQUE_CITADA = ['bg-accent/15'];

/** Rola até a mensagem citada e pisca. Fora da página carregada, avisa em vez de falhar calado. */
function irParaMensagem(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) { toast.ok('A mensagem citada está mais acima no histórico — role para carregar.'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(...DESTAQUE_CITADA);
  setTimeout(() => el.classList.remove(...DESTAQUE_CITADA), 1200);
}

/** Corpo de mídia da bolha. Sem mediaUrl ainda (download em andamento) mostra placeholder. */
function MediaBody({ m, onVerImagem }: { m: Message; onVerImagem?: (url: string) => void }) {
  // só mídia: localização, contato, botões e afins são desenhados por `structuredBody`
  if (!['image', 'audio', 'video', 'document', 'sticker'].includes(m.type)) return null;
  if (!m.mediaUrl) return <span className="italic text-muted text-xs">[{labelOf(m.type)}{m.error ? ' · indisponível' : m.status === 'pending' ? '' : ' · carregando…'}]</span>;
  // abre por cima, não em aba nova: abrir fora tirava o atendente da conversa
  if (m.type === 'image' || m.type === 'sticker') {
    return <img src={m.mediaUrl} alt="" onClick={() => onVerImagem?.(m.mediaUrl!)} className="rounded-md max-h-72 max-w-full object-contain mb-1 cursor-zoom-in" />;
  }
  if (m.type === 'audio') return <AudioMessage src={m.mediaUrl} mine={m.direction === 'out'} />;
  if (m.type === 'video') return <video controls preload="metadata" src={m.mediaUrl} className="rounded-md max-h-72 max-w-full mb-1" />;
  return (
    <a href={m.mediaUrl} target="_blank" rel="noreferrer" download={m.mediaName ?? undefined} className="flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 mb-1 hover:bg-black/10">
      <FileText size={20} className="text-muted shrink-0" />
      <span className="truncate text-xs font-medium flex-1">{m.mediaName ?? labelOf(m.type)}</span>
      <Download size={14} className="text-faint" />
    </a>
  );
}
const labelOf = (t: string) => ({ image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contact: 'contato' } as Record<string, string>)[t] ?? t;

/** Ticks do WhatsApp: relógio → ✓ servidor → ✓✓ aparelho → ✓✓ ciano lido. Vem do webhook de status. */
function StatusIcon({ status, error }: { status: string; error?: string | null }) {
  if (status === 'pending') return <span title="Enviando"><Clock size={12} className="opacity-70" /></span>;
  if (status === 'sent') return <span title="Enviada"><Check size={13} /></span>;
  if (status === 'delivered') return <span title="Entregue"><CheckCheck size={13} /></span>;
  if (status === 'read') return <span title="Lida"><CheckCheck size={13} className="text-chat-tick-read" /></span>;
  return <span title={error ? `Falha no envio: ${error}` : 'Falha no envio'}><AlertCircle size={12} className="text-danger" /></span>;
}
