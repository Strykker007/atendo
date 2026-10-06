/**
 * Permissões: o que um usuário pode fazer dentro do cliente dele.
 *
 * O papel (`Role`) continua existindo, mas só decide duas coisas: quem é o dono do sistema
 * (`super_admin`) e qual o conjunto inicial de permissões. O que vale na hora de autorizar é
 * a lista de permissões do **perfil de acesso**, que cada cliente monta como quiser —
 * uma farmácia com três gerentes iguais e outra com um "atendente líder" sob medida não
 * cabem num enum fechado.
 *
 * A lista é **fechada**: perfil nunca guarda permissão que o código não conheça, senão vira
 * texto livre no banco e ninguém mais sabe o que autoriza o quê.
 */

export const PERMISSIONS = {
  'conversations.view_all': 'Ver os atendimentos de toda a equipe',
  // quem atende sempre pode transferir ou devolver o SEU atendimento; esta permissão é
  // para mexer no atendimento dos outros
  'conversations.transfer_any': 'Transferir ou devolver atendimento de outra pessoa',
  'conversations.internal_note': 'Escrever notas internas',
  // quem enviou sempre pode apagar a SUA mensagem recente; esta permissão é para apagar a dos
  // outros, a do robô, a recebida e a antiga (docs/apagar-mensagens.md)
  'conversations.delete_message': 'Apagar qualquer mensagem (de outras pessoas, do robô, recebidas ou antigas)',
  'conversations.delete_chat': 'Limpar o histórico de uma conversa',
  'conversations.view_deleted': 'Ver o conteúdo original de mensagens apagadas',
  // vendida à parte: o cliente só tem se o perfil dele tiver (docs/agendamento-de-mensagens.md)
  'conversations.schedule_message': 'Agendar mensagens para o cliente',
  'contacts.edit': 'Editar a ficha do contato',
  'tags.manage': 'Criar e editar etiquetas',
  'quick_replies.manage': 'Criar e editar respostas rápidas',
  'flows.manage': 'Criar, editar e importar fluxos de automação',
  'campaigns.manage': 'Criar e disparar transmissões em massa',
  'agenda.manage': 'Configurar profissionais, serviços e horários da agenda',
  'reports.view': 'Ver relatórios do cliente',
  'team.manage': 'Convidar, editar e desativar membros da equipe',
  'profiles.manage': 'Criar e editar perfis de acesso',
  'settings.manage': 'Mudar horário de funcionamento e fluxos padrão',
  'numbers.manage': 'Conectar e configurar números de WhatsApp',
  'billing.manage': 'Ver e mudar o plano, acessar faturas',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Agrupamento só para a tela de edição do perfil não virar uma lista de 14 itens soltos. */
export const PERMISSION_GROUPS: { label: string; items: Permission[] }[] = [
  { label: 'Atendimento', items: ['conversations.view_all', 'conversations.transfer_any', 'conversations.internal_note', 'conversations.delete_message', 'conversations.delete_chat', 'conversations.view_deleted', 'conversations.schedule_message', 'contacts.edit'] },
  { label: 'Conteúdo', items: ['tags.manage', 'quick_replies.manage', 'flows.manage', 'agenda.manage', 'campaigns.manage'] },
  { label: 'Gestão', items: ['reports.view', 'team.manage', 'profiles.manage', 'settings.manage'] },
  { label: 'Conta', items: ['numbers.manage', 'billing.manage'] },
];

/**
 * Permissões de quem ainda não tem perfil de acesso. É o que mantém o sistema funcionando
 * igual para todo mundo que existia antes dos perfis — e o ponto de partida ao criar um
 * perfil novo a partir de um papel.
 *
 * `super_admin` não aparece: o dono do sistema não é membro de cliente nenhum e passa por
 * fora da checagem (ver `permissions.ts` na API).
 */
export const DEFAULT_PERMISSIONS: Record<'tenant_admin' | 'manager' | 'agent', Permission[]> = {
  tenant_admin: [...ALL_PERMISSIONS],
  manager: ['conversations.view_all', 'conversations.transfer_any', 'conversations.internal_note', 'conversations.delete_message', 'conversations.delete_chat', 'conversations.view_deleted', 'contacts.edit', 'tags.manage', 'quick_replies.manage', 'flows.manage', 'agenda.manage', 'campaigns.manage', 'reports.view', 'team.manage', 'settings.manage'],
  // o padrão do atendente reproduz EXATAMENTE o que ele já podia antes dos perfis: respostas
  // rápidas e relatórios nunca foram restritos, e tirá-los agora seria perder acesso numa
  // migração. Quem quiser restringir, cria um perfil sem eles. Nota interna entrou depois
  // (passagem de bastão entre atendentes — ver docs/08-frontend.md).
  agent: ['conversations.internal_note', 'contacts.edit', 'quick_replies.manage', 'reports.view'],
};

/** Nomes dos perfis criados junto com o cliente. */
export const SYSTEM_PROFILES: { name: string; role: keyof typeof DEFAULT_PERMISSIONS }[] = [
  { name: 'Administrador', role: 'tenant_admin' },
  { name: 'Gerente', role: 'manager' },
  { name: 'Atendente', role: 'agent' },
];

export const isPermission = (v: unknown): v is Permission => typeof v === 'string' && v in PERMISSIONS;
