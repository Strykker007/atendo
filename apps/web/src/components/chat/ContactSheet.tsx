'use client';
import { useEffect, useState } from 'react';
import { UserRound, Mail, MapPin, StickyNote, X, Plus, Trash2 } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  useCan, useUpdateContact, useContactAttributes, useContactAttributeLabels, useSetContactAttributes,
  type Conversation, type ContactAttribute, type ContactAttributeType,
} from '@/lib/hooks';

const TIPOS: Record<ContactAttributeType, string> = { text: 'Texto', number: 'Número', date: 'Data' };

type Contato = Conversation['contact'];

/** Ficha do contato: o que o atendente precisa saber sem perguntar de novo a cada conversa. */
export function ContactSheet({ contact, onClose }: { contact: Contato; onClose: () => void }) {
  const update = useUpdateContact();
  // campos livres deste contato: cada cliente tem os dados que fazem sentido para ele
  const atributos = useContactAttributes(contact.id);
  const sugestoes = useContactAttributeLabels();
  const salvarAtributos = useSetContactAttributes();
  const [extras, setExtras] = useState<ContactAttribute[]>([]);
  useEffect(() => { if (atributos.data) setExtras(atributos.data); }, [atributos.data]);
  const mudarExtra = (i: number, patch: Partial<ContactAttribute>) => setExtras((l) => l.map((a, n) => (n === i ? { ...a, ...patch } : a)));
  /** escolher um nome já usado em outro cliente traz o tipo junto */
  const mudarNome = (i: number, label: string) => {
    const conhecido = sugestoes.data?.find((s) => s.label.toLowerCase() === label.trim().toLowerCase());
    mudarExtra(i, conhecido ? { label, type: conhecido.type } : { label });
  };
  // a API recusa sem `contacts.edit`; sem isto a tela deixava preencher e só avisava no salvar
  const podeEditar = useCan('contacts.edit');
  const [form, setForm] = useState({
    name: contact.name ?? '',
    email: contact.email ?? '',
    address: contact.address ?? '',
    note1: contact.note1 ?? '',
    note2: contact.note2 ?? '',
  });
  useEffect(() => {
    setForm({ name: contact.name ?? '', email: contact.email ?? '', address: contact.address ?? '', note1: contact.note1 ?? '', note2: contact.note2 ?? '' });
  }, [contact]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    // sem a lista carregada, salvar (que substitui tudo) apagaria os campos que o contato já tem
    if (!atributos.data) { toast.err('Aguarde os campos da ficha carregarem'); return; }
    try {
      // campos livres primeiro: é aí que a API recusa (sem nome, data inválida, repetido…)
      await salvarAtributos.mutateAsync({ contactId: contact.id, items: extras });
      await update.mutateAsync({ contactId: contact.id, ...form });
      toast.ok('Ficha salva');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Ficha do contato">
      <form onSubmit={salvar} className="space-y-3">
        <div className="text-[12px] text-muted tnum">+{contact.phone}</div>
        <Field label="Nome"><input readOnly={!podeEditar} className={inputCls} value={form.name} onChange={set('name')} maxLength={80} placeholder="Como o cliente se chama" /></Field>
        <Field label="E-mail"><input readOnly={!podeEditar} className={inputCls} type="email" value={form.email} onChange={set('email')} maxLength={160} placeholder="para orçamento, nota fiscal…" /></Field>
        <Field label="Endereço"><input readOnly={!podeEditar} className={inputCls} value={form.address} onChange={set('address')} maxLength={300} placeholder="Rua, número, bairro, cidade" /></Field>
        <Field label="Observação 1"><textarea readOnly={!podeEditar} className={inputCls} rows={2} value={form.note1} onChange={set('note1')} maxLength={1000} placeholder="Preferências, histórico, o que evitar…" /></Field>
        <Field label="Observação 2"><textarea readOnly={!podeEditar} className={inputCls} rows={2} value={form.note2} onChange={set('note2')} maxLength={1000} /></Field>
        <div className="space-y-2 border-t border-line pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Outras informações deste cliente</div>
          {extras.length === 0 && !atributos.isLoading && (
            <p className="text-[11.5px] text-muted">Nenhum campo extra. Adicione o que for útil para este cliente: CPF, placa do carro, plano, aniversário…</p>
          )}
          {extras.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <input
                readOnly={!podeEditar} className={cn(inputCls, 'w-[38%]')} value={a.label} maxLength={60} placeholder="Nome do campo"
                list="sugestoes-campos" onChange={(e) => mudarNome(i, e.target.value)} aria-label="Nome do campo"
              />
              <select disabled={!podeEditar} className={cn(inputCls, 'w-[88px] shrink-0 px-2')} value={a.type} onChange={(e) => mudarExtra(i, { type: e.target.value as ContactAttributeType, value: '' })} aria-label="Tipo">
                {(Object.keys(TIPOS) as ContactAttributeType[]).map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}
              </select>
              <input
                readOnly={!podeEditar} className={cn(inputCls, 'flex-1 min-w-0')} value={a.value} maxLength={1000} placeholder="Valor"
                type={a.type === 'number' ? 'number' : a.type === 'date' ? 'date' : 'text'} step={a.type === 'number' ? 'any' : undefined}
                onChange={(e) => mudarExtra(i, { value: e.target.value })} aria-label={`Valor de ${a.label || 'campo'}`}
              />
              {podeEditar && (
                <button type="button" onClick={() => setExtras((l) => l.filter((_, n) => n !== i))} className="mt-1.5 p-1.5 rounded-md text-faint hover:text-danger hover:bg-field shrink-0" title="Remover campo">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          <datalist id="sugestoes-campos">
            {(sugestoes.data ?? []).map((s) => <option key={`${s.label}-${s.type}`} value={s.label} />)}
          </datalist>
          {podeEditar && (
            <button
              type="button" disabled={!atributos.data || extras.length >= 50}
              onClick={() => setExtras((l) => [...l, { label: '', type: 'text', value: '' }])}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-50"
            >
              <Plus size={13} /> Adicionar campo
            </button>
          )}
        </div>
        <p className="text-[11px] text-faint">
          {podeEditar
            ? 'Campo apagado limpa a informação. A ficha vale para o contato, não para uma conversa — fica disponível em todos os atendimentos dele.'
            : 'Seu perfil de acesso não permite editar a ficha — você só está vendo.'}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>{podeEditar ? 'Cancelar' : 'Fechar'}</Button>
          {podeEditar && <Button type="submit" loading={update.isPending || salvarAtributos.isPending} loadingText="Salvando…">Salvar</Button>}
        </div>
      </form>
    </Modal>
  );
}

/** Resumo em uma linha, no cabeçalho do chat. Só aparece quando há algo preenchido. */
export function ContactSummary({ contact, onOpen }: { contact: Contato; onOpen: () => void }) {
  const itens = [
    contact.email && { icon: <Mail size={11} />, texto: contact.email },
    contact.address && { icon: <MapPin size={11} />, texto: contact.address },
    contact.note1 && { icon: <StickyNote size={11} />, texto: contact.note1 },
    contact.note2 && { icon: <StickyNote size={11} />, texto: contact.note2 },
  ].filter(Boolean) as { icon: React.ReactNode; texto: string }[];

  if (!itens.length) {
    return (
      /* Era cinza-claro minúsculo e ninguém reparava que havia ficha para preencher — e ficha
         vazia é cliente sem e-mail, sem endereço e sem observação na hora que precisa. */
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent/50 bg-accent-soft/50 px-2 py-0.5 text-[11.5px] font-medium text-accent-ink hover:bg-accent-soft"
        title="Preencher a ficha: e-mail, endereço e observações do contato"
      >
        <UserRound size={12} /> Preencher ficha
      </button>
    );
  }
  return (
    <button onClick={onOpen} className="w-full text-left bg-panel border-b border-line px-3 py-1 text-[11.5px] text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 hover:bg-field" title="Editar ficha do contato">
      {itens.map((i, n) => (
        <span key={n} className="inline-flex items-center gap-1 min-w-0"><span className="text-faint shrink-0">{i.icon}</span><span className="truncate max-w-[280px]">{i.texto}</span></span>
      ))}
    </button>
  );
}
