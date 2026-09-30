# 16 — Lacunas para o primeiro cliente

Avaliação do documento *"funções principais"* (2026-09-28) contra o que o Atendo já faz.
Serve para decidir o que construir antes de colocar um cliente pagante no ar.

## Já temos

| Item do documento | Onde está |
|---|---|
| Separar atendimentos por usuário ("aba atendendo") | Posse do atendimento: assumir atômico, transferir, devolver, visão por atendente ([01](01-visao-geral.md)) |
| Cadastro de valores/planos | Planos + Stripe ([05](05-planos-e-cobranca.md)) |
| Construção de fluxos | Editor visual + motor ([10](10-fluxos-de-automacao.md)) |
| Menu/chatbot, ações diversas | Blocos Menu, Pergunta, Condição, Ação, Aguardar, Agendar, IA |
| Disparar fluxo por frase específica | Gatilho por palavra-chave (só modo "contém") |
| Fluxo de boas-vindas para contato novo | Gatilho `new_conversation` |
| Relatórios para gestão | Visão pronta + construtor + CSV ([08](08-frontend.md)) |
| API oficial (Meta) e não oficial (Evolution) | Adapters trocáveis por config ([04](04-providers-whatsapp.md)) |
| Assistente de IA no fluxo | Bloco IA ([15](15-ia.md)) |

## Falta — e por que importa

Ordenado por **risco de perder o cliente**, não por esforço.

### 1. Anti-banimento no envio — **FEITO** (2026-09-28)

Intervalo aleatório entre envios por faixa, teto diário por número e aquecimento
automático de número novo. Configurável na tela Números. Ver [04](04-providers-whatsapp.md).

### 2. Transmissão / disparo em massa

Não existe. O documento pede envio por lista, por etiqueta e por contatos selecionados,
com atraso configurável, restrição a horário comercial e teto diário. É provavelmente a
funcionalidade mais vendável da lista, e depende do item 1 para não queimar o número.

### 3. Horário de funcionamento do tenant — **FEITO** (2026-09-28)

Em **Configurações → Horário de funcionamento**: intervalos por dia da semana (vários por
dia, para almoço), fuso do cliente e a chave **Desativar atendimento** para feriado/férias.
A condição "horário comercial" dos fluxos passa a usar essa configuração quando o bloco não
tem horário próprio. Sem nenhum intervalo cadastrado, considera-se sempre aberto — cliente
que não configurou não pode ficar com o atendimento travado.

O fuso saiu de `scheduling_settings` e virou do cliente (`tenant_settings`): é do negócio,
não de um módulo. A agenda passou a ler de lá.

### 4. Fluxos padrão do tenant — **FEITO** (2026-09-28)

Boas-vindas, conversa finalizada e resposta padrão (com período de inatividade), mais o
aviso de fora do expediente. Em **Configurações → Fluxos padrão**. Ver [10](10-fluxos-de-automacao.md).

### 5. Encerramento com resultado — **FEITO** (2026-09-28)

Ao encerrar, o atendente registra comprou (com valor) ou não comprou (com motivo), e pode
disparar um fluxo de finalização. Relatórios ganharam faturamento, taxa de conversão e as
métricas `revenue`/`won`/`lost`/`win_rate`.

### 6. Distribuição automática (call center)

Round-robin entre atendentes online. Já estava no roadmap; o documento confirma.

### 7. Restrição de usuário por número

Definir no perfil do atendente quais conexões ele opera. Necessário assim que o cliente
tem mais de um número e equipes diferentes.

### 8. Campos fixos no cadastro do contato

Endereço, e-mail, observações 1 e 2. Hoje o contato só tem nome, telefone e tags.

### 9. Mídia — **parcial** (2026-09-30)

**No chat, feito:** atalhos de Foto, Vídeo, Arquivo e Áudio acima do campo de texto, e
**gravação de áudio pelo navegador**, que não existia. Enviar e reproduzir mídia já
funcionava, mas ficava escondido atrás de um clipe que ninguém achava.

**Respostas rápidas com anexo, feito** (2026-09-30): cada resposta pode levar áudio, foto,
vídeo ou documento, com o texto virando legenda. Ver [08](08-frontend.md).

**Falta:** figurinhas e converter HEIC do iPhone, que hoje é recusado.

### 10. Replicar fluxos e respostas rápidas por nicho

Duplicar e exportar/importar, para montar um pacote "barbearia" e aplicar em cada cliente
novo. É o que faz a operação escalar sem retrabalho.

### 11. Plano customizado por cliente

A tela de referência mostra limites e funcionalidades editáveis **por empresa**, além do
plano, com preço próprio. Hoje os limites vivem no plano; o cliente herda tudo.

### 12. Kanban de conversas

Não existe.

### 13. Grupos

Hoje mensagens de grupo são descartadas na entrada. O documento pede liberar grupos
específicos.

### 14. Cobrança por conversa — **FEITO** (2026-09-28); vencimento aberto pendente

O ledger passou a registrar **conversa e mensagem**, e `PlanLimits.billingUnit` escolhe qual
limita o plano. Falta ainda a carência de 3 dias antes de faturar o cliente novo.

### 15. Blocos e ações que a referência tem e nós não

Chamar outro fluxo, departamentos, notificar membro da equipe, randomizador, variável
global; e no bloco de conteúdo: arquivo, vídeo, figurinha e contato (hoje o editor só
manda texto).

## Corte sugerido para o primeiro cliente

**Obrigatório:** 1 (anti-banimento), 3 (horário de funcionamento), 4 (fluxos padrão),
5 (encerramento com resultado).

**Depende do que o cliente faz:** 2 (transmissão) se ele vende por campanha; 6 e 7 se
tiver equipe; 8 e 9 se o atendimento for consultivo.

**Pode esperar:** 10 a 15 — importam a partir do segundo ou terceiro cliente.
