# Desativar cliente

Tela **Clientes** (dono do sistema): botão **Desativar/Ativar** na linha ou campo **Acesso** no *Editar*. Desativado, o cliente **não ocupa servidor nem gera custo**; conversas, contatos e histórico ficam guardados. Código: `apps/api/src/modules/tenants/tenant-lifecycle.module.ts`.

## O que a desativação faz

| Parte | Efeito |
|---|---|
| Cliente | `tenants.isActive = false`, `deactivatedAt` |
| Equipe | refresh tokens revogados e sessões cortadas na hora (`ShiftAccessService.cutSessions`); login, renovação e troca de empresa respondem 403 *"Esta empresa está desativada"* (`AuthService.assertTenantActive`). **Donos do sistema** (`super_admin` ou `isSystemOwner`) continuam entrando |
| Números | `isActive = false`, `suspendedAt`, `status = disconnected`. **QR (Evolution): a instância é excluída** (`provider.destroy` — sem memória nem socket). Meta: só deixa de ser processado |
| Recebimento | `InboundProcessor` ignora mensagem de número com `suspendedAt` (nada gravado, nada respondido) |
| Envio | `UsageService.canSend` recusa: *"Cliente desativado: o envio está bloqueado"* — vale para chat, robô, agendadas, pesquisas, disparos |
| Automação | `FlowRun` em andamento/esperando/pausado → `stopped` (`error = 'cliente desativado'`); campanhas `scheduled`/`running` → `paused` |
| Rotinas | números inativos saem de saúde, sincronização de agenda e reconexão; o cliente sai de mensalidade por Pix, lembretes, fechamento, relatório diário e padrão de modelos (já filtravam `tenant.isActive`) |
| Cobrança | **a tela pergunta** se cancela a assinatura. Sim: `StripeService.cancelForDeactivation` cancela no Asaas/Stripe e marca `canceled`. Se o gateway recusar, a desativação vale e a tela avisa |

## Reativar

`POST /tenants/:id/reactivate`: `isActive = true`; números com `suspendedAt` voltam (`isActive = true`, desconectados) — os de QR precisam **ler o QR de novo** em Números. Fluxos parados não voltam; campanhas ficam pausadas (retomar à mão). Assinatura cancelada não volta sozinha: atribua o plano em Clientes.

## API (super_admin)

| Método | Rota | Corpo / retorno |
|---|---|---|
| POST | `/tenants/:id/deactivate` | `{cancelBilling?: boolean}` → `{users, numbers, flowRuns, campaigns, billing: {canceled, error?}}` |
| POST | `/tenants/:id/reactivate` | → `{numbers}` |

`PATCH /tenants/:id` não muda mais `isActive` (400 apontando a rota certa) — os efeitos acima só saem pelas rotas próprias.

## Modelo

`tenants.deactivatedAt`, `whatsapp_numbers.suspendedAt` (migration `20270124000000_tenant_deactivation`, aditiva).
