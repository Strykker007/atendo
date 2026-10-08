'use client';
import { ShieldCheck } from 'lucide-react';
import { COLD_CONTACTS_PER_DAY, TYPING_MAX_MS } from '@atendo/shared';
import { useColdQuota } from '@/lib/hooks';

/**
 * Todas as travas de proteção do número QR num lugar só, em linguagem de cliente.
 * Antes cada regra aparecia só no erro dela — a pessoa esbarrava sem saber que a regra existia.
 * Detalhes técnicos em docs/envio.md.
 */
export function ProtectionRules({ numberId }: { numberId: string }) {
  const cota = useColdQuota(numberId);
  const restam = cota.data ? Math.max(0, cota.data.max - cota.data.used) : null;
  return (
    <details className="group rounded-xl border border-line bg-field/40 px-3 py-2 text-[12.5px] text-muted">
      <summary className="cursor-pointer select-none list-none flex items-center gap-2 text-ink font-medium">
        <ShieldCheck size={14} className="text-accent-ink shrink-0" />
        Como este número é protegido contra bloqueio
        <span className="ml-auto text-faint text-[11px] group-open:hidden">ver regras</span>
      </summary>
      <ul className="mt-2 space-y-1.5 list-disc pl-5">
        <li>
          <b className="text-ink">Ritmo de envio.</b> As mensagens saem com alguns segundos entre uma e outra, como uma pessoa faria.
          No chat elas já aparecem com ✓ na hora; o sistema entrega no ritmo certo logo em seguida.
        </li>
        <li>
          <b className="text-ink">&quot;Digitando…&quot;.</b> Resposta rápida, texto colado, encaminhada e agendada mostram &quot;digitando…&quot; ao contato
          pelo tempo que a pessoa levaria para escrever (no máximo {TYPING_MAX_MS / 1000} s), na velocidade de cada atendente (Equipe → Digitação).
        </li>
        <li>
          <b className="text-ink">Contato que não escreveu nas últimas 24 horas.</b> O atendente pode falar primeiro com até {COLD_CONTACTS_PER_DAY} contatos assim por dia
          {restam !== null && <> (restam <b className="text-ink">{restam}</b> agora)</>}. Mensagem automática (fluxo, boas-vindas) não sai para eles.
          Para chamar muitos contatos, use um número Meta Cloud API.
        </li>
        <li>
          <b className="text-ink">Robô com limite por hora.</b> Fluxos e mensagens automáticas têm um teto por hora e esperam alguns segundos entre si.
          Passou do teto, a mensagem já aparece como enviada e sai sozinha quando houver vaga — não se perde.
        </li>
        <li>
          <b className="text-ink">Primeira semana.</b> Logo depois de ler o QR Code o número &quot;aquece&quot;: poucos contatos novos por hora, aumentando a cada dia.
        </li>
        <li>
          <b className="text-ink">Quem pediu para sair.</b> Contato que mandou &quot;sair&quot;, &quot;parar&quot; ou &quot;stop&quot; não recebe mais mensagens automáticas. O atendente continua respondendo.
        </li>
        <li>
          <b className="text-ink">Mensagem que não sai.</b> Se o número desconectar, os envios esperam; passou de 30 minutos parados, viram falha (ícone vermelho) com o motivo e o botão Tentar novamente. Espera causada pelas proteções acima não vira falha.
        </li>
      </ul>
    </details>
  );
}
