'use client';
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, QrCode, UserPlus, BookUser } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PhoneInput, formatPhone } from '@/components/ui/PhoneInput';
import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { useNumbers, useStartConversation } from '@/lib/hooks';
import { TemplateFields, useTemplateChoice } from './TemplateFields';

type ContatoSel = { id: string; name: string | null; phone: string };
/** nome da agenda do aparelho (Evolution) que ainda não é contato */
type AgendaSel = { phone: string; name: string; numberId: string };

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

  const [contato, setContato] = useState<ContatoSel | null>(null);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<{ contacts: ContatoSel[]; phonebook: AgendaSel[] }>({ contacts: [], phonebook: [] });
  const [novoTelefone, setNovoTelefone] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');

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

  // busca: contatos da base e a agenda do aparelho sincronizada (quem ainda não é contato)
  useEffect(() => {
    if (contato || busca.trim().length < 2) { setResultados({ contacts: [], phonebook: [] }); return; }
    const t = setTimeout(async () => {
      try { setResultados(await api<{ contacts: ContatoSel[]; phonebook: AgendaSel[] }>(`/conversations/start/contacts?q=${encodeURIComponent(busca.trim())}`)); }
      catch { setResultados({ contacts: [], phonebook: [] }); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, contato]);

  const digitos = busca.replace(/\D/g, '');
  const pareceTelefone = digitos.length >= 10 && /^[\d\s()+-]+$/.test(busca.trim());
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
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou digitar o telefone" className={inputCls} />
              {(resultados.contacts.length > 0 || resultados.phonebook.length > 0 || pareceTelefone) && (
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
                    <button type="button" onClick={() => setNovoTelefone(digitos.length <= 11 ? `55${digitos}` : digitos)} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-field text-accent-ink">
                      <UserPlus size={14} /> Iniciar com {formatPhone(digitos.length <= 11 ? `55${digitos}` : digitos)}
                    </button>
                  )}
                </div>
              )}
            </div>
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
                {isMeta ? <ShieldCheck size={10} /> : <QrCode size={10} />}{isMeta ? 'Oficial' : 'QR'}
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
