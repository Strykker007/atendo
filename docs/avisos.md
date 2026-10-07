# Avisos do sistema

Avisos globais do dono do sistema (super_admin) para **todos os clientes**: manutenção programada, instabilidade de provedor, novidade. Não são de tenant.

## Modelo

`SystemNotice` (`system_notices`, migração `20261029000400_system_notices`): `id`, `title`, `message`, `type` (`INFO` | `WARNING` | `CRITICAL`), `active`, `createdAt`. Sem `tenantId` de propósito.

## API (`apps/api/src/modules/notices`)

| Método | Rota | Quem | |
|---|---|---|---|
| GET | `/notices/active` | todo usuário logado | ativos, mais novos primeiro (até 30) |
| GET | `/super-admin/notices` | super_admin | todos |
| POST | `/super-admin/notices` | super_admin | cria e emite `system_notice` |
| PATCH | `/super-admin/notices/:id` | super_admin | `{active}` |

Tempo real: todo socket autenticado entra na sala `global` além da `tenant:<id>`; `ConversationsGateway.emitSystemNotice` emite nela (funciona também a partir do worker, via Redis).

## Front

- **Popup** (`components/layout/SystemNotices.tsx` → `NoticePopups`): topo central, cor pelo tipo, some em 14 s ou no X. Só aparece para quem está conectado na hora; quem entra depois vê pelo sino.
- **Sino** (`NoticeBell`): o app não tem barra superior, então ele fica **no topo do menu lateral**, ao lado da logo (recolhido: abaixo do botão de expandir). Badge = avisos ativos mais novos que o último visto; "visto" é por navegador (`localStorage`, `atendo:pref:notices-seen`) — aviso global não tem dono, não vale tabela de leitura por usuário.
- **Tela do dono**: menu *Avisos* (`/avisos`) — publicar (tipo, título, mensagem) e ativar/desativar.
- Desativar tira do sino no próximo refetch (5 min ou ao recarregar); reativar não reabre o popup.
