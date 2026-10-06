# Campos personalizados da ficha do contato

A ficha tem campos fixos (nome, e-mail, endereço, observações 1 e 2) e **campos livres por
contato**: nem todo cliente tem os mesmos dados (CPF de um, placa do carro de outro), então
cada ficha tem os seus. Não existe cadastro de campos da empresa.

## Na tela

"Preencher ficha" (`ContactSheet`) → seção **Outras informações deste cliente**:
**+ Adicionar campo** cria uma linha com nome, tipo (Texto, Número, Data) e valor; a lixeira
remove. Ao digitar o nome aparecem os nomes já usados em outros clientes (para não virar
"CPF"/"cpf"/"C.P.F."); escolher um deles traz o tipo junto. Trocar o tipo limpa o valor.
Sem `contacts.edit` tudo fica só para leitura.

## Modelo e regras

- `contact_attributes`: `tenantId`, `contactId`, `label`, `type`, `value` (texto; data =
  `AAAA-MM-DD`, número com ponto), `position` (ordem da tela). Apagar o contato apaga os campos.
- Salvar **substitui** a lista inteira do contato. A ficha só deixa salvar depois de carregar a
  lista atual, para não apagar o que já existia.
- Linha totalmente em branco é ignorada; nome sem valor, valor sem nome, número/data inválidos
  e nome repetido no mesmo contato são recusados (400).
- Até 50 campos por contato.

## Ainda não

- Não aparecem no resumo de uma linha do cabeçalho do chat.

## Como variável

Cada campo vira `{{contact.<chave>}}` em fluxos, respostas rápidas, campanhas, chat e
mensagens agendadas — "Placa do carro" → `{{contact.placa_do_carro}}`. O menu "Inserir
variável" lista os nomes já usados na empresa. Contato sem o campo recebe vazio. Ver
[Variáveis](variaveis.md).

Endpoints em [07-api](07-api.md). Histórico: a primeira versão (campos definidos pela empresa
em Configurações, migração `20261014000000_contact_custom_fields`) foi trocada por esta na
`20261015000000_contact_attributes_por_contato`.
