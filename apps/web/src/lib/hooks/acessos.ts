'use client';
/** Registro de acessos: quem esteve logado em cada dia e o calendário de uma pessoa — docs/registro-de-acessos.md. */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export interface AccessSession {
  id: string;
  /** ok = entrou; out_of_schedule / account_expired = tentativa barrada */
  outcome: 'ok' | 'out_of_schedule' | 'account_expired';
  startedAt: string;
  /** saída registrada; sem saída: última renovação; online: agora */
  endAt: string;
  online: boolean;
  endReason: 'logout' | 'shift_end' | 'expired' | 'revoked' | null;
  ip: string | null;
  device: string | null;
}

export interface AccessPerson {
  id: string;
  name: string;
  email?: string | null;
  role: 'tenant_admin' | 'manager' | 'agent' | 'super_admin';
  isActive?: boolean;
  isTemporary: boolean;
}

export interface AccessDay {
  date: string;
  timezone: string;
  people: {
    user: AccessPerson;
    firstAt: string | null;
    lastAt: string | null;
    onlineMinutes: number;
    online: boolean;
    logins: number;
    denied: number;
    sessions: AccessSession[];
  }[];
}

export interface AccessCalendar {
  user: AccessPerson & { lastLoginAt: string | null };
  month: string;
  timezone: string;
  days: { date: string; onlineMinutes: number; logins: number; denied: number }[];
  sessions: AccessSession[];
}

export const useAccessPeople = () => useQuery({ queryKey: ['access-log', 'people'], queryFn: () => api<AccessPerson[]>('/access-log/people') });
/** Dia de hoje atualiza sozinho (quem está online muda). */
export const useAccessDay = (date: string, live: boolean) =>
  useQuery({ queryKey: ['access-log', 'day', date], queryFn: () => api<AccessDay>(`/access-log/day?date=${date}`), refetchInterval: live ? 60_000 : false });
export const useAccessCalendar = (userId: string | null, month: string) =>
  useQuery({ queryKey: ['access-log', 'user', userId, month], queryFn: () => api<AccessCalendar>(`/access-log/user/${userId}?month=${month}`), enabled: !!userId });
