'use client';
import { useState } from 'react';
import { AlertTriangle, MessageSquare, Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useMetaRegistration, useMetaRegistrationStep } from '@/lib/hooks';

/**
 * Número oficial que ficou sem registro na Cloud API — a verificação por código não terminou na
 * janela da Meta e o /register foi recusado (docs/meta-cadastro-incorporado.md#registro-pendente).
 * Sem registro ele não envia nem recebe. Aqui se termina sem remover o número: pede o código por
 * SMS ou ligação, confirma e registra (verificado e não registrado = só o botão Registrar).
 * Some quando está registrado, em coexistência ou quando a Meta não respondeu.
 */
export function MetaRegistrationNotice({ numberId }: { numberId: string }) {
  const q = useMetaRegistration(numberId, true);
  const passo = useMetaRegistrationStep(numberId);
  const [pediu, setPediu] = useState(false);
  const [codigo, setCodigo] = useState('');
  const r = q.data?.registration;
  if (!r || r.registered || r.coexist) return null;
  const verificado = r.verification === 'VERIFIED';

  async function pedir(method: 'SMS' | 'VOICE') {
    try {
      await passo.mutateAsync({ step: 'request-code', method });
      setPediu(true);
      toast.ok(method === 'SMS' ? 'Código enviado por SMS para o número' : 'A Meta vai ligar para o número com o código');
    } catch (err) { toast.err(err); }
  }
  async function confirmar() {
    try {
      await passo.mutateAsync({ step: 'verify-code', code: codigo });
      await registrar();
    } catch (err) { toast.err(err); }
  }
  async function registrar() {
    try {
      const res = await passo.mutateAsync({ step: 'register' });
      if (res.registration?.registered) toast.ok('Número registrado na API oficial — já pode enviar e receber');
      else toast.warn('A Meta aceitou, mas ainda não mostra o número como registrado. Confira em alguns minutos.');
    } catch (err) { toast.err(err); }
  }

  return (
    <div className="rounded-lg border border-warn bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink space-y-2">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          <b>Não registrado na API oficial</b> — não envia nem recebe.{' '}
          {verificado ? 'O número já está verificado: falta só registrar.' : 'Falta verificar o número com o código que a Meta manda para ele.'}
        </span>
      </div>
      {verificado ? (
        <Button size="sm" onClick={() => void registrar()} loading={passo.isPending} loadingText="Registrando…">Registrar agora</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => void pedir('SMS')} disabled={passo.isPending}>Código por SMS</Button>
          <Button size="sm" variant="ghost" icon={<Phone size={13} />} onClick={() => void pedir('VOICE')} disabled={passo.isPending}>Por ligação</Button>
          {pediu && (
            <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }} className="flex items-center gap-2">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Código de 6 números" className="w-24 rounded-md border border-line bg-panel text-ink px-2 py-1 text-[13px] tnum tracking-widest" autoFocus />
              <Button size="sm" type="submit" disabled={codigo.length !== 6} loading={passo.isPending} loadingText="Confirmando…">Confirmar e registrar</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
