'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, QrCode, UserPlus, BookUser, Loader2 } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PhoneInput, formatPhone } from '@/components/ui/PhoneInput';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useDebounced, useHasFeature, useNumbers, usePhonebook, useStartCandidates, useStartConversation, useColdQuota, type PhonebookItem, type StartCandidates } from '@/lib/hooks';
import { TemplateFields, useTemplateChoice } from './TemplateFields';

type ContatoSel = { id: string; name: string | null; phone: string };
const SEM_RESULTADOS: StartCandidates = { contacts: [], phonebook: [] };

/**
 * Iniciar conversa (disparo ativo). Contato da base ou telefone novo, número de saída e a
 * mensagem: na API oficial é template aprovado (texto livre só se o contato escreveu nas
 * últimas 24h); na Evolution, texto livre. Enviou → abre a conversa.
 */
export function NewConversationModal({ onClose }: { onClose: () => void }) {
  const { numberId: filtroNumero, setStatus, setConversation } = useUI();
  const numbers = useNumbers();
  const conectados = useMemo(() => (numbers.data ?? []).filter((n) => n.isActive && n.status === 'connected'), [numbers.data]);
  const [numberId, setNumberId] = useState<string>('');
  const number = conectados.find((n) => n.id === numberId);
  const isMeta = number?.provider === 'meta';
  const cotaFria = useColdQuota(number?.id, !!number && !isMeta);
  // envio frio (docs/envio.md#envio-frio): no oficial, template + recurso no plano; no QR, até 10 contatos frios por dia
  const proativo = useHasFeature('proactive_messaging');

  const [contato, setContato] = useState<ContatoSel | null>(null);
  const [busca, setBusca] = useState('');
  const [novoTelefone, setNovoTelefone] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');
  // agenda do celular aberta: o campo de busca passa a filtrar a lista dela
  const [agendaAberta, setAgendaAberta] = useState(false);

  const [modo, setModo] = useState<'template' | 'texto'>('template');
  const [texto, setTexto] = useState('');
  const choice = useTemplateChoice(numberId || null, isMeta);
  // uma chave por abertura do modal: clique duplo não manda duas vezes
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const start = useStartConversation();

  // número padrão: o do filtro da lista, se estiver conectado; senão o primeiro conectado
  useEffect(() => {
    if (numberId || !conectados.length) return;
    setNumberId(conectados.find((n) => n.id === filtroNumero)?.id ?? conectados[0].id);
  }, [conectados, filtroNumero, numberId]);
  useEffect(() => { setModo('template'); }, [numberId]);
  // a agenda é do aparelho: número oficial não tem
  useEffect(() => { if (isMeta) setAgendaAberta(false); }, [isMeta]);

  // busca no servidor (sem acento, palavras em qualquer ordem, telefone com ou sem máscara),
  // 300ms depois da última tecla. Fechada a agenda: contatos da base + agenda do aparelho
  // (quem ainda não é contato). Aberta: o mesmo campo filtra a agenda inteira, paginada.
  const termo = busca.trim();
  const termoAtrasado = useDebounced(termo, 300);
  const escolhendo = !contato && !novoTelefone;
  const candidatos = useStartCandidates(termoAtrasado, escolhendo && !agendaAberta);
  const agenda = usePhonebook(number?.id ?? null, termoAtrasado, escolhendo && agendaAberta && !isMeta);
  const resultados = escolhendo && !agendaAberta && termo.length >= 2 && candidatos.data ? candidatos.data : SEM_RESULTADOS;
  // spinner no campo: digitou e o atraso não venceu, ou a requisição está no ar
  const buscando = escolhendo && (agendaAberta
    ? termo !== termoAtrasado || (agenda.isFetching && !agenda.isFetchingNextPage)
    : termo.length >= 2 && (termo !== termoAtrasado || candidatos.isFetching));

  const digitos = busca.replace(/\D/g, '');
  const soNumeros = /^[\d\s()+-]+$/.test(busca.trim());
  // número avulso, fora da agenda: com DDD (10–11 dígitos, assume 55) ou já com DDI (até 15, E.164)
  const pareceTelefone = soNumeros && digitos.length >= 10 && digitos.length <= 15;
  const telefoneDigitado = digitos.length <= 11 ? `55${digitos}` : digitos;
  const telefoneIncompleto = soNumeros && digitos.length > 0 && !pareceTelefone;
  const usandoTemplate = isMeta && modo === 'template';
  const destinoOk = !!contato || (!!novoTelefone && novoTelefone.length >= 12);
  const mensagemOk = usandoTemplate ? choice.valid : !!texto.trim();
  const podeEnviar = !!number && destinoOk && mensagemOk;

  async function enviar() {
    if (!number) return;
    try {
      const r = await start.mutateAsync({
        numberId: number.id,
        ...(contato ? { contactId: contato.id } : { phone: novoTelefone!, name: novoNome.trim() || undefined }),
        ...(usandoTemplate && choice.value ? { template: choice.value } : { text: texto }),
        idempotencyKey,
      });
      toast.ok('Mensagem enviada');
      setStatus('in_progress');
      setConversation(r.conversationId);
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Nova conversa">
      <div className="space-y-4">
        <Field label="Contato">
          {contato || novoTelefone ? (
            <div className="flex items-center justify-between rounded-lg bg-field px-3 py-2 text-sm">
              <span className="text-ink truncate">
                {contato ? <>{contato.name ?? '—'} <span className="text-muted tnum">{formatPhone(contato.phone)}</span></> : <>Novo contato <span className="text-muted tnum">{formatPhone(novoTelefone!)}</span></>}
              </span>
              <button type="button" className="text-xs text-accent-ink shrink-0" onClick={() => { setContato(null); setNovoTelefone(null); setNovoNome(''); setBusca(''); }}>trocar</button>
            </div>
          ) : (
            <div className="relative">
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                // Enter num telefone válido já escolhe o número avulso — não precisa achar o item na lista
                onKeyDown={(e) => { if (e.key === 'Enter' && !agendaAberta && pareceTelefone) { e.preventDefault(); setNovoTelefone(telefoneDigitado); } }}
                placeholder={agendaAberta ? 'Filtrar a agenda por nome ou telefone' : 'Buscar por nome ou digitar o telefone (ex.: 5562999999999)'}
                className={cn(inputCls, 'pr-8')}
              />
              {buscando && <Loader2 size={14} aria-label="Buscando" className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint pointer-events-none" />}
              {!agendaAberta && (resultados.contacts.length > 0 || resultados.phonebook.length > 0 || pareceTelefone) && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-line bg-panel shadow-lg py-1 max-h-64 overflow-y-auto">
                  {resultados.contacts.map((r) => (
                    <button key={r.id} type="button" onClick={() => setContato(r)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-field">
                      <span className="text-ink">{r.name ?? '—'}</span> <span className="text-muted tnum">{formatPhone(r.phone)}</span>
                    </button>
                  ))}
                  {resultados.phonebook.length > 0 && <div className="px-3 pt-1.5 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Agenda do celular</div>}
                  {resultados.phonebook.map((r) => (
                    <button key={r.phone} type="button" onClick={() => { setNovoTelefone(r.phone); setNovoNome(r.name); if (conectados.some((n) => n.id === r.numberId)) setNumberId(r.numberId); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-field">
                      <BookUser size={14} className="text-faint shrink-0" /><span className="text-ink">{r.name}</span> <span className="text-muted tnum">{formatPhone(r.phone)}</span>
                    </button>
                  ))}
                  {pareceTelefone && (
                    <button type="button" onClick={() => setNovoTelefone(telefoneDigitado)} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-field text-accent-ink">
                      <UserPlus size={14} /> Iniciar com {formatPhone(telefoneDigitado)} <span className="ml-auto text-[10.5px] text-faint">Enter</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!contato && !novoTelefone && !agendaAberta && telefoneIncompleto && (
            <p className="mt-1 text-[11.5px] text-warn-ink">{digitos.length > 15 ? 'Número longo demais.' : 'Digite DDD + número, ou DDI + DDD + número (ex.: 5562999999999).'}</p>
          )}
          {!contato && !novoTelefone && number && !isMeta && (
            <button type="button" onClick={() => setAgendaAberta((v) => !v)} className={cn('mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium', agendaAberta ? 'text-ink' : 'text-accent-ink hover:underline')}>
              <BookUser size={13} /> {agendaAberta ? 'Fechar agenda do celular' : `Ver agenda do celular (${number.label})`}
            </button>
          )}
          {agendaAberta && !contato && !novoTelefone && number && (
            <AgendaDoCelular
              agenda={agenda}
              filtrando={!!termoAtrasado}
              onPick={(r) => {
                if (r.contactId) setContato({ id: r.contactId, name: r.name, phone: r.phone });
                else { setNovoTelefone(r.phone); setNovoNome(r.name); }
                setAgendaAberta(false);
              }}
            />
          )}
        </Field>
        {novoTelefone && !contato && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Telefone"><PhoneInput value={novoTelefone} onChange={setNovoTelefone} /></Field>
            <Field label="Nome (opcional)"><input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={80} className={inputCls} /></Field>
          </div>
        )}

        <Field label="Enviar pelo número" hint={!numbers.isLoading && !conectados.length ? 'Nenhum número conectado. Conecte um em Números.' : undefined}>
          <div className="relative">
            <select value={numberId} onChange={(e) => setNumberId(e.target.value)} className={cn(inputCls, 'pr-20')}>
              {conectados.map((n) => <option key={n.id} value={n.id}>{n.label} · {n.phone.slice(-4)}</option>)}
            </select>
            {number && (
              <span className={cn('absolute right-8 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 pointer-events-none', isMeta ? 'bg-meta-soft text-meta-ink' : 'bg-evo-soft text-evo-ink')}>
                {isMeta ? <ShieldCheck size={10} /> : <QrCode size={10} />}{isMeta ? 'Meta' : 'QR'}
              </span>
            )}
          </div>
        </Field>

        {isMeta && (
          <div className="grid grid-cols-2 rounded-lg bg-field p-1 text-xs font-semibold">
            {(['template', 'texto'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setModo(m)} className={cn('rounded-md py-1', modo === m ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {m === 'template' ? 'Template aprovado' : 'Texto livre (janela de 24h)'}
              </button>
            ))}
          </div>
        )}

        {number && !isMeta && (
          <p className={cn('rounded-lg px-3 py-2 text-[12.5px]', cotaFria.data && cotaFria.data.used >= cotaFria.data.max ? 'bg-warn-soft text-warn-ink' : 'bg-field text-muted')}>
            Pela <b>Conexão Web (QR Code)</b>, falar primeiro com quem <b>não escreveu neste número nas últimas 24 horas</b> é a principal causa de bloqueio.
            Por isso cada número pode chamar até <b>{cotaFria.data?.max ?? 10} contatos assim por dia</b>
            {cotaFria.data && (cotaFria.data.used >= cotaFria.data.max
              ? <> — o limite de hoje foi atingido{cotaFria.data.resetsAt ? <>; uma vaga libera em <b>{new Date(cotaFria.data.resetsAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b></> : null}</>
              : <> — restam <b>{cotaFria.data.max - cotaFria.data.used}</b></>)}.
            {' '}Quem escreveu nas últimas 24 horas não conta. Para chamar muitos contatos, use um número Meta Cloud API.
          </p>
        )}
        {usandoTemplate && !proativo.loading && !proativo.has && (
          <p className="rounded-lg bg-warn-soft text-warn-ink px-3 py-2 text-[12.5px]">
            Iniciar conversa com quem não escreveu nas últimas 24h depende do recurso <b>Mensagem ativa (Meta Cloud API)</b>, que não está no seu plano.
          </p>
        )}

        {usandoTemplate ? (
          <TemplateFields choice={choice} />
        ) : (
          <Field label="Mensagem" hint={isMeta ? 'Só é entregue se o contato escreveu para este número nas últimas 24h.' : 'Aceita variáveis como {{contact.first_name}}.'}>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} maxLength={4096} className={cn(inputCls, 'resize-none')} />
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={enviar} disabled={!podeEnviar} loading={start.isPending} loadingText="Enviando…">Enviar e abrir conversa</Button>
        </div>
      </div>
    </Modal>
  );
}

/** altura fixa da linha da agenda: é o que permite virtualizar sem medir cada uma */
const LINHA = 32;
/** altura visível da lista (max-h-72) */
const JANELA = 288;
/** linhas extras desenhadas acima/abaixo para a rolagem rápida não mostrar buraco */
const FOLGA = 8;

/**
 * Agenda do celular do número, inteira e em ordem alfabética — para quem não lembra o nome
 * exato. O campo de busca do modal filtra (no servidor, com debounce); a lista carrega de 50
 * em 50 conforme rola e só desenha as linhas visíveis, então agenda de 10 mil nomes não pesa.
 * Quem já é contato vem marcado e abre o contato existente.
 */
function AgendaDoCelular({ agenda, filtrando, onPick }: { agenda: ReturnType<typeof usePhonebook>; filtrando: boolean; onPick: (r: PhonebookItem) => void }) {
  const itens = useMemo(() => agenda.data?.pages.flatMap((p) => p.items) ?? [], [agenda.data]);
  const total = agenda.data?.pages[0]?.total;
  const [topo, setTopo] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  // resultado novo (outro filtro): volta ao topo. A 1ª página mantém a referência quando só
  // chega a próxima página, então rolar e carregar mais não dispara isto
  const primeiraPagina = agenda.data?.pages[0];
  useEffect(() => { if (lista.current) lista.current.scrollTop = 0; setTopo(0); }, [primeiraPagina]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = agenda;
  const primeira = Math.max(0, Math.floor(topo / LINHA) - FOLGA);
  const ultima = Math.min(itens.length, Math.ceil((topo + JANELA) / LINHA) + FOLGA);

  function rolou(el: HTMLDivElement) {
    setTopo(el.scrollTop);
    // faltando ~10 linhas para o fim, já pede a próxima página
    if (hasNextPage && !isFetchingNextPage && el.scrollTop + el.clientHeight >= el.scrollHeight - LINHA * 10) fetchNextPage();
  }

  return (
    <div className="mt-2 rounded-lg border border-line">
      <div className="px-3 py-1.5 border-b border-line text-[11px] text-faint flex justify-between">
        <span>{filtrando ? 'Resultado na agenda' : 'Agenda do celular'}</span>
        {total !== undefined && <span className="tnum">{total} contato{total === 1 ? '' : 's'}</span>}
      </div>
      {agenda.isLoading && <p className="px-3 py-2 text-sm text-muted">Carregando agenda…</p>}
      {agenda.isError && <p className="px-3 py-2 text-sm text-danger-ink">Não foi possível carregar a agenda.</p>}
      {!agenda.isLoading && !agenda.isError && !itens.length && (
        <p className="px-3 py-2 text-sm text-muted">{filtrando ? 'Ninguém na agenda com esse nome ou telefone.' : 'Agenda vazia. Em Números, use "Sincronizar agenda".'}</p>
      )}
      {itens.length > 0 && (
        <div ref={lista} className="max-h-72 overflow-y-auto" onScroll={(e) => rolou(e.currentTarget)}>
          <ul className="relative" style={{ height: itens.length * LINHA }}>
            {itens.slice(primeira, ultima).map((r, i) => (
              <li key={r.id} className="absolute inset-x-0" style={{ top: (primeira + i) * LINHA, height: LINHA }}>
                <button type="button" onClick={() => onPick(r)} className="w-full h-full flex items-center gap-2 text-left px-3 text-sm hover:bg-field">
                  <span className="text-ink truncate">{r.name}</span>
                  <span className="text-muted tnum shrink-0">{formatPhone(r.phone)}</span>
                  {r.contactId && <span className="ml-auto shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-accent-soft text-accent-ink">já é contato</span>}
                </button>
              </li>
            ))}
          </ul>
          {isFetchingNextPage && <p className="px-3 py-1.5 text-xs text-muted">Carregando…</p>}
        </div>
      )}
    </div>
  );
}
