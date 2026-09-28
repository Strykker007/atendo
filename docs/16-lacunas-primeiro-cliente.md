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

### 3. Horário de funcionamento do tenant

Hoje "horário comercial" só existe **dentro** de um bloco de condição, com valor digitado
em cada fluxo. Falta a configuração do tenant: aberto/fechado por dia da semana com hora
inicial e final, usada por fluxos, disparos e pela resposta automática de fora do horário.

### 4. Fluxos padrão do tenant

Temos gatilho de conversa nova e de palavra-chave. Faltam os outros dois do documento:
**resposta padrão** (qualquer mensagem que não casa com palavra-chave, após N horas de
inatividade) e **conversa finalizada** (cliente volta a escrever depois de encerrado).

### 5. Encerramento com resultado

Ao encerrar, poder escolher um fluxo de finalização e **registrar o desfecho**: comprou
(com valor) ou não comprou (com motivo). É o que transforma o relatório de conversas num
relatório de vendas — e é o argumento de renovação do cliente.

### 6. Distribuição automática (call center)

Round-robin entre atendentes online. Já estava no roadmap; o documento confirma.

### 7. Restrição de usuário por número

Definir no perfil do atendente quais conexões ele opera. Necessário assim que o cliente
tem mais de um número e equipes diferentes.

### 8. Campos fixos no cadastro do contato

Endereço, e-mail, observações 1 e 2. Hoje o contato só tem nome, telefone e tags.

### 9. Respostas rápidas com mídia

Hoje só texto. O documento pede texto, áudio, figurinha e imagem+legenda.

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

### 14. Cobrança por conversa e vencimento aberto

O ledger conta **mensagens**; o documento fala em **conversas** ("até 5000, depois sobe o
plano"). São unidades diferentes e mudam o preço. Também pede carência de 3 dias antes de
faturar o cliente novo.

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
