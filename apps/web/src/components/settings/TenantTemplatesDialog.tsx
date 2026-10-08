'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload, Trash2, Copy, FileJson, Pencil, Plus, Star } from 'lucide-react';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/Toast';
import { downloadJson, safeFileName } from '@/lib/utils';
import { exportTenantTemplate, useCaptureTenantTemplate, useCreateTenantTemplate, useDeleteTenantTemplate, useImportTenantTemplate, useReplaceTenantTemplate, useTenantTemplates, useTenants, type TenantTemplateRow } from '@/lib/hooks';

const lerJson = async (f: File) => JSON.parse(await f.text()) as unknown;
const erro = (err: unknown) => toast.err(err instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : err);

/**
 * Modelos de perfil (Farmácia, Clínica…): o que um cliente novo recebe ao ser criado — matriz
 * de permissões de Gerente/Atendente, respostas rápidas e fluxos. O conteúdo entra e sai como
 * `.json`; o jeito prático de montar o primeiro é "Gerar de um cliente" já configurado.
 */
export function TenantTemplatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const templates = useTenantTemplates(open);
  const importNew = useImportTenantTemplate();
  const replace = useReplaceTenantTemplate();
  const remove = useDeleteTenantTemplate();
  const newFile = useRef<HTMLInputElement>(null);
  const replaceFile = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<TenantTemplateRow | null>(null);
  const [excluindo, setExcluindo] = useState<TenantTemplateRow | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const editar = (id: string) => { onClose(); router.push(`/clientes/modelos/${id}`); };

  async function onImport(f: File) {
    try {
      const t = await importNew.mutateAsync(await lerJson(f));
      toast.ok(`Modelo "${t.name}" importado`);
    } catch (err) { erro(err); }
  }
  async function onReplace(f: File) {
    if (!replacing) return;
    try {
      await replace.mutateAsync({ id: replacing.id, file: await lerJson(f) });
      toast.ok(`"${replacing.name}" atualizado — vale para os próximos clientes`);
    } catch (err) { erro(err); } finally { setReplacing(null); }
  }
  async function onExport(t: TenantTemplateRow) {
    try { downloadJson(await exportTenantTemplate(t.id), `modelo-${safeFileName(t.name, 'perfil')}.json`); } catch (err) { toast.err(err); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Modelos de perfil" width="max-w-2xl">
      <p className="text-[12px] text-muted -mt-1 mb-4">Cliente criado com um modelo já nasce com as permissões padrão de Administrador, Gerente e Atendente, as respostas rápidas, os fluxos (desligados, para o admin revisar) e os motivos de não compra do modelo. O modelo marcado como padrão já vem escolhido no “Novo cliente”. Mudar o modelo não altera clientes já criados.</p>
      <input ref={newFile} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
      <input ref={replaceFile} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onReplace(f); else setReplacing(null); }} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Novo modelo</Button>
        <Button variant="ghost" size="sm" icon={<Upload size={14} />} loading={importNew.isPending} onClick={() => newFile.current?.click()}>Importar JSON</Button>
        <Button variant="ghost" size="sm" icon={<Copy size={14} />} onClick={() => setCapturing(true)}>Gerar de um cliente</Button>
      </div>
      {templates.data?.length === 0 && <p className="text-sm text-muted">Nenhum modelo ainda. Sem modelo, o cliente nasce só com os três perfis do catálogo e os motivos de não compra do sistema.</p>}
      <div className="divide-y divide-line rounded-xl border border-line">
        {templates.data?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
            <FileJson size={16} className="text-faint shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink truncate flex items-center gap-1.5">{t.name}{t.isDefault && <span className="inline-flex items-center gap-0.5 text-[10.5px] rounded bg-warn-soft text-warn-ink px-1.5 py-0.5"><Star size={10} /> padrão</span>}</div>
              <div className="text-[11px] text-muted">{t.profiles} perfis ajustados · {t.quickReplies} respostas · {t.flows} fluxos · {t.tenants} cliente{t.tenants === 1 ? '' : 's'}</div>
            </div>
            <Button size="sm" icon={<Pencil size={14} />} onClick={() => editar(t.id)}>Editar</Button>
            <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => onExport(t)}>Exportar</Button>
            <Button variant="ghost" size="sm" icon={<Upload size={14} />} loading={replace.isPending && replacing?.id === t.id} onClick={() => { setReplacing(t); replaceFile.current?.click(); }}>Carregar JSON</Button>
            <Button variant="subtle" size="icon" title="Excluir modelo" onClick={() => setExcluindo(t)}><Trash2 size={14} /></Button>
          </div>
        ))}
      </div>
      {capturing && <CaptureDialog onClose={() => setCapturing(false)} />}
      {creating && <NewTemplateDialog onClose={() => setCreating(false)} onCreated={editar} />}
      <ConfirmDialog
        open={!!excluindo}
        title="Excluir modelo"
        text={`Excluir "${excluindo?.name}"? Os clientes criados com ele continuam como estão.`}
        confirmLabel="Excluir"
        danger
        onConfirm={() => remove.mutateAsync(excluindo!.id).then(() => toast.ok('Modelo excluído')).catch((err) => { toast.err(err); throw err; })}
        onClose={() => setExcluindo(null)}
      />
    </Modal>
  );
}

/** Modelo tirado de um cliente já configurado: perfis que ele ajustou, respostas e fluxos. */
function CaptureDialog({ onClose }: { onClose: () => void }) {
  const tenants = useTenants();
  const capture = useCaptureTenantTemplate();
  const [tenantId, setTenantId] = useState('');
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title="Gerar modelo de um cliente">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          capture.mutateAsync({ tenantId, name }).then(({ template, warnings }) => {
            toast.ok(`Modelo "${template.name}" criado`);
            if (warnings.length) toast.warn(warnings.slice(0, 3).join(' · ') + (warnings.length > 3 ? ` (+${warnings.length - 3})` : ''));
            onClose();
          }).catch(toast.err);
        }}
      >
        <Field label="Cliente de origem" hint="Anexos de respostas e fluxos não vão: reenvie no cliente novo.">
          <select className={inputCls} value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
            <option value="">Escolha…</option>
            {tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Nome do modelo"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="Farmácia" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={capture.isPending} loadingText="Gerando…">Gerar modelo</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Modelo em branco: abre direto no editor para configurar permissões, respostas, fluxos e motivos. */
function NewTemplateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateTenantTemplate();
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title="Novo modelo de perfil">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutateAsync({ name }).then((t) => onCreated(t.id)).catch(toast.err); }}>
        <Field label="Nome" hint="Ex.: Farmácia, Clínica, Ótica."><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus placeholder="Farmácia" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending} loadingText="Criando…">Criar e configurar</Button>
        </div>
      </form>
    </Modal>
  );
}
