'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Approver { id: string; name: string; role: string }
interface RequestStatus { id: string; status: 'pending' | 'approved' | 'denied'; decidedByName: string | null; validUntil: string | null }

const ROLE: Record<string, string> = { tenant_admin: 'Administrador', manager: 'Gerente', agent: 'Atendente' };
const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return hoje ? `hoje às ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
};

/**
 * Popup do login bloqueado pela escala (docs/escalas.md#pedido-de-autorização): explica sem
 * jargão, deixa pedir autorização a um gestor com o motivo e acompanha a resposta. Aprovado,
 * "Entrar agora" refaz o login com a senha que já está no formulário.
 */
/** `skipIntro`: aberto pela tela de fim de turno, vai direto ao pedido (o aviso já está na tela). */
export function AccessRequestModal({ token, userName, onClose, onRetry, skipIntro, retryLabel = 'Entrar agora' }: { token: string; userName?: string; onClose: () => void; onRetry: () => void; skipIntro?: boolean; retryLabel?: string }) {
  const [etapa, setEtapa] = useState<'aviso' | 'pedido' | 'enviado'>(skipIntro ? 'pedido' : 'aviso');
  const [aprovadores, setAprovadores] = useState<Approver[] | null>(null);
  const [approverId, setApproverId] = useState('');
  const [reason, setReason] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<RequestStatus | null>(null);

  const post = <T,>(path: string, body: object) => api<T>(path, { method: 'POST', body: JSON.stringify({ token, ...body }) }, false);

  // a lista de quem aprova só é buscada se a pessoa decidir pedir
  useEffect(() => {
    if (etapa !== 'pedido' || aprovadores) return;
    post<Approver[]>('/auth/access-requests/approvers', {}).then(setAprovadores, (e) => setErro(e instanceof Error ? e.message : 'Não deu para carregar.'));
  }, [etapa]); // eslint-disable-line react-hooks/exhaustive-deps

  // esperando a resposta: confere a cada 10 s (o token vale 30 min)
  useEffect(() => {
    if (etapa !== 'enviado' || (situacao && situacao.status !== 'pending')) return;
    const t = setInterval(() => { post<RequestStatus | null>('/auth/access-requests/status', {}).then((s) => s && setSituacao(s), () => undefined); }, 10_000);
    return () => clearInterval(t);
  }, [etapa, situacao]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setErro(null);
    try {
      await post('/auth/access-requests', { reason: reason.trim(), approverId: approverId || undefined });
      setSituacao({ id: '', status: 'pending', decidedByName: null, validUntil: null });
      setEtapa('enviado');
    } catch (err) { setErro(err instanceof Error ? err.message : 'Não deu para enviar.'); } finally { setEnviando(false); }
  }

  const destino = approverId ? aprovadores?.find((a) => a.id === approverId)?.name : null;

  return (
    <Modal open onClose={onClose} title={etapa === 'enviado' ? 'Pedido de autorização' : skipIntro ? 'Pedir mais tempo' : 'Fora do seu horário'} width="max-w-md">
      {etapa === 'aviso' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-warn-soft text-warn-ink grid place-items-center shrink-0"><Clock size={20} /></span>
            <p className="text-sm text-ink">
              {userName ? <>Olá, <b>{userName.split(' ')[0]}</b>. </> : null}
              Agora está fora do horário da sua escala de trabalho, por isso a entrada no sistema está bloqueada.
            </p>
          </div>
          <p className="text-sm text-muted">Se você precisa trabalhar agora, peça uma autorização ao seu gestor. Assim que aprovarem, você entra normalmente.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Agora não</Button>
            <Button onClick={() => setEtapa('pedido')}>Solicitar acesso</Button>
          </div>
        </div>
      )}

      {etapa === 'pedido' && (
        <form className="space-y-4" onSubmit={enviar}>
          <Field label="Pedir para" hint="Quem recebe o pedido na hora. Qualquer gestor da lista também pode aprovar.">
            <select className={inputCls} value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={!aprovadores}>
              <option value="">{aprovadores ? 'Qualquer gestor disponível' : 'Carregando…'}</option>
              {aprovadores?.map((a) => <option key={a.id} value={a.id}>{a.name} — {ROLE[a.role] ?? a.role}</option>)}
            </select>
          </Field>
          <Field label="Motivo">
            <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required placeholder="Ex.: vou cobrir o plantão da Maria, que faltou hoje" />
          </Field>
          {erro && <p className="text-sm text-danger">{erro}</p>}
          <p className="text-[12.5px] text-muted">
            Confirmar envia o pedido para <b>{destino ?? 'os gestores da sua equipe'}</b>.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={enviando} disabled={reason.trim().length < 3 || !aprovadores}>Confirmar pedido</Button>
          </div>
        </form>
      )}

      {etapa === 'enviado' && situacao && (
        <div className="space-y-4">
          {situacao.status === 'pending' && (
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><ShieldAlert size={20} /></span>
              <div className="text-sm">
                <p className="text-ink font-medium">Pedido enviado para {destino ?? 'os gestores'}.</p>
                <p className="text-muted">Pode deixar esta tela aberta: assim que responderem, aparece aqui.</p>
              </div>
            </div>
          )}
          {situacao.status === 'approved' && (
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-ok/15 text-ok grid place-items-center shrink-0"><CheckCircle2 size={20} /></span>
              <p className="text-sm text-ink">
                {situacao.decidedByName ?? 'O gestor'} autorizou seu acesso{situacao.validUntil ? <> até <b>{quando(situacao.validUntil)}</b></> : null}.
              </p>
            </div>
          )}
          {situacao.status === 'denied' && (
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-danger-soft text-danger grid place-items-center shrink-0"><XCircle size={20} /></span>
              <p className="text-sm text-ink">{situacao.decidedByName ?? 'O gestor'} não autorizou o acesso agora. Se precisar, converse com quem recusou.</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            {situacao.status === 'approved' && <Button onClick={onRetry}>{retryLabel}</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
