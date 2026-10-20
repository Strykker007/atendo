# Changelog

Uma entrada por versão publicada (`bash scripts/deploy.sh` gera a partir dos commits desde a
última tag). MAIOR.MENOR.CORREÇÃO — ver docs/17-entrada-em-producao.md#versões.

## 1.6.1 — 2026-10-20

- fix(chat): canal Suporte some do chat interno do cliente — fica só a comunicação da equipe
- fix(web): abas da lista de conversas sem aperto, Conversas livres nos filtros e contato isento com um clique
- docs(evolution): resultado do teste com WhatsApp real da v2.3.7-atendo.4
- fix(whatsapp): crase no comentário SQL fechava o template do Prisma.sql em receive-stall
- docs(evolution): registra o hotfix do cache IsOnWhatsapp aplicado em 19/10 22:23
- fix(evolution): imagem atendo.4 — credencial não sobrescrita, recebimento que não trava, cache IsOnWhatsapp desligado
- fix(whatsapp): nota interna não conta como sinal de vida na detecção de 'parou de receber'
- fix(web): tira os avisos de proteção contra bloqueio da tela do cliente
- feat(chat): chat da equipe do suporte entre super_admins
- fix(deploy): chaves nas variáveis antes de '…' — o bash 3.2 do macOS lia o caractere como parte do nome

## 1.6.0 — 2026-10-19

- feat(perfis): perfis padrão identificados por systemRole, renomeáveis e excluíveis
- fix(backup): retenção remota separada da local e rclone compatível com token R2 restrito ao bucket
- test: testes locais da estabilização — carga sintética, laboratório de reconexão e roteiro com WhatsApp real
- fix(evolution): guarda de conexão na 2.3.7 — uma conexão por instância, gerações de socket e backoff com jitter
- fix(whatsapp): prazos nas chamadas à Evolution, restart manual com trava, 402/403/406 como queda e ordem do connection.update
- fix(deploy): deploy comum não reconstrói nem reinicia a Evolution; deploy próprio com rollback
- fix(evolution): backport da CVE-2026-48063 no Baileys rc.9 e trava dos gatilhos de placeholder
- docs: estratégia de atualização da Evolution/Baileys e CVE-2026-48063 (proposta)
- docs(auditoria): base segue no QR; Cloud API só por cliente
- docs: auditoria da Evolution API (banimentos, desconexões, webhooks) e plano de migração
- feat(escalas): modo fim de turno com passagem travada e corte imediato de sessão
- feat(escalas): popup no login fora da escala com pedido de autorização ao gestor
- perf(tempo-real): espalha a recarga da reconexão e para de tentar com sessão encerrada
- feat: fila de suporte com tickets, aviso de sincronização ao reconectar número e tempo real que se recupera sozinho
- feat(escalas): escalas de trabalho, trava de login por turno e acessos temporários
- feat(chat-interno): clicar na barra minimizada reabre o chat
- feat: previews ricos no editor de fluxos, fluxos de encerramento e suporte entrando como cliente
- fix(web): aspas no JSX quebravam o build (react/no-unescaped-entities)

## 1.5.0 — 2026-10-17

- commit para validar
- feat(chat-interno): canal de suporte entre o cliente e o dono do sistema
- feat(ui): botão do chat da equipe redesenhado e menu "Mensagens agendadas"
- feat(chat-interno): responder mensagem, gerenciar membros e apagar grupo
- fix(chat-interno): trava magnética nas laterais e janela sempre encaixada na tela
- feat: contatos isentos de ticket e chat interno da equipe
- feat: import/export de contatos, transferência com aviso e alarme, teste de som
- wip: grupos restritos, ajustes da agenda, e-mail da equipe e ordenação (em andamento)
- feat(modelos): configurações de atendimento no modelo de perfil
- feat(conversas): excluir a conversa inteira, preservando o ledger de cobrança
- feat(agendadas): tela com todas as mensagens agendadas, filtros e cancelamento
- feat(admin): filtrar clientes por presença e conexão dos números
- feat(fluxos): ordenar a lista de fluxos arrastando
- feat(fluxos): menu do fluxo como botões clicáveis no QR (Evolution)
- feat(atendimento): encerramento sem venda e assinatura obrigatória
- feat(meta): templates com mídia e botões dinâmicos, inscrição na WABA e erros em português
- perf: painel recarrega menos, mídia com cache, backup de madrugada e teto de CPU no evolution-db

## 1.4.1 — 2026-10-16

- fix(envio): mensagem do atendente não espera atrás de automática segurada pela proteção

## 1.4.0 — 2026-10-16

- feat(chat): / no campo abre as respostas rápidas
- feat(fluxos): card Tratar dados com prévia em valores de exemplo
- fix(agenda): sincronização diária às 03:00, um aviso por conversa e nomes normalizados
- fix(whatsapp): teto de buscas de histórico, health check destrava pending_qr e evolution-db com mais memória
- feat(fluxos): transformar texto números JSON e datas no Manipulador
- feat(fluxos): salvar mapeamentos HTTP na ficha do contato
- fix(fluxos): adaptar painéis à largura lateral

## 1.3.1 — 2026-10-15

- fix(foto protegida): frase sem {{link}} ganha o link no final ao salvar, em vez de bloquear
- feat(pesquisas): seletor de variáveis nos textos da pesquisa (cliente, empresa, ficha, globais e quem atendeu) com prévia em valores de exemplo
- feat(páginas públicas): frase da foto protegida configurável ({{link}}, {{validade}}, {{primeiro_nome}}) e logo da empresa na foto protegida e no orçamento, com a marca do painel como padrão
- feat(fluxos): bloco Encerrar conversa pode enviar a pesquisa de satisfação (padrão ou escolhida), com aviso à equipe quando não sai

## 1.3.0 — 2026-10-15

- fix(chat): opção de foto protegida na tela de prévia do anexo (onde o arquivo escolhido é enviado)
- feat(site): landing da VogoChat em apps/site; índice de docs e variáveis de ambiente (site e orçamento de IA)
- fix(relatórios): campo Tag com a mesma altura e borda dos outros filtros
- feat: intervalo Moderado passa a 3–6s; agrupar por atendente vem marcado por padrão
- feat(relatórios): filtro de empresa na própria página (independe do menu) e empresa removida continua nos relatórios com o histórico dos números excluídos
- fix(relatórios): empresa selecionada inclui o histórico dos números excluídos dela — a soma das empresas volta a bater com Todas
- fix(chat): mídia antiga do histórico importado mostra que o WhatsApp não guarda mais o arquivo, em vez de 'indisponível'
- fix(chat): rota de mensagens assíncrona (sincronização do histórico)
- feat(chat): foto protegida — mídia de risco vai por link com validade (padrão 1 dia, escolhida pelo atendente) em vez de imagem no WhatsApp; página /f/:hash, revogar e visualizações na bolha
- feat(relatórios): relatórios respeitam a empresa selecionada; quadro Por empresa e dimensão Empresa no relatório personalizado
- feat(chat): histórico anterior ao painel trazido da Evolution conforme a conversa é rolada — sem duplicar, sem automação, sem cobrança e fora dos relatórios; mídia baixada em fila
- feat(ia): orçamento mensal de IA da plataforma com alertas 50/80/100% e corte ao esgotar; checklist da conta do fornecedor e plano do agente de IA
- fix(chat): foco do teclado ao alternar nota/mensagem e na legenda da mídia; atalho Orçamento ao lado da Nota interna; Pagamentos vai para Relatórios
- feat(ranking): pontuação composta 0–100 (faturamento, vendas, conversão suavizada, satisfação, TMA) com pesos ajustáveis; colunas Pontuação e Faturamento
- feat(relatórios): faturamento por origem (Pix automático × pago por fora × no encerramento) e estornos do período
- feat(orçamentos): tela Orçamentos (totais por situação, Pix automático × por fora, filtros) e selo Pago na lista de conversas
- feat(orçamentos): validade em horas (padrão até o fim do dia), cancelamento da cobrança no Asaas após 10 min de tolerância e conferência de pagamentos
- feat(orçamentos): pagamento vira venda na hora, encerramento absorve sem duplicar, estorno; motivo obrigatório separado por resultado; lista de conversas carrega as páginas seguintes
- feat(orçamentos): pagamento vira venda na hora, encerramento absorve sem duplicar, estorno; motivo obrigatório separado por resultado; lista de conversas carrega as páginas seguintes

## 1.2.1 — 2026-10-14

- fix(relatórios): filtro de consultor inclui atendimento que ele atendeu e a automação encerrou (targetId = quem atendeu), com backfill do histórico
- fix(modelos): Aplicar aos clientes casa motivo ignorando emoji/acento e renomeia o antigo (mantém histórico); filtro de motivo lista os desativados
- feat(orçamentos): Pix automático pelo Asaas da empresa (recurso pix_payments) — conexão com webhook cadastrado sozinho, cobrança gerada no orçamento com CPF da ficha do contato, baixa automática e aviso no painel

## 1.2.0 — 2026-10-14

- feat(orçamentos): orçamento no chat com link seguro /o/:hash, página pública com Pix, pagar agora e envio de comprovante
- feat(modelos): Aplicar aos clientes — replica perfis, motivos Comprou/Não comprou e tags do modelo em clientes existentes, com prévia
- feat(fluxos): bloco API externa (campos do JSON em variáveis, botão Testar), lixeira no card, seleção múltipla com barra de ações e novos atalhos
- feat(fluxos): Encerrar conversa com Comprou/Não comprou, motivo e valor (crédito do dono); conflitos de tag nos modelos de perfil

## 1.1.0 — 2026-10-14

- feat(relatórios): metas mensais por consultor, satisfação no ranking, ranking e pesquisa como recursos de plano e proteção dos relatórios contra pico
- feat(satisfação): até 2 perguntas adicionais, uma por vez, pela fila anti-bloqueio do número
- fix(números): remove intervalo Rápido (1–2s); mínimo no QR passa a 3s e quem estava nele vai para Moderado
- feat(satisfação): pesquisa CSAT/NPS no encerramento com recusa sem insistência e relatório por consultor
- feat: ranking de consultores, motivos de encerramento, transmissões, promoções e ajustes de plano
- feat: tags no encerramento e em massa, tags no modelo de perfil, Pix com "Copiar chave Pix", Evolution com patch de botões e restart
- feat(números): detecta número que envia mas parou de receber, avisa com passo a passo e botão Reiniciar conexão
- feat(modelos): cores dos motivos de não compra no modelo de perfil e no cliente que nasce dele
- feat(chat): som ao chegar mensagem para quem enxerga a conversa
- fix(equipe): tabela rola na horizontal em vez de cortar a coluna de ações (chave de redefinir senha)
- feat(respostas-rápidas): sai na hora, sem a contagem com Cancelar/Editar
- feat(encerramento): Encerrar verde e sempre à vista; Comprou exige valor, Não comprou exige motivo; cor por motivo
- feat(empresas): "Todas" para quem opera várias empresas; Equipe mostra o acesso efetivo
- feat(clientes): busca, filtros e ordenação na listagem do dono
- chore: permissão do Claude Code para consulta somente leitura em produção
- fix(billing): banner e chat usavam a unidade errada do plano ("92% do plano" falso)
- fix(web): aspas no JSX dos modelos de perfil quebravam o next build (react/no-unescaped-entities)
- feat(clientes): modelos de perfil (verticais) + cobrança híbrida/vencimentos; remove "não oficial" dos textos
- feat(marca): white-label — marcas/vertentes por domínio ou por deploy
- feat(conversas): marcar como não lida (conversa ou a partir de uma mensagem)
- feat(chat): velocidade dos áudios 1x/1.5x/2x, global e persistida
- fix(conversas): card da lista com a mesma altura e responsável em todas as abas
- fix(conversas): ler no celular atualiza as não-lidas do painel
- fix(envio): Tentar novamente manda de verdade e passa para a frente da fila
- fix(aquecimento): reconectar o mesmo telefone continua o aquecimento de onde parou
- fix(fluxos): disparo manual avisa quando o fluxo falha no começo
- fix(fluxos): fluxo disparado à mão conta como atendente no envio frio e avisa o que impede
- fix(conversas): recém-encerrada aparece em Encerradas sem F5
- fix(conversas): encerrar mantém a aba da lista e fecha a conversa
- feat(envio): mensagem segurada pela proteção do número sai em segundo plano sem expirar
- fix(aquecimento): limites da primeira semana mais folgados
- feat(envio): ✓ na hora, digitação por atendente, 10 contatos frios/dia e regras claras
- fix(encerrar): organiza o formulário de encerramento
- feat(motivos): nova lista padrão de motivos de perda e tela refeita
- feat(clientes): vencimento do plano e dados cadastrais do cliente
- feat(numeros): intervalo e limites de envio só para o dono do sistema
- feat(clientes): cliente novo nasce com os motivos de perda padrão
- Revert "feat(respostas): respostas rápidas padrão no cliente novo e fixar no topo"
- feat(respostas): respostas rápidas padrão no cliente novo e fixar no topo
- Revert "feat(fluxos): fluxos padrão no cliente novo e fixar fluxo no topo"
- feat(fluxos): fluxos padrão no cliente novo e fixar fluxo no topo
- feat(fluxos): excluir fluxos em lote com confirmação digitada
- fix(realtime): socket reconecta quando o dono entra num cliente
- fix(avisos): dono do sistema não recebe os próprios avisos globais
- fix(auth): sessão expirada leva ao login em vez de "Token inválido"
- fix(whatsapp): "digitando" não aparecia porque a conta conectava offline
- feat(whatsapp): "digitando" simulado nos envios do atendente que ninguém digitou
- feat(whatsapp): "digitando" do atendente com começo e fim e tempo humano na automação
- feat(empresas): dono gerencia empresas/unidades do cliente pela tela Clientes
- test(permissoes): atendente padrão tem numbers.manage desde agent_default_permissions
- feat(whatsapp): mais proteção anti-banimento no número não oficial
- feat: proteção anti-banimento na Evolution, motivos de perda e cobrança via Asaas (PIX + cartão)
- feat(avisos): avisos globais do dono + encerramento sem campos obrigatórios
- fix(chat): conversa encerrada sai da lista na hora e a aba acompanha encerrar/reabrir
- feat(empresas): multi-empresa/unidades com seletor no menu e fila agrupada por atendente
- feat(web): máscara de R$ no lançamento da venda e no formulário de plano
- feat(relatorios): detalhamento de vendas filtrável e linha de item mais larga no encerramento
- fix(chat): resposta a status com selo, miniatura e mídia guardada
- feat(crm): venda em lista de itens, permissões padrão do atendente e pizza sem corte
- feat(relatorios): seção Vendas lida da tabela sales (faturado, ticket médio, por atendente)
- fix(chat): preserve conversation list on send and fix pagination/sorting order
- feat(crm): add sale fields on ticket close, zoomable media viewer, and direct phone starter
- fix(numeros): recadastro acha o número excluído com ou sem o nono dígito
- feat(chat): foto do contato ampliada ao clicar no avatar (cabeçalho do chat e ficha do contato)
- fix(numeros): excluir número arquiva em vez de apagar; recadastrar o mesmo telefone na mesma conta traz o histórico de volta
- fix(financeiro): MRR conta assinatura paga presa em trialing; invoice.paid re-sincroniza a assinatura
- chore(git): main = produção, develop = desenvolvimento; deploy só da main commitada
- fix(agenda): nome da agenda não se perde quando a Evolution o troca pelo nome de perfil do WhatsApp
- feat(busca): contatos e agenda sem acento, por palavras e telefone com máscara; agenda virtualizada com scroll infinito
- fix(evolution): editar/apagar usam o remoteJid gravado pela Evolution (LID), não o montado do telefone
- feat(chat): editar mensagem de qualquer origem com uma permissão só (própria, de colega, do celular, da automação)
- feat(chat): editar a própria mensagem enviada (permissão conversations.edit_message); fix: resposta rápida sai com a assinatura
- feat(nova-conversa): agenda do celular navegável no modal (lista alfabética paginada, filtro, marca quem já é contato)
- feat(envio): nova conversa (disparo ativo), templates Meta no composer e no lembrete; sync da agenda do celular
- feat(envio): 1ª mensagem com o número ocioso também espera um sorteio do perfil
- feat(envio): intervalo do número conta da entrega e atraso do Conteúdo vira piso; chat: visualizador de imagem e vídeo; fluxos: variáveis na base da IA
- feat(variaveis): variáveis globais da empresa (CRUD, criação inline nos menus); envio: intervalo Moderado 3–5s
- feat(variaveis): filtros e valor padrão nas variáveis; atalhos "Mais usadas" no menu e no chat
- feat(marca): logo horizontal VOGO.CHAT no login e telas de conta; e-mail do login sem pré-preenchimento
- feat(agendamento): agendar mensagem na conversa com envio por job de 1 minuto
- feat(variaveis): empresa, saudação, primeiro nome e campos da ficha em fluxos, respostas rápidas, campanhas e chat
- feat(fluxos): pausar congela o fluxo e continuar segue de onde parou; menu de pausa na barra do campo
- feat(contatos): agenda do celular por número (phonebook_entries) para o contato nascer com o nome salvo
- fix(mensagens): ordem da conversa, edição cifrada, edição pelo evento próprio e nome do contato protegido
- feat(envio): intervalo padrão mais rápido por provider, sem teto diário e sem aquecimento
- feat(atendimento): bloco A — abas da fila, nota interna em abas, assinatura em negrito, campo expansível e campos livres na ficha
- feat(atendimento): limpa o cabeçalho do chat e troca robô por fluxo nos textos da pausa
- feat(envio): teto diário só para envio proativo, sem teto por padrão e aquecimento só no não oficial
- fix(fluxos): escapa aspas no texto do randomizador (quebrava o lint do next build)
- feat(atendimento): citação em anexos/voz na Evolution, ícone de mídia na prévia e nome do contato na citação (tarefa 9)
- feat(atendimento): apagar mensagem e limpar histórico com registro de auditoria (tarefa 8)
- feat(atendimento): notas internas em qualquer conversa, Alt+N e atendente com permissão de nota (tarefa 7)
- feat(planos): plano gratuito, ciclo anual/personalizado e limites ilimitados de fluxos e respostas rápidas
- feat(fluxos): randomizador em percentual (soma 100%) e Voltar do editor com aviso de não salvo
- fix(conversas): não serializa queueSeq (BigInt) nem raw no payload da mensagem
- feat(atendimento): limita a 2 tags no card da fila com +N e tooltip (tarefa 6)
- feat(departamentos): departamentos, fila por departamento e integração com fluxos (tarefa 5)
- fix(web): erros de ESLint que quebravam o build de produção
- feat(fluxos): desfazer/refazer, Ctrl+S e aviso de alterações não salvas (tarefa 4)
- feat(envio): fila única com ordem por conversa, limites, retry e reconexão (tarefa 3)
- feat(horarios): quadro de horários, faixas, fechado e boas-vindas (tarefa 2)
- feat(fluxos): Menu, Ação e Atraso completos; exportação e cópia em lote (tarefa 1.7)
- feat(chat): pausar o robô só na conversa aberta (tarefa 1.5)
- feat(fluxos): Conteúdo com várias mensagens e bloco Conectar com outro fluxo (tarefa 1.4)
- fix(chat): correção do websocket das mensagens
- refactor(arquitetura): separar o que entra pelo provider; chat com cara de chat
- fix(chat): filtros recolhidos, IA sabe com quem fala, áudio espera ter dados
- fix(acesso): permissões aplicadas nas telas e escopo de números visível
- feat(chat): responder mensagem, inclusive resposta a status
- feat(chat): barra de atalhos abaixo do campo, com fluxo, emoji, menção e assinatura
- feat(conversas): uma conversa por pessoa, vários atendimentos dentro dela
- fix(conversas): não lidas, tempo real, cabeçalho e permissão de números
- feat(painel): recolher o painel da direita de dentro dele
- feat(financeiro): cadastrar custo por plano e por linha; editar cliente
- feat(planos): reajuste programado de quem já assina
- feat(planos): criar, editar e desativar planos pelo painel do dono
- feat(painel): logo VOGO.CHAT no menu, dados da conversa à mão e pastas que fecham
- feat(conversas): conversa inteira acessível, fila por tempo de espera e lista compacta
- feat(conversas): encerrar em massa e histórico do atendimento
- feat(painel): respostas rápidas viram módulo, lista compacta e preferências que ficam
- feat(chat): ver imagem sobre a conversa, sem abrir aba nova
- feat(chat): prévia da mídia antes de enviar, com marcação em imagem
- feat(áudio): onda sonora pronta ao abrir, guardada entre sessões
- fix(áudio): decodificar a onda sem roubar a saída de som do primeiro play
- fix(mídia): servir Range request — áudio não tocava na primeira tentativa
- feat(áudio): microfone no lugar do enviar e onda sonora na gravação e na escuta
- fix(chat): mensagem enviada pelo celular do cliente aparece no histórico
- fix(áudio): descartar realmente descarta, e onda sonora durante a gravação
- fix(acesso): dono do sistema tem todas as permissões na origem
- fix(perfis): perfil padrão acompanha o catálogo e a tela mostra o que ele libera
- fix(fluxos): alfinete preenchido quando o atalho está ativo
- fix(fluxos): alfinete mostra a ação do clique, não o estado
- feat(fluxos): escolher quais aparecem como atalho no chat
- feat(chat): foto de perfil do contato
- fix(transmissão): CampaignsModule precisa do BillingModule
- fix(transmissão): exportar SendPacer do WhatsAppModule
- fix(sessão): corrida na renovação derrubava o usuário a cada 15 minutos
- fix(api): registro inexistente responde 404, não 500
- feat(acesso): restrição de atendente por número de WhatsApp
- fix(acesso): aplicar as três permissões que não bloqueavam nada
- feat(acesso): perfis de acesso configuráveis por cliente
- feat(fluxos): duplicar no mesmo cliente, exportar e importar entre clientes
- fix(backup): registrar o tamanho do dump no log
- fix(backup): configuração do rclone por ambiente, sem arquivo montado
- fix(plano): botão desabilitado explica o motivo
- fix(mídia): volume compartilhado para STORAGE_DRIVER=local
- fix(produção): deploy determinístico — Prisma, seed, Caddy e envio de código
- fix(infra): abrir 80/443 antes do REJECT no iptables
- feat(contato): ficha com e-mail, endereço e duas observações
- feat(respostas rápidas): anexo por resposta — áudio, foto, vídeo ou documento
- feat(chat): atalhos de mídia acima do campo e gravação de áudio no navegador
- fix(infra): bootstrap-server.sh recusa rodar fora do Linux
- feat(infra): bootstrap-server.sh — prepara servidor Ubuntu/Oracle ARM em um comando
- docs: Oracle Cloud Always Free como opção de início — imagens verificadas em arm64 e condições de uso
- feat(infra): scripts/prepare-prod.sh — gera .env.production e acerta os domínios
- feat(equipe): convite por link copiável — cadastrar a equipe deixa de exigir e-mail
- test(cobrança): ciclo de inadimplência verificado com test clock do Stripe
- fix(cobrança): stripe:sync não subia e faturas se sobrescreviam; checkout verificado
- feat(infra): backup diário automatizado, com envio remoto e restauração testada
- docs: checklist de entrada em produção (Stripe, Meta, Resend, servidor e o que falta antes de faturar)
- fix(agendamento): "Não entendi" era infinito — agora chama um humano após 3 tentativas
- fix(números): aquecimento pegou número já estabelecido e travou o teto em 20/dia
- feat(cobrança): encerramento com resultado e ledger contando conversa E mensagem
- feat(fluxos): fluxos padrão do cliente e aviso de fora do expediente
- feat(configurações): horário de funcionamento do cliente, com fuso e chave de atendimento
- feat(números): proteção contra bloqueio e banimento — ritmo, teto diário e aquecimento
- docs: avaliação do documento de funções — o que já temos e o que falta para o primeiro cliente
- feat(ia): bloco de IA conversa com o contato, com limite de turnos como freio de custo
- fix(ia): copiloto devolvia vazio e o ledger zerava o custo
- feat(ia): AI_BASE_URL — qualquer endpoint compatível (Ollama local, Groq, Gemini, OpenRouter)
- fix: erro de provider legível no chat e build da web fora do cache do dev
- feat(ia): copiloto do atendente e bloco de IA nos fluxos, cobrados por interação
- fix(agendamento): o id do botão nunca chegava ao motor — lembrete agora é interativo de verdade
- feat(observabilidade): log estruturado, requestId ponta a ponta, filtro global de erros e Sentry opcional
- test: 108 testes unitários nos pontos de risco (adapters, agenda, fluxos, quota, DSL de relatórios)
- feat: menus interativos — botões/lista na Meta, lista numerada na Evolution; motor e lembretes aceitam id do botão, número ou texto
- feat: máscara de telefone (+55 (62) 99999-8888) no profissional e no cadastro de número; valor salvo só com dígitos
- fix(scheduling): DTOs de edição validados (Partial<> desligava o ValidationPipe → 500); front envia só campos editáveis
- feat(scheduling): telas Agenda (dia por profissional, semana, status, remarcar) e Profissionais/serviços/lembretes; modal de agendamento com disponibilidade real; botão Agendar e ficha do cliente no chat; bloco Agendar no editor; nunca oferecer horário passado; docs/13
- feat(scheduling): bloco 'Agendar horário' no motor de fluxos (serviço → profissional → horário → confirmação, 'mais', cancelar, saídas done/fallback)
- feat(scheduling): modelo (profissionais, horários, serviços, agendamentos, preferências), disponibilidade, criação com anti-conflito, lembretes ao cliente e aviso ao profissional (job por minuto), resposta 1/2 ao lembrete, feature 'scheduling'; sendToContact/sendToPhone; start:all/stop:all
- chore: pnpm up / pnpm down / pnpm logs para rodar tudo com um comando
- feat: contas e e-mail — convites (equipe e admin de cliente), esqueci/redefinir/trocar senha, MailService (Resend, log em dev), e-mails de plano/cobrança/suspensão; fix Redis adapter connect
- feat(infra): Dockerfiles multi-stage, compose de produção (Caddy/HTTPS, réplicas), Socket.IO Redis adapter, /health, trust proxy, shards Evolution, CI, docs/11
- feat(reports): visão pronta (KPIs + conversas/dia, por atendente, origem, campanha/tags) e construtor recolhido; fix série por dia com datas ISO
- fix: tempo real — socket manda o token atual a cada reconexão; mensagens e notas entram no cache ao enviar; nota devolve autor; ícone de enviar unificado
- fix: cliente da API trata corpo vazio como null (faixa do fluxo some ao parar); aba Fluxos marca o fluxo rodando na conversa
- feat(flows): variáveis descobríveis — 'Inserir variável', Perguntar cria variável explicitamente, ação Definir variável, seletor na Condição, lista nas configurações; drag-and-drop da paleta
- feat: tags de contato (permanentes) + auto-recuperação de sessão Evolution
- feat: dono — tela Clientes e 'Entrar como' (impersonação)
- fix: dono do sistema (sem tenant) — TenantGuard com @NoTenantOk, /billing/usage sem plano, menu e rota inicial do dono
- feat(flows): editor visual, lista, aba Fluxos no chat, faixa 'em automação' e docs
- feat(flows): modelo, motor de execução, API e feature por plano
- feat: gerente, cadeado (notas internas), financeiro completo do dono, densidade visual
- feat: cobrança com Stripe — checkout, troca de plano, portal, webhooks, excedente na fatura, carência/suspensão, margem
- feat: posse do atendimento — assumir (atômico), transferir, devolver à fila, visão por atendente
- feat: tela de Relatórios — construtor, gráficos (Recharts 3), tabela, CSV, salvos
- feat: origem do lead — referral de anúncio, tags automáticas, filtro e relatório por campanha
- feat: seleção de tema em Configurações › Aparência
- fix: tema claro (Semáforo) como padrão; escuro é opcional
- feat: tema Semáforo (claro) + Sala de controle (escuro) com toggle; sinalização de estado
- fix: entrega única — ledger idempotente, sem reenvio de mensagem já entregue; loading em todos os botões
- fix: QR não regride após conectar; 'connecting' pós-pareamento não derruba número; QR novo para instância deslogada
- feat: bloqueia envio com número desconectado e permite reenviar mensagens que falharam
- feat: feedback de navegação — barra de progresso, menu ativo imediato, skeletons, fade-in
- fix: não reconectar instância Evolution já aberta (evita conflict/replaced)
- fix: webhooks grandes da Evolution (413), polling do QR e telefone real ao conectar
- feat: mídia — receber/exibir/enviar imagem, áudio, vídeo e documento
- feat: telas de Tags, Equipe, Plano e uso e Configurações (respostas rápidas)
- feat: tela de Números (QR, troca de provider), infra local com Colima, docs completas
- chore: scaffold inicial do Atendo (api NestJS, web Next.js, shared, infra)

## 1.0.0 — 2026-10-13

Primeira versão numerada. Inclui:

- Tags no encerramento: motivos de não compra viraram tags; só as marcadas "Exibir no encerramento" aparecem no Comprou / Não comprou
- Tela de Tags com busca, filtros, seleção em massa (encerramento, Kanban, cor, excluir) e criação de várias com cor individual
- Modelo de perfil com tags completas (cor, Kanban, encerramento, ordem)
- Chaves Pix da empresa e envio pelo chat
- Pastas de respostas rápidas abertas por padrão
- Evolution: botões nativos visíveis no celular e restart que recupera conexão travada
