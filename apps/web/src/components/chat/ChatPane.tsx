'use client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileText, Download, X, RefreshCw, Reply, SmilePlus, Forward, WifiOff, Hand, ArrowRightLeft, Undo2, UserRound, Lock, StickyNote, CalendarPlus, Image as ImageIcon, Video, Building2, Trash2, Eraser, Ban, Eye, EyeOff, Maximize2, Pencil } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { AppointmentModal } from '@/components/scheduling/AppointmentModal';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Send, Check, CheckCheck, Clock, AlertCircle, CheckCircle2, RotateCcw, History, BotOff, FileCheck2, CircleDashed, Play, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useAiStatus, useDepartments, useSetConversationDepartment } from '@/lib/hooks';
import { DepartmentBadge } from './DepartmentBadge';
import { useConversation, useMessages, useResend, useReact, useClaim, useTransfer, useRelease, useMe, useAgents, useSendNote, useActiveRun, useStopFlow, botPaused, useSetContactTags, useHasFeature, useContactCard, useSendMessage, useSetStatus, useSetTags, useSetPrimaryTag, useTags, useUsage, useTenantSettings, useMarkRead, useCan, useTyping, useDeleteMessage, useEditMessage, useDeletedOriginal, useClearHistory, uploadFile, useTypingPresence, mediaTypeOf, mensagensEmOrdem, PAGINA_MENSAGENS, type Message, type Upload } from '@/lib/hooks';
import { TagPicker } from './TagPicker';
import { STATUS_META } from './ConversationList';
import { ZoomableAvatar } from './AvatarViewer';
import { OriginBadge } from './OriginBadge';
import { channelOffline } from './ChannelBadge';
import { CopilotBar, SummaryButton } from './Copilot';
import { CloseModal } from './CloseModal';
import { Modal, inputCls } from '@/components/ui/Modal';
import { ComposerBar } from './ComposerBar';
import { ScheduledMessagesBar } from './ScheduledMessages';
import { useAutoResize } from './useAutoResize';
import { QUICK_REPLY_EVENT, QuickReplyCountdown, type QuickReplyEventDetail, type QuickReplyPending } from './QuickReplyCountdown';
import { MESSAGE_EDIT_WINDOW_MS, OWN_MESSAGE_DELETE_WINDOW_MS, QUICK_REPLY_DELAY_DEFAULT_SEC } from '@atendo/shared';
import { HistorySheet } from './HistorySheet';
import { AudioRecorder } from './AudioRecorder';
import { usePersistedState } from '@/lib/persisted';
import { AudioMessage } from './AudioMessage';
import { ContactSheet, ContactSummary } from './ContactSheet';
import { MediaPreview, type Escolhido } from './MediaPreview';
import { MediaViewerModal, type ViewerMedia } from './MediaViewer';
import { ForwardModal } from './ForwardModal';
import { TemplateSendModal } from './TemplateSendModal';
import { useMinuto } from './ConversationList';
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
  const { setConversation } = ui;
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
  const podeTransferir = useCan('conversations.transfer_any');
  const podeNota = useCan('conversations.internal_note');
  // Apagar (docs/apagar-mensagens.md): a própria mensagem recente qualquer um apaga; o resto é
  // `delete_message`. A API corta de novo — aqui é só para não oferecer o que vai dar 403.
  const podeApagarQualquer = useCan('conversations.delete_message');
  const podeVerApagada = useCan('conversations.view_deleted');
  const podeLimpar = useCan('conversations.delete_chat');
  const [apagando, setApagando] = useState<Message | null>(null);
  const [limpando, setLimpando] = useState(false);
  const apagar = useDeleteMessage();
  const limpar = useClearHistory();
  const podeApagar = (m: Message) =>
    !m.deletedAt && (podeApagarQualquer || (m.direction === 'out' && !!m.authorId && m.authorId === me.data?.id && Date.now() - new Date(m.createdAt).getTime() < OWN_MESSAGE_DELETE_WINDOW_MS));
  // Editar (docs/editar-mensagens.md): qualquer mensagem de texto enviada pelo número (própria, de
  // colega, do celular, do robô), com a permissão. Na fila a qualquer momento; enviada, só na
  // Evolution e dentro dos 15 min do WhatsApp. A API corta de novo.
  const podeEditarPerfil = useCan('conversations.edit_message');
  const [editando, setEditando] = useState<Message | null>(null);
  const podeEditar = (m: Message) =>
    podeEditarPerfil && !m.deletedAt && !m.internal && m.direction === 'out' && m.type === 'text' && !m.content && m.status !== 'failed'
    // na fila ainda dá em qualquer provider (o texto novo é o que sai); enviada, só Evolution e no prazo
    && (m.status === 'pending' || (conv?.number.provider !== 'meta' && Date.now() - new Date(m.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MS));
  const mine = !!conv && conv.assignee?.id === me.data?.id;
  const ownedByOther = !!conv && !!conv.assignee && !mine;
  // Modo nota interna: o composer vira âmbar e o que sai é NOTA (só a equipe vê, nunca vai ao
  // WhatsApp). Vale em qualquer conversa; na de outra pessoa é o único jeito de escrever (cadeado).
  // Texto separado do da resposta: desligar o modo nunca manda a nota para o cliente por engano.
  // Reseta ao trocar de conversa.
  const [modoNota, setModoNota] = useState(false);
  const [textoNota, setTextoNota] = useState('');
  useEffect(() => { setModoNota(false); setTextoNota(''); }, [conversationId]);
  const notaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (modoNota) notaRef.current?.focus(); }, [modoNota]);
  // Alt+N liga/desliga. `code`, não `key`: no Mac Alt+N é tecla morta ("˜")
  useEffect(() => {
    if (!podeNota) return;
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyN') return;
      e.preventDefault();
      setModoNota((v) => !v);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [podeNota]);
  const sendNote = useSendNote(conversationId);
  const noteMode = podeNota && modoNota;
  const activeRun = useActiveRun(conversationId);
  const stopFlow = useStopFlow();
  const sched = useHasFeature('scheduling');
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
  // janela de 24h da Meta: o relógio da lista re-renderiza para a barra aparecer quando ela fecha
  const agora = useMinuto();
  const [enviandoTemplate, setEnviandoTemplate] = useState(false);
  // gravando: a linha inteira vira a gravação, como no WhatsApp
  const [gravando, setGravando] = useState(false);
  const setStatus = useSetStatus();
  const setTags = useSetTags();
  const setPrimary = useSetPrimaryTag();
  const setContactTags = useSetContactTags();
  const usage = useUsage();
  const [text, setText] = useState('');
  // "digitando…" no WhatsApp do contato enquanto o atendente escreve (começo e fim)
  const presenca = useTypingPresence(conversationId);
  const [attachment, setAttachment] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  // arquivo escolhido ainda NÃO enviado: fica na prévia até a pessoa confirmar
  const [previa, setPrevia] = useState<File | null>(null);
  // imagens e vídeos desta conversa, na ordem em que aparecem: as setas do visualizador andam por eles
  // a foto/vídeo do status respondido entra antes da mensagem: é o que ela está respondendo
  const midias: ViewerMedia[] = mensagens.filter((m) => !m.deletedAt).flatMap((m) => [
    ...(m.quoted?.mediaUrl ? [{ url: m.quoted.mediaUrl, nome: 'Status respondido', tipo: m.quoted.mediaType ?? 'image' } as ViewerMedia] : []),
    ...(['image', 'sticker', 'video'].includes(m.type) && m.mediaUrl ? [{ url: m.mediaUrl, nome: m.mediaName, tipo: m.type === 'video' ? 'video' : 'image' } as ViewerMedia] : []),
  ]);
  const [vendoMidia, setVendoMidia] = useState<string | null>(null);
  const indiceMidia = midias.findIndex((i) => i.url === vendoMidia);
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
  useAutoResize(campoRef);
  useAutoResize(notaRef);
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
  /**
   * Assinatura do atendente (`*Nome:*` na 1ª linha) quando ligada. Um ponto só para o campo e
   * para a resposta rápida — antes a rápida saía pelo timer sem passar por aqui e ia sem nome.
   */
  const assinar = (t: string) => (assinando && t.trim() ? `*${me.data?.name ?? ''}:*\n${t.trim()}` : t.trim());
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
        ? { type: mediaTypeOf(r.media.mimeType), mediaKey: r.media.key, text: assinar(r.text) || undefined, media: { url: r.media.url, mimeType: r.media.mimeType, fileName: r.media.fileName } } as const
        : { type: 'text', text: assinar(r.text) } as const;
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
  /** API oficial e o contato não escreve há 24h: texto livre seria recusado, só template */
  const janelaFechada = conv.number.provider === 'meta' && (!conv.lastInboundAt || agora - Date.parse(conv.lastInboundAt) >= 24 * 60 * 60 * 1000);
  const primaryTag = conv.tags.find((t) => t.isPrimary)?.tag;
  /** quem aparece como autor da citação recebida e na faixa "Respondendo a …" */
  const nomeContato = conv.contact.name ?? `+${conv.contact.phone}`;
  // conversa de outra pessoa: ninguém responde por ela (a API recusa) — só nota interna
  podeResponderRef.current = !noteMode && !ownedByOther && !numberOffline && !quotaHit && conv.status !== 'closed';
  /** atalho para a nota nas barras em que não dá para responder (encerrada, número caído, cota) */
  const botaoNota = podeNota && (
    <button type="button" onClick={() => setModoNota(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-warn-ink bg-warn-soft hover:bg-warn-soft/70 whitespace-nowrap" title="Nota interna — só a equipe vê (Alt+N)"><StickyNote size={13} /> Nota interna</button>
  );

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    presenca.parar();
    if (noteMode) {
      const nota = textoNota.trim();
      if (!nota || sendNote.isPending) return;
      setTextoNota('');
      try {
        await sendNote.mutateAsync(nota);
      } catch (err) {
        setTextoNota(nota);
        toast.err(err);
      }
      return;
    }
    const t = assinar(text);
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
      // Responder NÃO troca a aba da lista. Trocava para "Em atendimento" para a conversa não
      // sumir de "Aguardando" — mas lá só estava ela: depois de restaurar o histórico (tudo
      // volta para a fila), cada resposta "apagava" a lista inteira. Quem segura a conversa
      // aberta na tela agora é a própria lista (ConversationList → `fixada`).
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
        <ZoomableAvatar name={conv.contact.name ?? conv.contact.phone} phone={conv.contact.phone} src={conv.contact.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-ink flex items-center gap-1.5 min-w-0">
            <span className="truncate">{conv.contact.name ?? `+${conv.contact.phone}`}</span>
            <DepartmentBadge department={conv.department} className="shrink-0 max-w-[140px]" />
            {botPaused(conv) && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink" title="Automação pausada só nesta conversa">
                <BotOff size={10} />Fluxo pausado
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
        {podeLimpar && (
          <Button size="sm" variant="ghost" icon={<Eraser size={14} />} onClick={() => setLimpando(true)} title="Limpar o histórico desta conversa (fica registrado quem limpou)" aria-label="Limpar histórico" />
        )}
        {conv.status !== 'closed' ? (
          <Button size="sm" variant="ghost" icon={<CheckCircle2 size={14} />} onClick={() => setClosing(true)} title="Encerrar atendimento e registrar o resultado">
            <span className="hidden sm:inline">Encerrar</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={setStatus.isPending} onClick={() => setStatus.mutateAsync({ id: conv.id, status: 'in_progress' }).then(() => { toast.ok('Conversa reaberta'); setFilterStatus('in_progress', true); }).catch(toast.err)} title="Reabrir">
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
        {mensagens.map((m, i) => <Fragment key={m.id}>{mudouODia(mensagens[i - 1], m) && <SeparadorDeDia data={m.createdAt} />}<Bubble m={m} canResend={!numberOffline} onVerMidia={setVendoMidia} onResponder={setRespondendo} onEncaminhar={setEncaminhando} onApagar={podeApagar(m) ? setApagando : undefined} onEditar={podeEditar(m) ? setEditando : undefined} podeVerApagada={podeVerApagada} citada={m.quotedId ? mensagens.find((x) => x.externalId === m.quotedId) : undefined} contato={nomeContato} /></Fragment>)}
        {typing && <TypingBubble recording={typing.state === 'recording'} />}
        <div ref={bottomRef} />
      </div>

      {closing && <CloseModal conversationId={conv.id} onClose={() => setClosing(false)} onClosed={() => setFilterStatus('closed', true)} />}
      {historico && <HistorySheet conversationId={conv.id} onClose={() => setHistorico(false)} />}
      {editando && <EditMessageModal m={editando} onClose={() => setEditando(null)} />}
      <ConfirmDialog
        open={!!apagando}
        title="Apagar mensagem?"
        danger
        confirmLabel="Apagar"
        text={apagando?.internal
          ? 'A nota sai do histórico e fica no lugar o registro de quem apagou e quando.'
          : apagando?.direction === 'in'
            ? 'A mensagem do contato some do painel (no celular dele ela continua). Fica no lugar o registro de quem apagou e quando.'
            : 'Se foi enviada há menos de 2 dias, o WhatsApp também tenta apagar no celular do contato (a API oficial da Meta não permite). No painel fica o registro de quem apagou e quando.'}
        onConfirm={() => apagando ? apagar.mutateAsync({ conversationId: apagando.conversationId, messageId: apagando.id })
          .then((r) => (r.notice ? toast.warn(r.notice) : toast.ok(r.forEveryone ? 'Mensagem apagada para todos' : 'Mensagem apagada')))
          .catch((err) => { toast.err(err); throw err; }) : undefined}
        onClose={() => setApagando(null)}
      />
      <ConfirmDialog
        open={limpando}
        title="Limpar o histórico desta conversa?"
        danger
        confirmLabel="Limpar histórico"
        text="Todas as mensagens somem do painel (no celular do contato continuam) e o que ainda estava na fila de envio é cancelado. Fica registrado quem limpou e quando. A conversa continua existindo."
        onConfirm={() => limpar.mutateAsync(conv.id)
          .then((r) => toast.ok(`${r.cleared} ${r.cleared === 1 ? 'mensagem apagada' : 'mensagens apagadas'}`))
          .catch((err) => { toast.err(err); throw err; })}
        onClose={() => setLimpando(false)}
      />

      {encaminhando && <ForwardModal message={encaminhando} onClose={() => setEncaminhando(null)} />}
      {enviandoTemplate && <TemplateSendModal conversationId={conv.id} numberId={conv.number.id} onClose={() => setEnviandoTemplate(false)} />}
      {vendoMidia && indiceMidia >= 0 && (
        <MediaViewerModal
          midias={midias}
          indice={indiceMidia}
          onIndice={(i) => setVendoMidia(midias[i]?.url ?? null)}
          onClose={() => setVendoMidia(null)}
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

      {/* agendadas desta conversa: aparece mesmo com o campo bloqueado (encerrada, de outra pessoa) */}
      <ScheduledMessagesBar conversationId={conv.id} />

      {/* Composer */}
      {noteMode ? (
        <form onSubmit={submit} className="border-t-2 border-dashed border-warn/60 bg-warn-soft px-3 py-2 space-y-1.5">
          <AbasDoEnvio nota onNota={setModoNota} />
          <div className="flex items-end gap-2">
            <textarea
              ref={notaRef}
              value={textoNota}
              onChange={(e) => setTextoNota(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return setModoNota(false);
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
              }}
              rows={1}
              placeholder={ownedByOther ? `Nota para ${conv.assignee?.name} — o cliente não vê` : 'Nota para a equipe — o cliente não vê'}
              className="flex-1 resize-none min-h-[38px] max-h-40 overflow-y-hidden scrollbar-thin rounded-xl bg-panel border border-warn/40 text-ink placeholder:text-warn-ink/60 px-3.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-warn/50"
            />
            <Button type="submit" className="h-9 rounded-full px-3.5 bg-warn hover:bg-warn/90 text-white border-0" disabled={!textoNota.trim()} loading={sendNote.isPending} icon={<StickyNote size={15} />}>Adicionar nota</Button>
          </div>
        </form>
      ) : ownedByOther && podeNota ? (
        <div className="bg-field border-t border-line px-3 py-2 flex items-center gap-2">
          <Button type="button" variant="ghost" className="w-9 h-9 rounded-full p-0 border-0 bg-transparent text-muted hover:text-warn-ink" onClick={() => setModoNota(true)} title="Abrir cadeado para enviar nota interna (Alt+N)" icon={<Lock size={18} />} />
          <div className="flex-1 text-sm text-muted py-2.5"><b className="text-ink">{conv.assignee?.name}</b> está atendendo. Abra o cadeado (Alt+N) para mandar uma nota interna, ou transfira para você.</div>
        </div>
      ) : ownedByOther ? (
        <div className="bg-field border-t border-line px-4 py-3 text-sm text-muted flex items-center gap-2">
          <UserRound size={16} className="shrink-0" />
          <span className="flex-1"><b className="text-ink">{conv.assignee?.name}</b> está atendendo esta conversa. Peça a transferência ou aguarde a devolução à fila.</span>
        </div>
      ) : numberOffline ? (
        <div className="bg-danger-soft border-t border-danger/30 px-4 py-3 text-sm text-danger-ink flex items-center gap-2">
          <WifiOff size={16} className="shrink-0" />
          <span className="flex-1">O número <b>{conv.number.label}</b> está desconectado. Você continua recebendo, mas não consegue responder.</span>
          <Link href="/numeros" className="underline font-medium whitespace-nowrap">Conectar</Link>
          {botaoNota}
        </div>
      ) : quotaHit ? (
        <div className="bg-warn-soft border-t border-warn/30 px-4 py-3 text-sm text-warn-ink flex items-center gap-2">
          <span className="flex-1">Limite de mensagens do plano <b>{usage.data?.plan}</b> atingido neste mês. Faça upgrade para continuar respondendo.</span>
          {botaoNota}
        </div>
      ) : conv.status === 'closed' ? (
        <div className="bg-panel border-t border-line px-4 py-3 text-sm text-muted flex items-center justify-center gap-3">Conversa encerrada. Reabra para responder.{botaoNota}</div>
      ) : janelaFechada ? (
        <div className="bg-warn-soft border-t border-warn/30 px-4 py-3 text-sm text-warn-ink flex items-center gap-2">
          <Clock size={16} className="shrink-0" />
          <span className="flex-1">Janela de 24h fechada: o contato não escreve há mais de um dia. Na API oficial só sai <b>template aprovado</b>.</span>
          <Button type="button" size="sm" onClick={() => setEnviandoTemplate(true)} icon={<FileCheck2 size={14} />}>Enviar template</Button>
          {botaoNota}
        </div>
      ) : (
        <form onSubmit={submit} className="bg-panel border-t border-line px-2.5 py-1.5 space-y-1.5">
          {podeNota && <AbasDoEnvio nota={false} onNota={setModoNota} />}
          {rapida && <QuickReplyCountdown pending={rapida} onCancel={() => setRapida(null)} onEdit={editarRapida} />}
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
                <div className="text-[11px] font-semibold text-accent-ink">{respondendo.direction === 'out' ? 'Respondendo a você' : `Respondendo a ${nomeContato}`}</div>
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
                onChange={(e) => { setText(e.target.value); presenca.digitou(e.target.value); }}
                onBlur={presenca.parar}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
                onPaste={colar}
                rows={1}
                placeholder={attachment ? 'Legenda (opcional)' : 'Mensagem… (Enter envia)'}
                className="flex-1 resize-none min-h-[38px] max-h-40 overflow-y-hidden scrollbar-thin rounded-xl bg-field text-ink placeholder:text-faint px-3.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/40"
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
              texto={text}
              onAgendado={() => setText('')}
            />
          )}
        </form>
      )}
    </>
  );
}

/**
 * Abas logo acima do campo: "Mensagem para o cliente" | "Nota interna". Antes a nota era um
 * ícone perdido na barra de atalhos e pouca gente achava — a aba deixa o modo sempre à vista.
 */
function AbasDoEnvio({ nota, onNota }: { nota: boolean; onNota: (v: boolean) => void }) {
  const aba = (ativa: boolean, cor: string) => cn(
    'inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1 text-[12px] font-semibold transition-colors',
    ativa ? cor : 'border-transparent text-muted hover:text-ink',
  );
  return (
    <div role="tablist" className="flex items-end gap-1 border-b border-line/70">
      <button type="button" role="tab" aria-selected={!nota} onClick={() => onNota(false)} className={aba(!nota, 'border-accent text-accent-ink')}>
        <Send size={12} /> Mensagem para o cliente
      </button>
      <button type="button" role="tab" aria-selected={nota} onClick={() => onNota(true)} title="Só a equipe vê — nunca vai para o WhatsApp (Alt+N)" className={aba(nota, 'border-warn bg-warn/15 text-warn-ink')}>
        <StickyNote size={12} /> Nota interna <Lock size={11} className={nota ? '' : 'text-faint'} />
      </button>
      {nota && <span className="ml-auto pb-1 text-[11px] text-warn-ink/80 hidden sm:inline whitespace-nowrap">🔒 Visível só para a equipe · Alt+N alterna · Esc sai</span>}
    </div>
  );
}

/**
 * Assinatura do atendente (`*Nome:*` na 1ª linha, formato do WhatsApp): no painel mostra só
 * "Nome:" em negrito, sem os asteriscos.
 */
const ASSINATURA = /^\*([^*\n]{1,80}?):?\*\n/;
function TextoAssinado({ texto }: { texto: string }) {
  const m = ASSINATURA.exec(texto);
  if (!m) return <>{texto}</>;
  return <><span className="font-bold">{m[1].trim()}:</span>{'\n'}{texto.slice(m[0].length)}</>;
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

function Bubble({ m, canResend, onVerMidia, onResponder, onEncaminhar, onApagar, onEditar, podeVerApagada, citada, contato }: { m: Message; canResend: boolean; onVerMidia?: (url: string) => void; onResponder?: (m: Message) => void; onEncaminhar?: (m: Message) => void; onApagar?: (m: Message) => void; onEditar?: (m: Message) => void; podeVerApagada: boolean; citada?: Message; contato: string }) {
  const out = m.direction === 'out';
  const resend = useResend();
  const estruturado = structuredBody(m);
  if (m.deletedAt) return <MensagemApagada m={m} podeVer={podeVerApagada} />;
  if (m.internal) {
    // `author` some se o usuário for removido; `authorName` é o nome gravado na nota.
    // Sem nenhum dos dois = aviso do sistema (fluxo, agenda).
    const autor = m.author?.name ?? m.authorName;
    return (
      <div className="flex justify-center my-1.5">
        <div className="max-w-[80%] min-w-[220px] rounded-lg border border-dashed border-warn/70 bg-warn-soft px-3 py-2 text-[13px] shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] text-warn-ink mb-1">
            <StickyNote size={12} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate">{autor ? <>Nota interna adicionada por <b>{autor}</b></> : <b>Aviso automático do sistema</b>}</span>
            <span className="tnum font-mono text-[10px] text-warn-ink/70">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            {onApagar && <button type="button" onClick={() => onApagar(m)} title="Apagar nota" aria-label="Apagar nota" className="text-warn-ink/70 hover:text-danger p-0.5"><Trash2 size={12} /></button>}
          </div>
          <p className="whitespace-pre-wrap break-words text-ink">{m.text}</p>
          <div className="flex items-center gap-1 text-[10px] text-warn-ink/70 mt-1"><Lock size={10} /> Visível apenas para a equipe</div>
        </div>
      </div>
    );
  }
  return (
    <div id={`msg-${m.id}`} className={cn('group flex items-center gap-1 rounded-lg transition-colors duration-700', out ? 'justify-end' : 'justify-start')}>
      {out && <AcoesDaBolha m={m} out onResponder={onResponder} onEncaminhar={onEncaminhar} onApagar={onApagar} onEditar={onEditar} podeReagir={canResend} />}
      <div className={cn('relative max-w-[72%] px-2.5 py-1.5 text-[13px]', m.reactions?.length && 'mb-3', out ? 'bub-out text-chat-out-ink rounded-2xl rounded-br-md' : 'bub-in bg-chat-in text-chat-in-ink rounded-2xl rounded-bl-md')}>
        {m.forwarded && <ForwardedLabel score={m.forwardingScore} />}
        <Citacao m={m} citada={citada} contato={contato} onVerMidia={onVerMidia} />
        {estruturado ?? (
          <>
            <MediaBody m={m} onVerMidia={onVerMidia} />
            {m.text && <p className="whitespace-pre-wrap break-words">{out ? <TextoAssinado texto={m.text} /> : m.text}</p>}
          </>
        )}
        <div className={cn('flex items-center justify-end gap-1 mt-0.5 text-[10px] tnum font-mono', out ? 'text-chat-out-ink/75' : 'text-faint')}>
          {m.editedAt && <span className="italic font-sans" title={`Editada em ${new Date(m.editedAt).toLocaleString('pt-BR')}`}>editada</span>}
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
      {!out && <AcoesDaBolha m={m} out={false} onResponder={onResponder} onEncaminhar={onEncaminhar} onApagar={onApagar} podeReagir={canResend} />}
    </div>
  );
}

/**
 * O que fica no lugar da mensagem apagada: ela não some sem rastro (docs/apagar-mensagens.md).
 * A API já manda sem conteúdo; quem tem `conversations.view_deleted` pode abrir o original.
 */
function MensagemApagada({ m, podeVer }: { m: Message; podeVer: boolean }) {
  const [vendo, setVendo] = useState(false);
  const original = useDeletedOriginal(m, podeVer && vendo);
  const quando = new Date(m.deletedAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lado = m.internal ? 'justify-center' : m.direction === 'out' ? 'justify-end' : 'justify-start';
  const o = original.data;
  return (
    <div id={`msg-${m.id}`} className={cn('flex my-0.5', lado)}>
      <div className="max-w-[72%] rounded-2xl border border-dashed border-line bg-panel/70 px-2.5 py-1.5 text-[12px] text-muted italic">
        <div className="flex items-center gap-1.5">
          <Ban size={12} className="shrink-0" />
          <span className="flex-1 min-w-0">
            {m.internal ? 'Nota apagada' : 'Mensagem apagada'} por <b className="not-italic">{m.deletedByName ?? 'usuário removido'}</b> em <span className="tnum not-italic">{quando}</span>
            {m.deletedForEveryone && ' · também no WhatsApp do contato'}
          </span>
          {podeVer && (
            <button type="button" onClick={() => setVendo((v) => !v)} title={vendo ? 'Esconder o original' : 'Ver o conteúdo original (auditoria)'} aria-label={vendo ? 'Esconder o original' : 'Ver o original'} className="not-italic text-faint hover:text-ink p-0.5">
              {vendo ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          )}
        </div>
        {vendo && (
          <div className="mt-1.5 not-italic text-ink border-t border-line pt-1.5">
            {original.isLoading && <span className="text-muted">Carregando…</span>}
            {original.error && <span className="text-danger">{original.error instanceof Error ? original.error.message : 'Não foi possível carregar o original'}</span>}
            {o && (
              <>
                {o.mediaUrl && (o.type === 'image' || o.type === 'sticker'
                  ? <img src={o.mediaUrl} alt="" className="rounded-md max-h-48 max-w-full object-contain mb-1" />
                  : <a href={o.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-accent hover:underline mb-1"><FileText size={13} /> {o.mediaName ?? labelOf(o.type)}</a>)}
                <p className="whitespace-pre-wrap break-words">{messagePreview({ type: o.type, text: o.text, content: o.content, mediaName: o.mediaName })}</p>
              </>
            )}
          </div>
        )}
      </div>
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
 * Apagar é a exceção: pendente (cancela o envio) e com falha também saem do histórico.
 */
function AcoesDaBolha({ m, out, onResponder, onEncaminhar, onApagar, onEditar, podeReagir }: { m: Message; out: boolean; onResponder?: (m: Message) => void; onEncaminhar?: (m: Message) => void; onApagar?: (m: Message) => void; onEditar?: (m: Message) => void; podeReagir: boolean }) {
  const apagar = onApagar && <BotaoAcao titulo="Apagar" onClick={() => onApagar(m)}><Trash2 size={14} /></BotaoAcao>;
  // editar vale também na fila (sem `externalId`): o texto novo é o que sai
  const editar = onEditar && <BotaoAcao titulo="Editar" onClick={() => onEditar(m)}><Pencil size={14} /></BotaoAcao>;
  if (!m.externalId) return apagar || editar ? <div className="flex items-center shrink-0">{apagar}{editar}</div> : null;
  const reagir = podeReagir && m.status !== 'pending' && m.status !== 'failed' && <BotaoReagir m={m} out={out} />;
  const responder = onResponder && <BotaoResponder m={m} onResponder={onResponder} />;
  // figurinha não sai pelos providers; o resto vira envio normal (mídia, texto ou link)
  const encaminhar = onEncaminhar && m.type !== 'sticker' && <BotaoAcao titulo="Encaminhar" onClick={() => onEncaminhar(m)}><Forward size={14} /></BotaoAcao>;
  return <div className="flex items-center shrink-0">{out ? <>{apagar}{editar}{encaminhar}{reagir}{responder}</> : <>{responder}{reagir}{encaminhar}{apagar}</>}</div>;
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
 * texto guardado sobraria "quero esse" sem ninguém saber o quê. Pelo mesmo motivo a foto/vídeo
 * do status vem guardada (`quoted.mediaUrl`) e abre no visualizador.
 */
function Citacao({ m, citada, contato, onVerMidia }: { m: Message; citada?: Message; contato: string; onVerMidia?: (url: string) => void }) {
  const q = m.quoted;
  if (!q && !m.quotedId && !m.quotedPreview) return null;
  const texto = q?.preview || (citada ? resumoDaMensagem(citada) : m.quotedPreview) || 'Mensagem';
  const fromStatus = q?.fromStatus ?? m.quotedFromStatus;
  const direcao = q?.direction ?? citada?.direction;
  const autor = fromStatus ? contato : q?.authorName ?? (direcao === 'out' ? 'Você' : direcao === 'in' ? contato : 'Mensagem citada');
  const alvo = q?.messageId ?? citada?.id;
  const conteudo = (
    <>
      <div className="text-[10.5px] font-semibold opacity-80">{autor}</div>
      <div className="text-[11.5px] opacity-80 line-clamp-2 break-words">{texto}</div>
    </>
  );
  const caixa = 'mb-1 block w-full text-left rounded-md border-l-[3px] border-accent bg-black/5 dark:bg-white/10 px-2 py-1';
  if (fromStatus) {
    const midia = q?.mediaUrl;
    // tipo sem URL: o worker ainda está baixando o status
    const baixando = !midia && !!q?.mediaType;
    return (
      <div className="mb-1">
        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
          <CircleDashed size={11} /> Respondido do seu Stories
        </div>
        {/* com mídia, o bloco inteiro abre o status no visualizador */}
        <button type="button" disabled={!midia} onClick={() => midia && onVerMidia?.(midia)} title={midia ? 'Ver o status' : undefined} className={cn(caixa, 'mb-0 flex items-center gap-2', midia && 'hover:bg-black/10 dark:hover:bg-white/15 cursor-zoom-in')}>
          <div className="min-w-0 flex-1">{conteudo}</div>
          {baixando && (
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded bg-black/10 dark:bg-white/10" title="Carregando o status…">
              <Loader2 size={16} className="animate-spin opacity-60" />
            </div>
          )}
          {midia && (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-black/10 dark:bg-white/10">
              {/* atrás da imagem: aparece enquanto o navegador baixa e some quando ela cobre */}
              <Loader2 size={16} className="absolute inset-0 m-auto animate-spin opacity-60" />
              {q?.mediaType === 'video'
                ? <><video src={midia} muted preload="metadata" className="relative h-14 w-14 object-cover" /><Play size={16} className="absolute inset-0 m-auto text-white drop-shadow" /></>
                : <img src={midia} alt="Status respondido" className="relative h-14 w-14 object-cover" />}
            </div>
          )}
        </button>
      </div>
    );
  }
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
function MediaBody({ m, onVerMidia }: { m: Message; onVerMidia?: (url: string) => void }) {
  // só mídia: localização, contato, botões e afins são desenhados por `structuredBody`
  if (!['image', 'audio', 'video', 'document', 'sticker'].includes(m.type)) return null;
  if (!m.mediaUrl) return <span className="italic text-muted text-xs">[{labelOf(m.type)}{m.error ? ' · indisponível' : m.status === 'pending' ? '' : ' · carregando…'}]</span>;
  // abre por cima, não em aba nova: abrir fora tirava o atendente da conversa
  if (m.type === 'image' || m.type === 'sticker') {
    return <img src={m.mediaUrl} alt="" onClick={() => onVerMidia?.(m.mediaUrl!)} className="rounded-md max-h-72 max-w-full object-contain mb-1 cursor-zoom-in" />;
  }
  if (m.type === 'audio') return <AudioMessage src={m.mediaUrl} mine={m.direction === 'out'} />;
  if (m.type === 'video') {
    // o play continua na bolha (clique no vídeo é do player); o botão abre em tela cheia
    return (
      <div className="relative group/video mb-1 w-fit max-w-full">
        <video controls preload="metadata" src={m.mediaUrl} className="rounded-md max-h-72 max-w-full block" />
        {onVerMidia && (
          <button
            type="button"
            onClick={(e) => { e.currentTarget.parentElement?.querySelector('video')?.pause(); onVerMidia(m.mediaUrl!); }}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/55 text-white opacity-80 group-hover/video:opacity-100 hover:bg-black/75"
            title="Abrir em tela cheia"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
    );
  }
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

/**
 * Editar a própria mensagem. A assinatura do atendente (`*Nome:*` na 1ª linha) fica de fora do
 * campo e volta igual no envio — editar não pode "desassinar" a mensagem.
 */
function EditMessageModal({ m, onClose }: { m: Message; onClose: () => void }) {
  const assinatura = ASSINATURA.exec(m.text ?? '')?.[0] ?? '';
  const [texto, setTexto] = useState((m.text ?? '').slice(assinatura.length));
  const editar = useEditMessage();
  const mudou = texto.trim() && assinatura + texto.trim() !== m.text;
  async function salvar() {
    try {
      await editar.mutateAsync({ conversationId: m.conversationId, messageId: m.id, text: assinatura + texto.trim() });
      toast.ok(m.status === 'pending' ? 'Mensagem editada antes de sair' : 'Mensagem editada também no WhatsApp do contato');
      onClose();
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title="Editar mensagem">
      <div className="space-y-3">
        <textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (mudou) void salvar(); } }}
          rows={4}
          maxLength={4096}
          className={cn(inputCls, 'resize-none')}
        />
        <p className="text-xs text-faint">O WhatsApp aceita editar até 15 minutos depois do envio. O contato vê o texto novo marcado como editado, e o anterior fica no histórico do atendimento.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={!mudou} loading={editar.isPending} loadingText="Salvando…">Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
