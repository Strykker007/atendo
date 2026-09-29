# 12 — Contas e e-mail

## Como as contas nascem

| Conta | Quem cria | Como |
|---|---|---|
| Dono do sistema | `seed` (uma vez) | `admin@atendo.local` — troque a senha em *Configurações → Segurança* |
| Cliente + admin | Dono, em *Clientes → Novo cliente* | Sem senha informada → o admin recebe **convite por e-mail** e cria a própria senha. Com senha → criado direto |
| Gerente / atendente | Admin (gerente cria só atendentes), em *Equipe → Novo membro* | Padrão: **convite por e-mail** (link válido 3 dias). Opção "Definir a senha agora" para o modo antigo |

Convite pendente aparece na Equipe como "convite pendente" com botão **Reenviar convite**. Quem ainda não definiu senha não consegue logar (mensagem explica).

## Fluxos de senha

- **Esqueci minha senha** (link no login → `/esqueci-senha`): sempre responde "enviado" (não revela se o e-mail existe); link válido 2 h.
- **Redefinir** (`/redefinir-senha?token=…`): define a nova senha e **revoga todas as sessões**.
- **Convite** (`/convite?token=…`): cria a senha e ativa a conta.
- **Trocar minha senha** (*Configurações → Segurança*): pede a atual; revoga as outras sessões. O dono "entrando como" cliente não consegue trocar a senha do cliente.

Tokens (`auth_tokens`): 32 bytes aleatórios, só o **hash** no banco, uso único, expiram, e um novo pedido invalida os anteriores. Endpoints com throttling (5–10/min).

## E-mail transacional

`common/mail/mail.service.ts` usa **Resend** (`RESEND_API_KEY`, `MAIL_FROM`). Sem a chave (dev), o e-mail inteiro vai para o **log da API** — os links de convite/reset aparecem no terminal e o fluxo funciona igual.

Configurar: crie a conta em resend.com, verifique o domínio (registros DNS que eles mostram), gere a API key. `MAIL_FROM="Atendo <no-reply@seudominio.com.br>"`.

E-mails enviados hoje:

| Quando | Para | Assunto |
|---|---|---|
| Convite de equipe / admin de cliente | convidado | "Fulano convidou você para a equipe de X no Atendo" |
| Esqueci a senha | usuário | "Redefinir sua senha no Atendo" |
| 80% e 100% de mensagens/templates do plano | admins do tenant | "Você usou 80% das mensagens…" / "Limite … atingido — envio bloqueado" |
| Cobrança do Stripe falhou | admins | "Não conseguimos cobrar a sua assinatura" (com link da fatura e data-limite) |
| Carência venceu → suspensão | admins | "Assinatura suspensa — envio bloqueado" |

Todos em texto simples + HTML mínimo (link vira botão). Falha de envio nunca derruba a operação (é `catch` + log).

## API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/forgot` `{email}` | Sempre 200 |
| POST | `/auth/reset` `{token, password}` | |
| POST | `/auth/accept-invite` `{token, password}` | Devolve `{email}` |
| POST | `/auth/change-password` `{current, password}` | Logado |
| POST | `/tenants/me/agents` sem `password` | Cria + convite; com `password` cria direto |
| POST | `/tenants/me/agents/:id/resend-invite` | |
| POST | `/tenants` sem `adminPassword` | Cria cliente + convite ao admin |


## Funcionar sem e-mail configurado

O convite **não depende de e-mail**. Ao criar um atendente sem senha, a API devolve o
`inviteLink`, e a tela de Equipe tem **"Copiar link do convite"** — o admin manda por
WhatsApp. O link vale 3 dias e gerar um novo invalida o anterior.

Isso existe porque e-mail é uma dependência externa que atrasa a entrada de um cliente
(precisa de domínio verificado) e, mesmo configurado, cai em spam. Com o link, o cliente
cadastra a equipe dele no primeiro dia.

| Caminho | Precisa de e-mail? |
|---|---|
| Criar atendente e mandar o link do convite | não |
| Admin definir a senha do atendente direto (Equipe → Redefinir senha) | não |
| Usuário recuperar a própria senha ("esqueci minha senha") | **sim** |
| Alertas de plano, cobrança falhou e suspensão | **sim** |

Sem e-mail, quem esquece a senha depende de um admin redefinir. Para um cliente pequeno
isso se resolve; conforme a operação cresce, configure o Resend ([17](17-entrada-em-producao.md)).

> `passwordSetAt` é o que libera o login de quem foi convidado. Definir a senha pelo painel
> passou a marcá-lo — antes o usuário continuava travado na mensagem "use o link do convite",
> mesmo com senha definida pelo admin.
