# 39 — Análise do app na Meta (App Review) para o cadastro sem chaves

**Objetivo:** permitir que qualquer cliente conecte o número oficial clicando em **Números → Conectar com a
Meta**, sem colar token e IDs. O botão já existe ([cadastro incorporado](meta-cadastro-incorporado.md)), mas
hoje só funciona para quem tem função no app **vogochat plus** (ID `1864480281389703`). Para liberar a janela
para empresas de fora, a Meta exige **acesso avançado** às três permissões abaixo, aprovado na análise do
app, e o app registrado como **Tech Provider**.

| Permissão | Onde o Atendo usa (o que o vídeo precisa mostrar) |
|---|---|
| `whatsapp_business_management` | Lista e registra o número da WABA escolhida, inscreve o app nos webhooks da WABA (`subscribed_apps`) e lê os templates aprovados (Conversa → Enviar template) |
| `whatsapp_business_messaging` | Envia e recebe mensagens: template, resposta do cliente chegando pelo webhook e resposta do atendente |
| `business_management` | Lê o portfólio dono da WABA (nome e verificação) e mostra no cartão do número e no aviso de sucesso ([portfólio do cliente](meta-cadastro-incorporado.md#portfólio-do-cliente)) |

> Só peça permissão que o app usa de verdade e que aparece no vídeo. Permissão sem uso visível é motivo de
> recusa.

## 1. Antes de gravar

**Onde o botão aparece:** só em **produção**, em **Números → Adicionar número → Meta Cloud API**. Não
aparece em **Credenciais** de um número que já existe, que é só para trocar token e IDs. Também não aparece
no ambiente local, que não tem `META_APP_ID`, `META_ES_CONFIG_ID` e `META_APP_SECRET`. Antes da aprovação,
a janela da Meta funciona para quem tem função no app (administrador, desenvolvedor ou testador). É assim
que se grava o vídeo antes de ter o acesso avançado.

**Se a janela abrir mas der erro:**
- Confira se o seu usuário do Facebook tem função no app (*Funções do app*).
- Confira se o domínio `app.vogochatplus.com.br` está liberado para o SDK JS.
- Confira se a configuração do `META_ES_CONFIG_ID` é do tipo **WhatsApp Embedded Signup**.

Se mesmo assim não funcionar, grave o vídeo pelo caminho manual (*preencher manualmente*):
- O resto do roteiro não muda: cartão com o portfólio, templates e mensagens.
- Avise nas instruções de teste que o cadastro incorporado aguarda a aprovação.


- [ ] **Deploy** desta versão em produção. O portfólio no cartão só existe depois do deploy, e sem ele o
  vídeo não mostra o `business_management`.
- [ ] **Grave em `app.vogochatplus.com.br`**, não no ambiente local: o revisor confere o domínio.
- [ ] **Escolha um número que possa ser conectado na janela da Meta.** Pode ser um chip sem WhatsApp, que
  recebe o código por SMS ou ligação, ou um número já na WABA de teste. Se o número já tiver um cartão no
  Atendo, exclua o cartão antes, para a conexão acontecer do zero na gravação.
- [ ] **Webhook do 5447 voltou para a produção** (em 17/11 estava desviado para o túnel local). Se for usar
  esse número, confira.
- [ ] **Deixe um template aprovado** nessa WABA, por exemplo `hello_world`, e uma **forma de pagamento**
  cadastrada; sem ela o template não sai.
- [ ] **Deixe à mão um celular com WhatsApp** para receber e responder; ele aparece na gravação.
- [ ] **Navegador em inglês**, se der. Se não, coloque **legendas em inglês** em todas as cenas.
- [ ] **Grave a tela inteira** em 1080p, com o cursor visível e sem cortes no meio das ações. Pode
  acelerar as esperas. Duração ideal: 3 a 5 min.
- [ ] **Crie um login de revisor:** uma empresa de demonstração no Atendo com um usuário administrador
  (e-mail e senha). A Meta pede essas credenciais para testar.

## 2. Roteiro do vídeo (um vídeo, enviado nas três permissões)

| # | Tempo | Tela | O que fazer | Legenda (inglês) |
|---|---|---|---|---|
| 0 | 0:00 | Cartão de abertura | Texto parado por 3 s | "Vogo Chat Plus — customer service platform for businesses. This video shows how we use whatsapp_business_management, whatsapp_business_messaging and business_management." |
| 1 | 0:05 | `app.vogochatplus.com.br/login` | Entrar como administrador da empresa | "A business admin logs into Vogo Chat Plus." |
| 2 | 0:15 | Números → Adicionar número → Meta Cloud API | Dar o nome ao número e clicar em **Conectar com a Meta** | "The admin connects their own WhatsApp Business Account through Meta Embedded Signup — no tokens to copy." |
| 3 | 0:25 | Janela da Meta | Login no Facebook. **Pare 2–3 s na tela que lista as permissões** | "The admin reviews and grants the requested permissions." |
| 4 | 0:40 | Janela da Meta | **Escolher o portfólio**, depois a conta do WhatsApp (WABA) e o número; concluir | "business_management: the admin selects the business portfolio that owns the account." |
| 5 | 1:10 | Atendo, Números | Aviso "Número conectado pela Meta · portfólio X". **Aproximar** o cartão: status **Conectado** e a linha **Portfólio X · verificado** | "business_management: we read the selected business portfolio (name and verification status) and show it on the number card. whatsapp_business_management: we registered the phone number and subscribed our app to the account's webhooks." |
| 6 | 1:35 | Conversas → Nova conversa | Escolher o contato do celular de teste, abrir **Enviar template**. **Mostrar a lista** de templates | "whatsapp_business_management: we read the account's approved message templates." |
| 7 | 1:55 | Atendo | Escolher o template e enviar | "whatsapp_business_messaging: the agent sends an approved template to start the conversation." |
| 8 | 2:05 | Celular (filmado ou espelhado) | O template chega | "The customer receives the message on WhatsApp." |
| 9 | 2:15 | Celular → Atendo | Responder no celular; a mensagem aparece no Atendo na hora | "whatsapp_business_messaging: the reply arrives in the agent's inbox through the webhook." |
| 10 | 2:30 | Atendo → celular | O atendente responde com texto livre e ele chega no celular | "The agent answers within the 24-hour customer service window." |
| 11 | 2:45 | Cartão final | Texto parado por 3 s | "Our app only accesses the business portfolio and WhatsApp account the admin selected in Embedded Signup." |

Cena 4: se a janela não mostrar a escolha do portfólio (conta com um portfólio só), deixe a legenda e mostre
o portfólio na cena 5. O que importa ao revisor é **ver o dado sendo lido e exibido**.

## 3. Configurações do app (developers.facebook.com/apps/1864480281389703)

1. **Configurações do app → Básico**:
   - **Ícone** 1024×1024.
   - **URL da Política de Privacidade**: a do site já aprovada na verificação do portfólio.
   - **URL dos Termos de Serviço**.
   - **Instruções de exclusão de dados**: URL de uma página que explique como pedir a exclusão.
   - **Categoria**: *Business and Pages*.
   - **E-mail de contato**.
   - Salvar.
2. **Verificação da empresa**: o portfólio do sócio já é verificado; confirme que o app está ligado a ele
   (*Configurações → Básico → Verificação*).
3. **Modo do app: Ao vivo** (chave no topo).
4. **WhatsApp → Configuração**: confirme o webhook (`https://<api>/webhooks/meta`) com os campos `messages`,
   `account_update`, `smb_message_echoes`, `history` e `smb_app_state_sync`.
5. **Login do Facebook para Empresas → Configurações**: confirme que a configuração do `META_ES_CONFIG_ID`
   pede as três permissões e que o domínio `app.vogochatplus.com.br` está liberado para o SDK JS.

## 4. Pedir as permissões e enviar

1. **Análise do app → Permissões e recursos**. Para `whatsapp_business_management`,
   `whatsapp_business_messaging` e `business_management`, clique em **Solicitar acesso avançado**. Elas
   entram no pedido.
2. **Análise do app → Solicitações → Editar** o pedido. Para **cada** permissão:
   - **Descrição do uso**: cole o texto da seção 5.
   - **Vídeo**: envie o mesmo vídeo nas três (até 100 MB, mp4) e cite na descrição em que minuto aparece o
     uso daquela permissão.
   - Marque que concorda com as políticas de uso.
3. **Instruções de teste** (aparecem uma vez no pedido): cole o texto da seção 6, com o login do revisor.
4. **Tratamento de dados**: responda conforme a seção 7.
5. **Enviar para análise.** O prazo costuma ser de poucos dias. Se vier recusa, ela diz qual permissão e
   por quê: ajuste só aquele vídeo ou texto e reenvie.
6. **Depois da aprovação**:
   - **WhatsApp → Tech Provider**: conclua a etapa, incluindo a **verificação de acesso**, se a Meta pedir.
   - **Teste com um portfólio de fora** (uma empresa que não tenha função no app): ela deve conseguir
     conectar sozinha.

## 5. Textos "como o app usa esta permissão" (colar em inglês)

**whatsapp_business_management**
> Vogo Chat Plus is a customer service and sales inbox for businesses on WhatsApp. A business admin connects
> their own WhatsApp Business Account (WABA) through Embedded Signup. With whatsapp_business_management we:
> (1) read the phone numbers of the WABA the admin selected and register the chosen number on the Cloud API;
> (2) subscribe our app to that WABA's webhooks so incoming messages reach the agents' inbox; (3) read the
> account's approved message templates so agents can start conversations outside the 24-hour window. In the
> video: number connected at 1:10, templates listed at 1:35. We never create, edit or delete assets the
> business did not select.

**whatsapp_business_messaging**
> Agents use Vogo Chat Plus to talk to the business's customers on WhatsApp. With
> whatsapp_business_messaging we send messages on behalf of the connected business (approved templates to
> start a conversation and free-form replies inside the 24-hour customer service window) and receive the
> customers' messages and delivery statuses through webhooks. In the video: template sent at 1:55, customer
> reply received at 2:15, agent reply at 2:30. Messages are only sent by the business's own agents or by
> automations the business configured.

**business_management**
> After Embedded Signup, we use business_management to read the business portfolio that owns the connected
> WhatsApp Business Account (portfolio name and verification status, from the business_id returned by
> Embedded Signup or the WABA's owner_business_info). We show it on the number card and in the confirmation
> message so the admin can confirm the number was connected to the right company, which matters for
> customers that run several companies or branches in our platform. In the video: portfolio selected at
> 0:40 and displayed at 1:10. We only read the portfolio the admin selected; we do not create or change
> business assets, users or permissions.

## 6. Instruções de teste para o revisor

> Login: https://app.vogochatplus.com.br/login — e-mail: `<e-mail do revisor>` — senha: `<senha>`.
> 1. Go to "Números" (Numbers) → "Adicionar número" (Add number) → "Meta Cloud API" → "Conectar com a Meta"
>    (Connect with Meta) and complete Embedded Signup with a test WhatsApp Business Account.
> 2. The number card shows status "Conectado" (Connected) and the line "Portfólio <name> · verificado"
>    (portfolio name and verification status, read with business_management).
> 3. Open "Conversas" (Conversations) → new conversation → "Enviar template" (Send template): the list comes
>    from the account's approved templates (whatsapp_business_management). Sending it uses
>    whatsapp_business_messaging.
> The interface is in Portuguese; the video has English captions for every step.

## 7. Tratamento de dados (respostas)

| Pergunta | Resposta |
|---|---|
| Usa processadores de dados ou prestadores com acesso aos dados da Meta? | Sim: o provedor de hospedagem dos servidores (nuvem) e o de e-mail transacional (Brevo), só para operar o serviço |
| Quem é o responsável pelos dados? | A empresa dona do app (a do portfólio verificado) |
| País | Brasil |
| Recebeu pedidos de autoridades nos últimos 12 meses? | Não (confirme com o sócio) |
| Políticas para pedidos de autoridades | Sim: só com ordem judicial válida, avaliada pelo jurídico e limitada ao mínimo necessário |

Mantenha as respostas iguais às da política de privacidade publicada.
