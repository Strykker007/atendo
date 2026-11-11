'use client';
/** Modelos de perfil (Farmácia, Clínica…) — só o dono do sistema. Ver docs/20-modelos-de-perfil.md. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortableAiAgent, PortableTicketType } from '@atendo/shared';
import type { Permission } from '@atendo/shared';
import { api } from '../api';

export interface TenantTemplateRow { id: string; name: string; description: string | null; isDefault: boolean; updatedAt: string; tenants: number; profiles: number; quickReplies: number; flows: number; tags: number; aiAgents?: number; ticketTypes?: number }

/** Conteúdo do modelo (apps/api → tenants/tenant-template.ts). Fluxos vão no formato portável, sem edição aqui. */
export interface TemplateProfile { name: string; /** vínculo interno de Gerente/Atendente quando o rótulo foi adaptado */ systemRole?: 'manager' | 'agent'; description?: string; permissions: Permission[]; /** acesso padrão no cliente: departamentos do modelo pelo nome (números são do cliente) */ access?: { departments: string[] } }
/** Departamento do modelo; `parent` = nome do departamento acima (hierarquia) */
export interface TemplateDepartment { name: string; color?: string; description?: string; parent?: string }
export interface TemplateQuickReply { atendo: 'quick-reply'; version: number; folder: string; title: string; body: string }
export interface TemplateFlow { atendo: 'flow'; version: number; name: string; description?: string; /** aparece no modal de encerramento do cliente novo */ showOnClosing?: boolean; trigger: unknown; definition: unknown }
/** tag com que o cliente nasce — as mesmas opções da tela de Tags */
/** `conflictsWith`: nomes de tags do modelo que não convivem com esta (simétrico — basta um lado) */
export interface TemplateTag { name: string; color?: string; isKanban?: boolean; showOnWon?: boolean; showOnLost?: boolean; conflictsWith?: string[] }
export interface TemplateContent { profiles: TemplateProfile[]; quickReplies: TemplateQuickReply[]; flows: TemplateFlow[]; /** ausente = as de encerramento do formato antigo / catálogo (`effectiveTags`) */ tags?: TemplateTag[]; /** formato antigo, só leitura */ lossReasons?: string[]; /** cor `#rrggbb` do botão de cada motivo */ lossReasonColors?: Record<string, string>; /** configurações de atendimento com que o cliente nasce; ausente = padrão do sistema */ settings?: TemplateSettings; /** agentes de IA (sem documentos) — os fluxos citam pelo nome */ aiAgents?: PortableAiAgent[]; /** tipos de ticket — o "Abrir ticket" cita pelo nome */ ticketTypes?: PortableTicketType[]; /** departamentos com hierarquia */ departments?: TemplateDepartment[] }
/** Configurações → Atendimento do cliente novo: encerramento com/sem venda, assinatura, nomes dos resultados. */
export interface TemplateSettings {
  salesEnabled?: boolean; requireSignature?: boolean; wonLabel?: string; lostLabel?: string;
  /** redistribuição automática e saiu do plantão (docs/redistribuicao-automatica.md) */
  autoReassignWaiting?: boolean; autoReassignAssigned?: boolean; autoReassignBaseMinutes?: number; autoReassignMaxMinutes?: number; autoReassignMaxTimes?: number;
  releaseAwayEnabled?: boolean; releaseAwayMinutes?: number;
}
export interface TenantTemplateDetail { id: string; name: string; description: string | null; isDefault: boolean; tenants: number; content: TemplateContent; /** o que o cliente recebe hoje (com `tags` ausente, vem do formato antigo ou do catálogo) */ effectiveTags: TemplateTag[] }

const inv = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['tenant-templates'] });

export const useTenantTemplates = (enabled = true) => useQuery({ queryKey: ['tenant-templates'], queryFn: () => api<TenantTemplateRow[]>('/tenant-templates'), enabled });
/** Arquivo `.json` do modelo (perfis + respostas + fluxos). */
export const exportTenantTemplate = (id: string) => api<{ name: string }>(`/tenant-templates/${id}/export`);
export const useImportTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (file: unknown) => api<{ id: string; name: string }>('/tenant-templates/import', { method: 'POST', body: JSON.stringify({ portable: file }) }), onSuccess: inv(qc) }); };
/** Carrega o arquivo num modelo existente (substitui o conteúdo). */
export const useReplaceTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, file }: { id: string; file: unknown }) => api(`/tenant-templates/${id}`, { method: 'PUT', body: JSON.stringify({ portable: file }) }), onSuccess: inv(qc) }); };
export const useCaptureTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { tenantId: string; name: string }) => api<{ template: { id: string; name: string }; warnings: string[] }>('/tenant-templates/capture', { method: 'POST', body: JSON.stringify(b) }), onSuccess: inv(qc) }); };
export const useTenantTemplate = (id: string) => useQuery({ queryKey: ['tenant-templates', id], queryFn: () => api<TenantTemplateDetail>(`/tenant-templates/${id}`) });
export const useCreateTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string; description?: string }) => api<{ id: string; name: string }>('/tenant-templates', { method: 'POST', body: JSON.stringify(b) }), onSuccess: inv(qc) }); };
export const useUpdateTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string; isDefault?: boolean; content?: TemplateContent }) => api(`/tenant-templates/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: inv(qc) }); };
export const useDeleteTenantTemplate = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/tenant-templates/${id}`, { method: 'DELETE' }), onSuccess: inv(qc) }); };

/** "Aplicar aos clientes": replica partes do modelo SALVO em clientes que já existem. `dryRun` = prévia. */
export interface TemplateRolloutBody { tenantIds?: string[]; profiles?: string[]; closeReasons?: boolean; replaceCloseReasons?: boolean; tags?: boolean; settings?: boolean; aiAgents?: boolean; ticketTypes?: boolean; departments?: boolean; dryRun?: boolean }
export interface TemplateRolloutResult {
  tenantId: string;
  name: string;
  profiles: { created: string[]; updated: string[] };
  closeReasons: { created: string[]; updated: string[]; reactivated: string[]; deactivated: string[] };
  tags: { created: string[] };
  /** configurações que mudaram, em texto ("Encerramento com venda: desligado") */
  settings: { changed: string[] };
  aiAgents?: { created: string[] };
  departments?: { created: string[] };
  ticketTypes?: { created: string[] };
}
export const useRolloutTenantTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: TemplateRolloutBody & { id: string }) => api<TemplateRolloutResult[]>(`/tenant-templates/${id}/rollout`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (_, v) => { if (!v.dryRun) qc.invalidateQueries({ queryKey: ['tenants'] }); },
  });
};
