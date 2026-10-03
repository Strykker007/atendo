/**
 * Reajuste de preço de quem já assina.
 *
 * O problema que isto resolve: no Stripe o preço de uma assinatura não muda sozinho. Sem
 * nada, o cliente que entrou hoje paga o preço de hoje **para sempre** — dez anos depois,
 * com os custos todos reajustados, ele continua no mesmo valor. Era a única parte do
 * faturamento que só andava para trás.
 *
 * Isolado (sem Nest/Prisma/Stripe) porque decide quem tem o preço mexido e quando. Errar aqui
 * é cobrar a mais de quem não devia, e isso não se desfaz com um deploy.
 */

export interface AssinaturaParaReajuste {
  id: string;
  status: string;
  /** o que este cliente paga hoje; null = nunca foi registrado (segue o plano) */
  priceMonth: number | null;
}

/** Assinatura cancelada não é reajustada: não há o que cobrar, e mexer nela geraria ruído. */
const VIVAS = ['trialing', 'active', 'past_due', 'suspended'];

/**
 * Quem entra no reajuste deste plano.
 *
 * Só quem está pagando valor **diferente** do novo: reenviar o mesmo preço para o Stripe não
 * tem efeito, mas dispara e-mail de "sua mensalidade mudou" para quem não teve mudança
 * nenhuma — e um aviso desses sem motivo custa a confiança do cliente.
 */
export function aReajustar(assinaturas: AssinaturaParaReajuste[], precoNovo: number): AssinaturaParaReajuste[] {
  return assinaturas.filter((s) => VIVAS.includes(s.status) && (s.priceMonth ?? precoNovo) !== precoNovo);
}

/** Chegou a data? Comparação em um lugar só, para a rotina diária e a tela concordarem. */
export function venceu(quando: Date | null | undefined, agora = new Date()): boolean {
  return !!quando && quando.getTime() <= agora.getTime();
}

/**
 * Data em que o preço novo passa a valer para quem já assina.
 *
 * `dias` é o aviso prévio. O padrão de 30 dias não é técnico: é o prazo que um contrato de
 * serviço continuado costuma exigir para avisar mudança de preço, e o cliente precisa poder
 * sair antes se não aceitar. Zero = vale a partir do próximo ciclo de cobrança de cada um.
 */
export function dataDoReajuste(dias: number, agora = new Date()): Date {
  const d = new Date(agora);
  d.setDate(d.getDate() + Math.max(0, Math.floor(dias)));
  return d;
}

/** "em 30 dias (02/11/2026)" — mesmo texto no aviso ao cliente e na tela do dono. */
export function porExtenso(quando: Date): string {
  return quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
