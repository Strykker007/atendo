'use client';
/** Modelos de perfil (Farmácia, Clínica…) — só o dono do sistema. Ver docs/20-modelos-de-perfil.md. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@atendo/shared';
import { api } from '../api';

export interface TenantTemplateRow { id: string; name: string; description: string | null; isDefault: boolean; updatedAt: string; tenants: number; profiles: number; quickReplies: number; flows: number; lossReasons: number | null }

/** Conteúdo do modelo (apps/api → tenants/tenant-template.ts). Fluxos vão no formato portável, sem edição aqui. */
export interface TemplateProfile { name: string; description?: string; permissions: Permission[] }
export interface TemplateQuickReply { atendo: 'quick-reply'; version: number; folder: string; title: string; body: string }
export interface TemplateFlow { atendo: 'flow'; version: number; name: string; description?: string; trigger: unknown; definition: unknown }
export interface TemplateContent { profiles: TemplateProfile[]; quickReplies: TemplateQuickReply[]; flows: TemplateFlow[]; lossReasons?: string[] }
export interface TenantTemplateDetail { id: string; name: string; description: string | null; isDefault: boolean; tenants: number; content: TemplateContent; effectiveLossReasons: string[] }

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
