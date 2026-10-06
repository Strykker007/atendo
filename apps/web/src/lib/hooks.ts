'use client';
/**
 * Ponto único de importação dos hooks.
 *
 * O arquivo tinha 584 linhas com tudo junto, e toda tela importava dele. Quebrei por domínio
 * e mantive este barril para nenhuma tela precisar mudar de import — a organização é interna,
 * não um recado para quem consome.
 */
export * from './hooks/core';
export * from './hooks/numeros';
export * from './hooks/tags';
export * from './hooks/equipe';
export * from './hooks/respostas';
export * from './hooks/perfis';
export * from './hooks/relatorios';
export * from './hooks/cobranca';
export * from './hooks/fluxos';
export * from './hooks/agenda';
export * from './hooks/ia';
export * from './hooks/configuracoes';
export * from './hooks/kanban';
export * from './hooks/departamentos';
export * from './hooks/campos';
export * from './hooks/agendadas';
