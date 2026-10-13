'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2, QrCode } from 'lucide-react';
import { PIX_KEY_TYPES, PIX_KEY_TYPE_LABEL, type PixKeyType } from '@atendo/shared';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { usePixKeys, useCreatePixKey, useUpdatePixKey, useDeletePixKey, type PixKey } from '@/lib/hooks';

const PLACEHOLDER: Record<PixKeyType, string> = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  email: 'financeiro@empresa.com.br',
  phone: '(11) 99999-9999',
  random: '123e4567-e89b-12d3-a456-426614174000',
};

type Draft = { id?: string; title: string; keyType: PixKeyType; key: string; holderName: string };

/**
 * Chaves Pix da empresa. No chat ficam na pasta "Pix" do painel de respostas: um clique envia
 * o cartão com o botão "Copiar chave Pix" (conexão QR); na API oficial sai como texto.
 */
export function PixKeysSection({ podeEditar }: { podeEditar: boolean }) {
  const keys = usePixKeys();
  const create = useCreatePixKey();
  const update = useUpdatePixKey();
  const remove = useDeletePixKey();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<PixKey | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const body = { title: draft.title, keyType: draft.keyType, key: draft.key, holderName: draft.holderName || undefined };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...body });
      else await create.mutateAsync(body);
      toast.ok(draft.id ? 'Chave atualizada' : 'Chave cadastrada');
      setDraft(null);
    } catch (err) { toast.err(err); }
  }

  if (!podeEditar && !keys.data?.length) return null;

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display font-semibold text-ink flex items-center gap-2"><QrCode size={16} className="text-ok" /> Chaves Pix</h2>
          <p className="text-xs text-muted mt-0.5">Aparecem na pasta “Pix” do chat. Um clique envia ao cliente o cartão com o botão “Copiar chave Pix”.</p>
        </div>
        {podeEditar && <Button size="sm" icon={<Plus size={14} />} onClick={() => setDraft({ title: '', keyType: 'cnpj', key: '', holderName: '' })}>Nova chave</Button>}
      </div>

      {keys.data?.length === 0 && <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-faint">Nenhuma chave cadastrada. Ex.: “Pix Matriz - CNPJ”.</p>}
      {!!keys.data?.length && (
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line">
          {keys.data.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink truncate">{k.title}</div>
                <div className="text-xs text-muted truncate">{PIX_KEY_TYPE_LABEL[k.keyType]} · {k.key} · {k.holderName}</div>
              </div>
              {podeEditar && (
                <>
                  <button onClick={() => setDraft({ id: k.id, title: k.title, keyType: k.keyType, key: k.key, holderName: k.holderName })} className="text-faint hover:text-ink p-1" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => setDeleting(k)} className="text-faint hover:text-danger p-1" title="Excluir"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar chave Pix' : 'Nova chave Pix'} width="max-w-md">
        {draft && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Título"><input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Pix Matriz - CNPJ" maxLength={60} required autoFocus /></Field>
            <Field label="Tipo da chave">
              <select className={inputCls} value={draft.keyType} onChange={(e) => setDraft({ ...draft, keyType: e.target.value as PixKeyType })}>
                {PIX_KEY_TYPES.map((t) => <option key={t} value={t}>{PIX_KEY_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Chave"><input className={inputCls} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder={PLACEHOLDER[draft.keyType]} maxLength={77} required /></Field>
            <Field label="Nome do recebedor (opcional)"><input className={inputCls} value={draft.holderName} onChange={(e) => setDraft({ ...draft, holderName: e.target.value })} placeholder="Como aparece no cartão; vazio = o título" maxLength={60} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button type="submit" loading={create.isPending || update.isPending} loadingText="Salvando…">Salvar</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir chave Pix"
        danger
        confirmLabel="Excluir"
        text={`A chave "${deleting?.title}" sai do painel do chat. Mensagens já enviadas não mudam.`}
        onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Chave excluída'); } catch (err) { toast.err(err); throw err; } }}
      />
    </section>
  );
}
