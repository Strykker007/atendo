'use client';
/** Agendamento. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Agendamento ----
export interface WorkingHour { id?: string; weekday: number; start: string; end: string }
export interface Professional { id: string; name: string; phone: string | null; userId: string | null; color: string; isActive: boolean; hours: WorkingHour[] }
export interface ServiceItem { id: string; name: string; durationMin: number; price: string; isActive: boolean; position: number }
export interface SchedulingSettings { tenantId: string; slotMinutes: number; clientReminderMinutes: number[]; proReminderMinutes: number; numberId: string | null; timezone: string; daysAhead: number }
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'done' | 'no_show' | 'canceled';
export interface Appointment { id: string; professionalId: string; serviceId: string; contactId: string; conversationId: string | null; startAt: string; endAt: string; status: AppointmentStatus; source: string; notes: string | null; rescheduleRequested: boolean; contact: { id: string; name: string | null; phone: string }; service: ServiceItem; professional: { id: string; name: string; color: string } }
export interface Slot { startAt: string; endAt: string; label: string }
export interface ContactCard { visits: number; last: (Appointment & { service: ServiceItem }) | null; upcoming: (Appointment & { service: ServiceItem; professional: { name: string } })[] }

const invSched = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries({ queryKey: ['professionals'] }); qc.invalidateQueries({ queryKey: ['services'] }); qc.invalidateQueries({ queryKey: ['appointments'] }); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['contact-card'] }); };
export const useProfessionals = () => useQuery({ queryKey: ['professionals'], queryFn: () => api<Professional[]>('/scheduling/professionals'), retry: false });
export const useServices = () => useQuery({ queryKey: ['services'], queryFn: () => api<ServiceItem[]>('/scheduling/services'), retry: false });
export const useSchedulingSettings = () => useQuery({ queryKey: ['scheduling-settings'], queryFn: () => api<SchedulingSettings>('/scheduling/settings'), retry: false });
export const useUpdateSchedulingSettings = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<SchedulingSettings>) => api('/scheduling/settings', { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduling-settings'] }) }); };
export const useSaveProfessional = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<Professional> & { hours?: WorkingHour[] }) => api<Professional>(id ? `/scheduling/professionals/${id}` : '/scheduling/professionals', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }), onSuccess: invSched(qc) }); };
export const useDeleteProfessional = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/scheduling/professionals/${id}`, { method: 'DELETE' }), onSuccess: invSched(qc) }); };
export const useSaveService = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Omit<Partial<ServiceItem>, 'price'> & { price?: number }) => api<ServiceItem>(id ? `/scheduling/services/${id}` : '/scheduling/services', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }), onSuccess: invSched(qc) }); };
export const useDeleteService = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/scheduling/services/${id}`, { method: 'DELETE' }), onSuccess: invSched(qc) }); };
export const useAppointments = (from: string, to: string, professionalId?: string | null) => useQuery({ queryKey: ['appointments', from, to, professionalId], queryFn: () => api<Appointment[]>(`/scheduling/appointments?from=${from}&to=${to}${professionalId ? `&professionalId=${professionalId}` : ''}`), retry: false });
export const useAvailability = (professionalId: string | null, serviceId: string | null, from?: string) => useQuery({ queryKey: ['availability', professionalId, serviceId, from], enabled: !!professionalId && !!serviceId, queryFn: () => api<Slot[]>(`/scheduling/availability?professionalId=${professionalId}&serviceId=${serviceId}${from ? `&from=${from}` : ''}&days=14`) });
export const useCreateAppointment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { professionalId: string; serviceId: string; contactId: string; startAt: string; conversationId?: string; notes?: string }) => api<Appointment>('/scheduling/appointments', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invSched(qc) }); };
export const useUpdateAppointment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; status?: AppointmentStatus; startAt?: string; professionalId?: string; serviceId?: string; notes?: string }) => api<Appointment>(`/scheduling/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invSched(qc) }); };
export const useContactCard = (contactId: string | null, enabled = true) => useQuery({ queryKey: ['contact-card', contactId], enabled: !!contactId && enabled, queryFn: () => api<ContactCard>(`/scheduling/contacts/${contactId}`), retry: false });
