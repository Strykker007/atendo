'use client';
/** Escalas de trabalho, liberações de plantão e acessos temporários — docs/escalas.md. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export type WorkScheduleType = 'FIXED_12X36' | 'COMMERCIAL_44H' | 'CUSTOM';
export const WORK_SCHEDULE_TYPES: { id: WorkScheduleType; label: string; desc: string }[] = [
  { id: 'FIXED_12X36', label: '12x36', desc: '12 horas de trabalho, 36 de descanso — alterna os dias a partir de uma data de referência.' },
  { id: 'COMMERCIAL_44H', label: 'Comercial 44h', desc: 'Mesmo horário nos dias marcados (ex.: seg. a sex.).' },
  { id: 'CUSTOM', label: 'Personalizada', desc: 'Dias e horário livres, ou um ciclo próprio de trabalho e descanso.' },
];
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export interface WorkSchedule {
  id: string;
  name: string;
  type: WorkScheduleType;
  startTime: string;
  endTime: string;
  workDays: number[];
  restHours: number;
  anchorDate: string | null;
  toleranceMinutes: number;
  users: { id: string; name: string }[];
}
export type WorkScheduleInput = Omit<WorkSchedule, 'id' | 'users'>;

export interface TeamShift {
  id: string;
  name: string;
  email: string;
  role: 'tenant_admin' | 'manager' | 'agent';
  scheduleId: string | null;
  isTemporary: boolean;
  accessExpiresAt: string | null;
  schedule: { id: string; name: string } | null;
  /** sem escala ou admin: nunca é travado por horário */
  exempt: boolean;
  onShift: boolean;
  override: { id: string; validUntil: string; reason: string | null } | null;
}

export interface ScheduleOverride {
  id: string;
  validFrom: string;
  validUntil: string;
  reason: string | null;
  user: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}

export interface TemporaryUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  accessExpiresAt: string | null;
  expiredAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'INACTIVE';
  schedule: { id: string; name: string } | null;
  temporaryCreatedBy: { id: string; name: string } | null;
}

const invalidar = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['work-schedules'] });
  qc.invalidateQueries({ queryKey: ['agents'] });
};

export const useWorkSchedules = () => useQuery({ queryKey: ['work-schedules'], queryFn: () => api<WorkSchedule[]>('/work-schedules') });
/** Situação da equipe agora: atualiza sozinha a cada minuto (turnos começam e acabam). */
export const useTeamShifts = () => useQuery({ queryKey: ['work-schedules', 'team'], queryFn: () => api<TeamShift[]>('/work-schedules/team'), refetchInterval: 60_000 });
export const useScheduleOverrides = () => useQuery({ queryKey: ['work-schedules', 'overrides'], queryFn: () => api<ScheduleOverride[]>('/work-schedules/overrides') });
export const useTemporaryUsers = () => useQuery({ queryKey: ['work-schedules', 'temporary'], queryFn: () => api<TemporaryUser[]>('/users/temporary') });

export const useSaveWorkSchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: WorkScheduleInput & { id?: string }) => api<WorkSchedule>(id ? `/work-schedules/${id}` : '/work-schedules', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }),
    onSuccess: () => invalidar(qc),
  });
};
export const useDeleteWorkSchedule = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/work-schedules/${id}`, { method: 'DELETE' }), onSuccess: () => invalidar(qc) });
};
export const useAssignSchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, scheduleId }: { userId: string; scheduleId: string | null }) => api(`/users/${userId}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduleId }) }),
    onSuccess: () => invalidar(qc),
  });
};
export const useCreateOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { userId: string; hours: number; reason?: string }) => api<{ id: string; validUntil: string }>('/work-schedules/overrides', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => invalidar(qc),
  });
};
export const useRevokeOverride = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/work-schedules/overrides/${id}`, { method: 'DELETE' }), onSuccess: () => invalidar(qc) });
};
export const useCreateTemporaryUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; hours: number; scheduleId?: string }) => api<{ id: string; name: string; email: string; password: string; accessExpiresAt: string }>('/users/temporary', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => { invalidar(qc); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};
export const useExpireTemporaryUser = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/users/temporary/${id}/expire`, { method: 'POST' }), onSuccess: () => { invalidar(qc); qc.invalidateQueries({ queryKey: ['usage'] }); } });
};
