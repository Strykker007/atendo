'use client';
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Lock, Trash2, Upload as UploadIcon } from 'lucide-react';
import { SECURE_MEDIA_TEXT_DEFAULT, secureMediaMessage } from '@atendo/shared';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { MarcaHorizontal } from '@/components/ui/Marca';
import { uploadFile, useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * O que o contato vê fora do WhatsApp (docs/foto-protegida.md#configuração): a logo da empresa no
 * topo da foto protegida e do orçamento (sem logo, a marca do painel) e a frase que acompanha o
 * link da foto protegida.
 */
export function PublicPagesSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const d = settings.data;
  useEffect(() => { if (d) setTexto(d.secureMediaText ?? ''); }, [d?.secureMediaText]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;

  // sem {{link}} o link vai no final sozinho: ninguém precisa saber da variável para a foto chegar
  const comLink = (t: string) => (!t || /\{\{\s*link\s*\}\}/.test(t) ? t : `${t} {{link}}`);
  const final = comLink(texto.trim());
  const efetivo = final || SECURE_MEDIA_TEXT_DEFAULT;
  const mudou = (final || null) !== (d.secureMediaText ?? null);

  async function escolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_MIMES.includes(file.type)) return toast.err(new Error('Use PNG, JPG ou WEBP.'));
    if (file.size > 2 * 1024 * 1024) return toast.err(new Error('A logo pode ter até 2 MB.'));
    setEnviando(true);
    try {
      const up = await uploadFile(file);
      await update.mutateAsync({ publicLogoKey: up.key });
      toast.ok('Logo atualizada');
    } catch (err) {
      toast.err(err);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><ImageIcon size={16} className="text-accent" /> Páginas para o cliente</h2>
        <p className="text-sm text-muted">O que o seu cliente vê ao abrir o link de uma foto protegida ou de um orçamento.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-ink">Logo da empresa</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-16 w-48 rounded-xl border border-line bg-chat-bg grid place-items-center px-3">
            {d.publicLogoUrl ? <img src={d.publicLogoUrl} alt="Logo" className="max-h-12 max-w-full object-contain" /> : <MarcaHorizontal className="h-7" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" loading={enviando} icon={<UploadIcon size={14} />} onClick={() => fileRef.current?.click()}>{d.publicLogoUrl ? 'Trocar logo' : 'Enviar logo'}</Button>
            {d.publicLogoUrl && (
              <Button size="sm" variant="subtle" icon={<Trash2 size={14} />} disabled={update.isPending}
                onClick={() => update.mutateAsync({ publicLogoKey: null }).then(() => toast.ok('Logo removida: volta a marca do painel')).catch(toast.err)}>Remover</Button>
            )}
          </div>
          <input ref={fileRef} type="file" hidden accept={LOGO_MIMES.join(',')} onChange={escolherLogo} />
        </div>
        <p className="text-[11px] text-muted">PNG, JPG ou WEBP até 2 MB; de preferência horizontal e com fundo transparente. Sem logo, aparece a marca do painel.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-ink flex items-center gap-1.5"><Lock size={13} /> Frase da foto protegida</h3>
        <textarea className={inputCls} rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={SECURE_MEDIA_TEXT_DEFAULT} />
        <p className="text-[11px] text-muted">
          Vai pelo WhatsApp no lugar da imagem. O link entra no final sozinho; para pôr em outro lugar, use <code>{'{{link}}'}</code>. Também dá para usar <code>{'{{validade}}'}</code> e <code>{'{{primeiro_nome}}'}</code>. Evite citar o conteúdo da foto (nome de remédio, receita): o texto é o que o WhatsApp lê. Vazio = a frase padrão.
        </p>
        <div className="rounded-lg bg-field px-3 py-2 text-[12px] text-ink">
          <span className="text-muted">Prévia: </span>{secureMediaMessage('https://seu-painel/f/Ab3dE…', 24, 'Ana', efetivo)}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!mudou} loading={update.isPending}
            onClick={() => update.mutateAsync({ secureMediaText: final || null }).then(() => { setTexto(final); toast.ok('Frase salva'); }).catch(toast.err)}>Salvar frase</Button>
          {d.secureMediaText && <Button size="sm" variant="ghost" onClick={() => setTexto('')}>Voltar à padrão</Button>}
        </div>
      </div>
    </section>
  );
}
