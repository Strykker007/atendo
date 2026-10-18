# Documentação do Atendo

| Documento | Para quem | O que responde |
|---|---|---|
| [01 — Visão geral](01-visao-geral.md) | Todos | O que é o produto, quem usa, como os conceitos se relacionam |
| [02 — Rodando local](02-rodando-local.md) | Dev | Passo a passo do zero até ver o painel funcionando, e como resolver os erros comuns |
| [03 — Arquitetura](03-arquitetura.md) | Dev | Monorepo, módulos, fluxo de uma mensagem, filas, tempo real, segurança |
| [04 — Providers WhatsApp](04-providers-whatsapp.md) | Dev / Operação | Como funcionam Meta e Evolution, como trocar, como autenticamos webhooks |
| [05 — Planos, uso e cobrança](05-planos-e-cobranca.md) | Dev / Negócio | Ledger, quota, alertas, excedente, como não ter prejuízo |
| [06 — Modelo de dados](06-modelo-de-dados.md) | Dev | Tabelas, relações e por que cada uma existe |
| [07 — API](07-api.md) | Dev / Integrações | Endpoints, autenticação, exemplos com curl |
| [08 — Front-end](08-frontend.md) | Dev | Estrutura do Next, layout de colunas, estado, tempo real |
| [09 — Roadmap](09-roadmap.md) | Todos | O que está pronto e o que falta, em ordem |
| [10 — Fluxos de automação](10-fluxos-de-automacao.md) | Dev / Cliente | Blocos, gatilhos, motor, editor, API |
| [Fluxos — referência técnica](fluxos.md) | Dev | Arquitetura editor/motor, como criar um bloco, status dos blocos do construtor |
| [Envio — fila, ordem e ritmo](envio.md) | Dev / Operação | Fila única, ordem por conversa, limites por conexão, retry, reconexão, respostas rápidas e valores padrão |
| [Empresas e unidades](empresas.md) | Dev / Cliente | Matriz e filiais: números por empresa, quem opera cada uma, seletor do menu e limite do plano |
| [Grupos restritos](grupos.md) | Dev / Cliente | Opt-in estrito de grupos do WhatsApp: descarte no webhook, grupos só como destino de transmissão, travas antiban |
| [Departamentos](departamentos.md) | Dev / Cliente | Departamentos, quem vê qual fila, transferência entre departamentos e integração com o Distribuidor/Ação |
| [Editar mensagem enviada](editar-mensagens.md) | Dev / Cliente | Permissão `conversations.edit_message`, prazo de 15 min do WhatsApp, Evolution × Meta, auditoria do texto anterior |
| [Apagar mensagem e limpar histórico](apagar-mensagens.md) | Dev / Cliente | Quem pode apagar, apagar para todos (Evolution) × só no painel (Meta), registro de auditoria e conteúdo original |
| [Histórico anterior ao painel](historico-de-mensagens.md) | Dev / Cliente | Mensagens de antes de conectar o número, trazidas da Evolution conforme a pessoa rola: sem duplicar, sem automação, sem cobrança |
| [Foto protegida](foto-protegida.md) | Dev / Cliente | Foto de remédio/receita por link com validade em vez de mídia no WhatsApp: menos risco de banimento |
| [Variáveis `{{...}}`](variaveis.md) | Dev / Cliente | Variáveis comuns a fluxos, respostas rápidas, campanhas e chat: empresa, saudação, primeiro nome, campos da ficha |
| [Agendamento de mensagens](agendamento-de-mensagens.md) | Dev / Cliente | Atendente agenda uma mensagem para sair depois; job de 1 minuto, regras de envio, cancelamento |
| [Orçamentos](orcamentos.md) | Dev / Cliente | Orçamento gerado no chat vira link seguro `/o/:hash`; página pública com Pix, pagar agora e envio de comprovante |
| [Contatos isentos de ticket](contatos-isentos.md) | Dev / Cliente | Telefones que nunca abrem atendimento: aba Livres, sem fila nem automação, fora dos relatórios |
| [Chat interno da equipe](chat-interno.md) | Dev / Cliente | Widget flutuante de conversa direta/grupo entre a equipe, histórico permanente e auditoria |
| [Avisos do sistema](avisos.md) | Dev / Dono | Avisos globais do super_admin: popup ao vivo, sino no menu e tela de publicação |
| [Metas de consultores](metas.md) | Dev / Cliente | Meta mensal por consultor (padrão + individual), atingimento, ritmo esperado, projeção e ranking |
| [Relatórios sem pico](relatorios-desempenho.md) | Dev / Ops | Limite de consultas simultâneas, cache curto, teto de período e regras para relatório novo |
| [Pesquisa de satisfação](pesquisa-de-satisfacao.md) | Dev / Cliente | CSAT/NPS no encerramento: escalas, recusa sem insistência, interceptação da resposta, relatório por consultor |
| [Escalas e acessos temporários](escalas.md) | Dev / Cliente | Escalas 12x36/44h/custom, login bloqueado fora do turno, liberação de plantão e contas temporárias que expiram sozinhas |
| [Horários e boas-vindas](horarios.md) | Dev / Cliente | Quadro de horários, faixas, estabelecimento fechado, boas-vindas e integração com fluxos |
| [11 — Infra de produção e escala](11-infra-producao.md) | Dev / Ops | Docker, compose de produção, dimensionamento para 500 clientes, migração gradual |
| [12 — Contas e e-mail](12-contas-e-email.md) | Dev / Operação | Convites, esqueci/trocar senha, e-mails transacionais (Resend) |
| [13 — Agendamento](13-agendamento.md) | Dev / Cliente | Profissionais, serviços, agenda, marcação pelo WhatsApp, lembretes ao cliente e ao profissional |
| [14 — Qualidade e observabilidade](14-qualidade-e-observabilidade.md) | Dev / Ops | Testes automatizados, logs estruturados, erros e rastreio em produção |
| [15 — IA](15-ia.md) | Dev / Negócio | Copiloto do atendente, bloco de IA nos fluxos, guarda-corpos, custo e cobrança por interação |
| [16 — Lacunas para o primeiro cliente](16-lacunas-primeiro-cliente.md) | Produto | O que o documento de funções pede, o que já existe e o que falta, em ordem de risco |
| [17 — Entrada em produção](17-entrada-em-producao.md) | Você / Ops | Checklist de go-live: o que criar no Stripe, na Meta, no Resend e no servidor |
| [18 — Perfis de acesso](18-perfis-de-acesso.md) | Dev / Produto | Permissões configuráveis por cliente: catálogo, guards e as travas contra escalada |
| [20 — Modelos de perfil](20-modelos-de-perfil.md) | Dev / Produto | Verticais (Farmácia, Clínica…): perfis, respostas e fluxos com que o cliente nasce; import/export em JSON |
| [19 — Marcas e vertentes](19-marcas-e-vertentes.md) | Dev / Negócio | White-label: como subir uma nova vertente (ex.: clínicas) com outra logo, cores e domínio, e o que ainda é compartilhado |
| [21 — Site (landing page)](21-site.md) | Dev / Marketing | App `apps/site`: landing pública da VogoChat em domínio próprio, seções, onde editar textos, deploy |
| [22 — Agente de IA](22-agente-ia.md) | Dev / Produto | Plano: agente que atende e negocia com ferramentas e limites, e onde mais a IA entra no produto |
| [23 — Evolution: desempenho](23-evolution-desempenho.md) | Ops | Incidente de CPU de 16/10/2026: índices no banco da Evolution, teto do histórico, manutenção de `shared_buffers` e limite de CPU |
| [24 — Auditoria da Evolution](24-auditoria-evolution.md) | Dev / Ops / Negócio | Banimentos, desconexões e webhooks travando: causas confirmadas no código da Evolution 2.3.7, correções priorizadas e alternativas (base segue no QR; Cloud API só por cliente) |
| [25 — Atualização da Evolution e CVE-2026-48063](25-estrategia-atualizacao-evolution.md) | Dev / Ops | 2.3.7 × 2.4.0-rc2 × develop, Baileys rc.9→rc14, backport da CVE, matriz de risco, testes e piloto (proposta aguardando autorização) |
| [26 — Backport da CVE-2026-48063](26-backport-cve-2026-48063.md) | Dev / Ops | Patches no build da Evolution 2.3.7 (Baileys rc.9), testes de regressão, evidências, deploy e rollback |

Convenção: código em inglês, comentários e documentação em português.
