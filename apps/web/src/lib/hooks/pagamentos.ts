'use client';
/** Conta do Asaas da empresa para o Pix automático do orçamento (docs/orcamentos.md#pix-automático). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface PaymentGatewayStatus {
  /** o plano inclui `pix_payments` */
  feature: boolean;
  connected: boolean;
  provider?: 'asaas';
  sandbox?: boolean;
  accountName?: string | null;
  connectedAt?: string;
}

const KEY = ['payment-gateway'];
const BASE = '/tenants/me/payment-gateway';

export const usePaymentGateway = () => useQuery({ queryKey: KEY, queryFn: () => api<PaymentGatewayStatus>(BASE), staleTime: 60_000 });
export const useConnectPaymentGateway = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { apiKey: string; sandbox: boolean }) => api<PaymentGatewayStatus>(BASE, { method: 'PUT', body: JSON.stringify(b) }), onSuccess: (d) => qc.setQueryData(KEY, d) });
};
export const useDisconnectPaymentGateway = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api(BASE, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
