# Transcrição de áudio

Botão **Transcrever** embaixo de cada áudio do chat, como no WhatsApp. **Só a pedido**: não há
transcrição automática, porque cada áudio transcrito custa (113 mil áudios por mês em produção em
nov/2026; transcrever todos sairia ~US$ 90/mês, e sob demanda fica em poucos dólares).

O WhatsApp não entrega transcrição pela API (nem a oficial, nem a Evolution): a do app é feita no
celular. Por isso usamos um fornecedor de fala para texto.

## Como funciona

1. O atendente clica em **Transcrever** (`components/chat/AudioTranscript.tsx`).
2. `POST /ai/transcribe { conversationId, messageId }` → `AiService.transcribe`:
   - a mensagem precisa ser do tenant, não apagada, `type = audio` e com o arquivo já no nosso
     storage (`media/<tenant>/…`);
   - **já transcrita** (`messages.transcript` não nulo): devolve o texto salvo, sem cobrar
     (`cached: true`);
   - passa pelo mesmo controle da IA da plataforma (`platformGate`): orçamento da plataforma,
     quota do plano, saldo de IA. Conta **uma interação de IA**;
   - lê o arquivo do storage e envia para `/audio/transcriptions` (`providers/transcribe.ts`), em
     português;
   - grava o ledger (`ai_usage`, `kind = transcribe`, custo = minutos × `AI_TRANSCRIBE_PRICE_PER_MIN`;
     sem duração na resposta, estima por 2 KB/s) e o texto em `messages.transcript`.
3. A bolha mostra **Transcrição** (recolhível). Sem fala reconhecida, grava `''` e mostra
   "Nenhuma fala reconhecida" — pedir de novo não cobra.

Outros atendentes veem o texto ao recarregar a conversa (não há evento em tempo real para isso).
Mensagem apagada não leva a transcrição (`present()` zera o campo).

Acesso: rota sob a feature `ai_copilot` (mesma do copiloto). Chave própria do cliente
(`ai_own_key`) não é usada aqui: a transcrição sempre vai pela chave da plataforma.

## Configuração

| Variável | Padrão | O quê |
|---|---|---|
| `AI_TRANSCRIBE_API_KEY` | vazio | sem chave, o botão não aparece |
| `AI_TRANSCRIBE_BASE_URL` | `https://api.openai.com/v1` | qualquer endpoint compatível com a OpenAI |
| `AI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | |
| `AI_TRANSCRIBE_PRICE_PER_MIN` | `0.003` | USD por minuto, para o custo no ledger |

Groq (mais barato): `AI_TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1`,
`AI_TRANSCRIBE_MODEL=whisper-large-v3-turbo`, `AI_TRANSCRIBE_PRICE_PER_MIN=0.0007`.

Limite: arquivo de até 25 MB (limite dos fornecedores).

## Dados

- `messages.transcript` (texto, opcional) e o valor `transcribe` em `AiTaskKind`.
- Migração `20270217000000_message_transcript` (aditiva).
