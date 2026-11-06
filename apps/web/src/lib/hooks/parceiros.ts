'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerCommissionKind, PartnerPayoutStatus, PartnerStatus, PartnerTierRule, PayoutPixKeyType } from '@atendo/shared';
import { api } from '../api';

// ---- VogoPartners (docs/37-vogopartners.md) ----

export interface PartnerRow {
  id: string; name: string; document: string | null; email: string | null; phone: string | null; status: PartnerStatus;
  pixKey: string | null; pixKeyType: PayoutPixKeyType | null; pixKeyChangedAt: string | null;
  setupRate: number | null; customTiers: boolean; tiers: PartnerTierRule[];
  clients: number; logins: number; activeClients: number; rate: number; nextTier: (PartnerTierRule & { missing: number }) | null;
  monthEstimate: number; weekSetup: number; openPayouts: number;
}
export interface PartnerEvent { id: string; action: string; actorName: string | null; partnerId: string | null; payoutId: string | null; data: Record<string, unknown> | null; ip: string | null; createdAt: string }
export interface PartnerDetail {
  id: string; name: string; document: string | null; email: string | null; phone: string | null; status: PartnerStatus; notes: string | null;
  pixKey: string | null; pixKeyType: PayoutPixKeyType | null; pixKeyChangedAt: string | null;
  setupRate: number | null; effectiveSetupRate: number;
  tiers: { id: string; minClients: number; rate: number }[];
  current: { tiers: PartnerTierRule[]; custom: boolean; activeClients: number; rate: number; nextTier: (PartnerTierRule & { missing: number }) | null };
  users: { id: string; name: string; email: string | null; isActive: boolean; invitedAt: string | null; passwordSetAt: string | null; lastLoginAt: string | null; /** entra pelo login que já tem no Atendo (vínculo) */ linked?: boolean; linkedTenant?: string | null }[];
  tenants: { id: string; name: string; isActive: boolean; createdAt: string; partnerAttributedAt: string | null; subscription: { status: string; awaitingActivation: boolean; priceMonth: number | null; plan: { name: string; isFree: boolean } } | null }[];
  events: PartnerEvent[];
}
export interface PartnerSettings {
  setupRate: number; setupFee: number; minPayout: number; pixKeyCooldownHours: number;
  secondApprovalAbove: number | null; dailyLimit: number | null; defaultTiers: PartnerTierRule[];
}
export interface PartnerPayout {
  id: string; kind: PartnerCommissionKind; period: string; periodLabel: string;
  partner: { id: string; name: string; status: PartnerStatus; pixKey: string | null; pixKeyType: string | null };
  activeClients: number | null; rate: number | null; baseTotal: number; amount: number; status: PartnerPayoutStatus;
  approvals: { userId: string; name: string; at: string }[]; pixKey: string | null; pixKeyType: string | null;
  transferId: string | null; transferStatus: string | null; failureReason: string | null; sentAt: string | null; paidAt: string | null; paidVia: string | null;
  lines: number; createdAt: string; blocked: string | null;
}
export interface PartnerPayoutDetail extends Omit<PartnerPayout, 'lines'> {
  lines: { id: string; tenant: { id: string; name: string }; kind: PartnerCommissionKind; sourceType: string; period: string; paidAt: string; baseAmount: number; rate: number | null; amount: number | null }[];
}

const KEY = ['partners'];
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}
function useM<T, R>(fn: (b: T) => Promise<R>) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: () => { void inv(); } });
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined && { body: JSON.stringify(body) }) });

export const usePartners = () => useQuery({ queryKey: [...KEY, 'list'], queryFn: () => api<PartnerRow[]>('/partners') });
export const usePartner = (id: string | null) => useQuery({ queryKey: [...KEY, 'one', id], enabled: !!id, queryFn: () => api<PartnerDetail>(`/partners/${id}`) });
export const useCreatePartner = () => useM((b: Record<string, unknown>) => api<PartnerDetail>('/partners', json('POST', b)));
export const useUpdatePartner = () => useM(({ id, ...b }: { id: string } & Record<string, unknown>) => api<PartnerDetail>(`/partners/${id}`, json('PATCH', b)));
export const useSetPartnerPix = () => useM(({ id, ...b }: { id: string; pixKey: string; pixKeyType: PayoutPixKeyType; code: string }) => api<PartnerDetail>(`/partners/${id}/pix-key`, json('PUT', b)));
export const useSetPartnerTiers = () => useM(({ id, tiers }: { id: string; tiers: PartnerTierRule[] }) => api<PartnerDetail>(`/partners/${id}/tiers`, json('PUT', { tiers })));
export const useAddPartnerLogin = () => useM(({ id, ...b }: { id: string; name: string; email: string }) => api<{ userId: string; linked: boolean; inviteLink: string | null; emailSent: boolean }>(`/partners/${id}/logins`, json('POST', b)));
export const usePartnerLoginLink = () => useM(({ id, userId }: { id: string; userId: string }) => api<{ link: string }>(`/partners/${id}/logins/${userId}/invite-link`, json('POST')));
export const useSetPartnerLoginActive = () => useM(({ id, userId, isActive }: { id: string; userId: string; isActive: boolean }) => api<PartnerDetail>(`/partners/${id}/logins/${userId}`, json('PATCH', { isActive })));

export const usePartnerSettings = () => useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api<PartnerSettings>('/partner-program/settings') });
export const useUpdatePartnerSettings = () => useM((b: Partial<Omit<PartnerSettings, 'defaultTiers'>> & { code?: string }) => api<PartnerSettings>('/partner-program/settings', json('PUT', b)));
export const useSetDefaultTiers = () => useM((tiers: PartnerTierRule[]) => api<PartnerSettings>('/partner-program/tiers', json('PUT', { tiers })));
export const useUnassignedTenants = (q: string) =>
  useQuery({ queryKey: [...KEY, 'unassigned', q], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>(`/partner-program/tenants/unassigned?q=${encodeURIComponent(q)}`) });
export const useSetTenantPartner = () => useM(({ tenantId, partnerId }: { tenantId: string; partnerId: string | null }) => api<{ ok: true }>(`/partner-program/tenants/${tenantId}`, json('PUT', { partnerId })));
export const usePartnerEvents = () => useQuery({ queryKey: [...KEY, 'events'], queryFn: () => api<PartnerEvent[]>('/partner-program/events') });

export const useTotpStatus = () => useQuery({ queryKey: [...KEY, 'totp'], queryFn: () => api<{ enabled: boolean; since: string | null }>('/partner-program/security/totp') });
export const useTotpSetup = () => useM((password: string) => api<{ secret: string; otpauthUrl: string }>('/partner-program/security/totp/setup', json('POST', { password })));
export const useTotpConfirm = () => useM((code: string) => api<{ enabled: boolean }>('/partner-program/security/totp/confirm', json('POST', { code })));
export const useTotpDisable = () => useM((b: { password: string; code: string }) => api<{ enabled: boolean }>('/partner-program/security/totp/disable', json('POST', b)));

export const usePartnerPayouts = (f: { status?: string; kind?: string; partnerId?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
  return useQuery({ queryKey: [...KEY, 'payouts', qs], queryFn: () => api<PartnerPayout[]>(`/partner-payouts${qs ? `?${qs}` : ''}`) });
};
export const usePartnerPayout = (id: string | null) => useQuery({ queryKey: [...KEY, 'payout', id], enabled: !!id, queryFn: () => api<PartnerPayoutDetail>(`/partner-payouts/${id}`) });
export const useApurar = () => useM((b: { kind: PartnerCommissionKind; period?: string }) => api<{ kind: string; period: string; results: { partnerId: string; payoutId: string | null; amount: number; skipped?: string }[] }>('/partner-payouts/apurar', json('POST', b)));
export const useApprovePayouts = () => useM((b: { ids: string[]; code: string }) => api<{ id: string; status: string; error?: string }[]>('/partner-payouts/approve', json('POST', b)));
export const useRetryPayout = () => useM(({ id, ...b }: { id: string; code: string; confirmNotSent?: boolean }) => api<{ id: string; status: string }>(`/partner-payouts/${id}/retry`, json('POST', b)));
export const useManualPaidPayout = () => useM(({ id, ...b }: { id: string; code: string; date?: string }) => api<PartnerPayoutDetail>(`/partner-payouts/${id}/paid`, json('POST', b)));
export const useCancelPayout = () => useM((id: string) => api<{ ok: true }>(`/partner-payouts/${id}`, json('DELETE')));

// ---- portal do parceiro ----

export interface PartnerMe {
  id: string; name: string; pixKey: string | null; pixKeyType: string | null;
  clients: number; activeClients: number; rate: number; tiers: PartnerTierRule[]; nextTier: (PartnerTierRule & { missing: number }) | null;
  setupRate: number; setupFee: number;
  month: { period: string; label: string; base: number; estimate: number };
  week: { period: string; label: string; amount: number };
  toReceive: number; received: number;
}
export interface PartnerClient {
  id: string; name: string; isActive: boolean; createdAt: string; since: string | null;
  plan: { name: string; isFree: boolean; monthly: number } | null; status: string | null; awaitingActivation: boolean; dueAt: string | null;
  activation: { id: string; status: string; totalValue: number; invoiceUrl: string | null; dueDate: string; paidAt: string | null } | null;
  paidThisMonth: number;
}
export interface PartnerStatement {
  lines: { id: string; kind: PartnerCommissionKind; reversal: boolean; period: string; periodLabel: string; paidAt: string; client: string; base: number; rate: number | null; amount: number | null; payoutStatus: string | null }[];
  payouts: { id: string; kind: PartnerCommissionKind; period: string; periodLabel: string; activeClients: number | null; rate: number | null; baseTotal: number; amount: number; status: 'paid' | 'processing'; paidAt: string | null }[];
}
export interface PartnerPlan { id: string; name: string; priceMonth: number; priceYear: number | null; billingCycle: string; isFree: boolean; durationDays: number | null }

const PKEY = ['partner-portal'];
function usePM<T, R>(fn: (b: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: PKEY }); } });
}
export const usePartnerMe = () => useQuery({ queryKey: [...PKEY, 'me'], queryFn: () => api<PartnerMe>('/partner/me') });
export const usePartnerClients = () => useQuery({ queryKey: [...PKEY, 'clients'], queryFn: () => api<PartnerClient[]>('/partner/clients') });
export const usePartnerPlans = () => useQuery({ queryKey: [...PKEY, 'plans'], queryFn: () => api<PartnerPlan[]>('/partner/plans'), staleTime: 60_000 });
export const usePartnerTemplates = () => useQuery({ queryKey: [...PKEY, 'templates'], queryFn: () => api<{ id: string; name: string; description: string | null; isDefault: boolean }[]>('/partner/templates'), staleTime: 60_000 });
export const usePartnerStatement = (kind?: PartnerCommissionKind) => useQuery({ queryKey: [...PKEY, 'statement', kind ?? 'all'], queryFn: () => api<PartnerStatement>(`/partner/statement${kind ? `?kind=${kind}` : ''}`) });
export const usePartnerCreateClient = () =>
  usePM((b: { name: string; slug: string; planId: string; adminEmail: string; adminName: string; templateId?: string | null }) => api<{ id: string; name: string }>('/partner/clients', json('POST', b)));
export const usePartnerActivation = (tenantId: string | null) =>
  useQuery({ queryKey: [...PKEY, 'activation', tenantId], enabled: !!tenantId, queryFn: () => api<{ planName: string; firstMonthValue: number; setupFee: number; document: string | null; awaitingActivation: boolean; asaasConfigured: boolean; charges: { id: string; status: string; totalValue: number; dueDate: string; invoiceUrl: string | null; paidAt: string | null; items: { description: string; value: number }[] }[] }>(`/partner/clients/${tenantId}/activation`) });
export const usePartnerCreateActivation = () =>
  usePM(({ tenantId, ...b }: { tenantId: string; document?: string; dueDate?: string }) => api<unknown>(`/partner/clients/${tenantId}/activation`, json('POST', b)));
