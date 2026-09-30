'use client';
import { useEffect, useState } from 'react';
import { UserRound, Mail, MapPin, StickyNote, X } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useUpdateContact, type Conversation } from '@/lib/hooks';

type Contato = Conversation['contact'];

/** Ficha do contato: o que o atendente precisa saber sem perguntar de novo a cada conversa. */
export function ContactSheet({ contact, onClose }: { contact: Contato; onClose: () => void }) {
  const update = useUpdateContact();
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
    try {
      await update.mutateAsync({ contactId: contact.id, ...form });
      toast.ok('Ficha salva');
      onClose();
    } catch (err) { toast.err(err); }
  }

  return (
    <Modal open onClose={onClose} title="Ficha do contato">
      <form onSubmit={salvar} className="space-y-3">
        <div className="text-[12px] text-muted tnum">+{contact.phone}</div>
        <Field label="Nome"><input className={inputCls} value={form.name} onChange={set('name')} maxLength={80} placeholder="Como o cliente se chama" /></Field>
        <Field label="E-mail"><input className={inputCls} type="email" value={form.email} onChange={set('email')} maxLength={160} placeholder="para orçamento, nota fiscal…" /></Field>
        <Field label="Endereço"><input className={inputCls} value={form.address} onChange={set('address')} maxLength={300} placeholder="Rua, número, bairro, cidade" /></Field>
        <Field label="Observação 1"><textarea className={inputCls} rows={2} value={form.note1} onChange={set('note1')} maxLength={1000} placeholder="Preferências, histórico, o que evitar…" /></Field>
        <Field label="Observação 2"><textarea className={inputCls} rows={2} value={form.note2} onChange={set('note2')} maxLength={1000} /></Field>
        <p className="text-[11px] text-faint">Campo apagado limpa a informação. A ficha vale para o contato, não para uma conversa — fica disponível em todos os atendimentos dele.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={update.isPending} loadingText="Salvando…">Salvar</Button>
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
      <button onClick={onOpen} className="text-[11px] text-faint hover:text-accent inline-flex items-center gap-1" title="Preencher ficha do contato">
        <UserRound size={11} /> preencher ficha
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
