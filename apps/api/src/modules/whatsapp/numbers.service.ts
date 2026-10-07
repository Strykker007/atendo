import { RedisService } from '../../common/redis/redis.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppProvider as ProviderKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderRegistry } from './providers/provider.registry';
import type { NumberContext, OutboundEdit, OutboundReaction, OutboundRevoke } from './providers/provider.interface';
import type { MetaNumberConfig } from './providers/meta.provider';
import type { EvolutionNumberConfig } from './providers/evolution.provider';
import { defaultSendDelay } from './sending-policy';
import type { MessageTemplate } from '@atendo/shared';

/** bloco de "digitando…" (a Evolution fecha com `paused` no fim de cada um) */
const TYPING_CHUNK_MS = 5_000;
/** sem renovação do painel nesse tempo = parou de digitar */
const TYPING_IDLE_MS = 4_000;
/** sem envio nem digitação nesse tempo, a conta volta a offline */
const ONLINE_MS = 45_000;

@Injectable()
export class NumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: ProviderRegistry,
    private readonly redis: RedisService,
  ) {}

  /** última assinatura de presença por número+contato: abrir a mesma conversa várias vezes não repete a chamada */
  private readonly presenceAt = new Map<string, number>();

  /**
   * Assina o "digitando…" do contato no provider. Chamado ao abrir a conversa no painel.
   * Nunca lança: é enfeite, não pode atrapalhar quem está atendendo.
   */
  async subscribePresence(numberId: string, phone: string) {
    const key = `${numberId}:${phone}`;
    if (Date.now() - (this.presenceAt.get(key) ?? 0) < 120_000) return;
    this.presenceAt.set(key, Date.now());
    try {
      const ctx = await this.context(numberId);
      await this.registry.get(ctx.provider).subscribePresence?.(ctx, phone);
    } catch {
      this.presenceAt.delete(key); // tenta de novo na próxima abertura
    }
  }

  /**
   * "digitando…" do atendente, com começo e fim (docs/envio.md#humanização).
   *
   * A Evolution não segura o "digitando" aberto: `sendPresence` manda `composing`, espera o
   * `delay` e SEMPRE fecha com `paused`. Então, enquanto o painel avisa que a pessoa digita
   * (`composing`, renovado a cada ~2 s), um laço único por contato manda blocos de 5 s em
   * sequência — sem sobrepor, senão o `paused` de um bloco apagaria o seguinte. `paused` (parou,
   * enviou, saiu da conversa) encerra na hora e o laço não abre outro bloco.
   *
   * Estado no Redis porque há mais de uma instância da API: `typing:until` diz até quando a
   * pessoa está digitando; `typing:loop` garante um laço só. Nunca lança: é humanização.
   */
  /** quando cada número deve conferir se fica offline (um timer por número neste processo) */
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Conta online enquanto há atividade (envio, "digitando"), offline ~45 s depois da última —
   * como alguém com o WhatsApp Web aberto. Sem isto o WhatsApp não mostra "digitando" (a instância
   * conecta offline), e o oposto — `alwaysOnline` — deixaria o número online 24 h, padrão de robô.
   *
   * `wa:online:<número>` no Redis é a janela (renovada a cada atividade); só a 1ª atividade da
   * janela chama a Evolution. O timer de cada processo confere ao fim: se ninguém renovou, manda
   * offline. Processo reiniciado perde o timer — a próxima atividade abre e fecha a janela de novo.
   * Nunca lança. Efeito colateral: com a conta online o celular da loja não toca notificação.
   */
  async markOnline(numberId: string) {
    try {
      const key = `wa:online:${numberId}`;
      const nova = (await this.redis.set(key, '1', 'PX', ONLINE_MS, 'NX')) === 'OK';
      if (!nova) await this.redis.pexpire(key, ONLINE_MS);
      const old = this.offlineTimers.get(numberId);
      if (old) clearTimeout(old);
      const t = setTimeout(() => void this.maybeOffline(numberId), ONLINE_MS + 1_000);
      t.unref?.();
      this.offlineTimers.set(numberId, t);
      if (nova) {
        const ctx = await this.context(numberId);
        await this.registry.get(ctx.provider).setOnline?.(ctx, true);
      }
    } catch {
      /* humanização: nunca atrapalha o envio */
    }
  }

  private async maybeOffline(numberId: string) {
    this.offlineTimers.delete(numberId);
    try {
      if (await this.redis.exists(`wa:online:${numberId}`)) return; // alguém renovou
      const ctx = await this.context(numberId);
      await this.registry.get(ctx.provider).setOnline?.(ctx, false);
    } catch {
      /* idem */
    }
  }

  setTyping(numberId: string, phone: string, state: 'composing' | 'paused') {
    const key = `${numberId}:${phone}`;
    void this.typingStep(numberId, phone, key, state).catch(() => undefined);
  }

  private async typingStep(numberId: string, phone: string, key: string, state: 'composing' | 'paused') {
    const until = `typing:until:${key}`;
    const loop = `typing:loop:${key}`;
    if (state === 'paused') {
      const estava = await this.redis.del(until);
      if (!estava) return; // já parado: não manda nada ao WhatsApp
      const ctx = await this.context(numberId);
      await this.registry.get(ctx.provider).sendTyping?.(ctx, phone, 0, 'paused');
      return;
    }
    // sem notícia do painel em 4 s (aba fechada, rede caiu) = parou
    await this.redis.set(until, '1', 'PX', TYPING_IDLE_MS);
    // "digitando" de conta offline não aparece para o contato
    await this.markOnline(numberId);
    if ((await this.redis.set(loop, '1', 'PX', TYPING_CHUNK_MS * 3, 'NX')) !== 'OK') return; // laço já rodando
    try {
      const ctx = await this.context(numberId);
      const provider = this.registry.get(ctx.provider);
      if (!provider.sendTyping) return;
      // teto de segurança: ninguém digita uma mensagem só por mais de 2 min
      for (let i = 0; i < 24 && (await this.redis.exists(until)); i++) {
        await this.redis.pexpire(loop, TYPING_CHUNK_MS * 3);
        await provider.sendTyping(ctx, phone, TYPING_CHUNK_MS, 'composing');
      }
    } finally {
      await this.redis.del(loop);
    }
  }

  /** Reação do atendente a uma mensagem. Lança se o provider recusar — quem chama não grava nada. */
  /** O telefone tem WhatsApp? `null` = o provider não sabe dizer (Meta) ou falhou — não bloqueia. */
  async hasWhatsApp(numberId: string, phone: string): Promise<boolean | null> {
    const ctx = await this.context(numberId);
    return (await this.registry.get(ctx.provider).hasWhatsApp?.(ctx, phone)) ?? null;
  }

  async react(numberId: string, reaction: OutboundReaction) {
    const ctx = await this.context(numberId);
    await this.registry.get(ctx.provider).react(ctx, reaction);
  }

  /**
   * Apagar para todos. `false` = o provider do número não tem essa operação (Meta); lança se o
   * provider recusar. Quem chama decide o que fazer — apagar só no painel e avisar.
   */
  async revoke(numberId: string, target: OutboundRevoke): Promise<boolean> {
    const ctx = await this.context(numberId);
    const provider = this.registry.get(ctx.provider);
    if (!provider.revoke) return false;
    await provider.revoke(ctx, target);
    return true;
  }

  /** templates por número, por 5 min: abrir o modal e enviar não podem bater na Meta toda vez */
  private readonly templateCache = new Map<string, { at: number; list: MessageTemplate[] }>();

  /**
   * Templates aprovados do número (Meta). Evolution não tem template: lista vazia.
   * `refresh` ignora o cache — é o "sincronizar" da tela, para template recém-aprovado.
   */
  async templates(numberId: string, refresh = false): Promise<MessageTemplate[]> {
    const hit = this.templateCache.get(numberId);
    if (!refresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
    const ctx = await this.context(numberId);
    const list = (await this.registry.get(ctx.provider).listTemplates?.(ctx)) ?? [];
    this.templateCache.set(numberId, { at: Date.now(), list });
    return list;
  }

  /** Um template pelo nome + idioma. Recarrega uma vez antes de dizer que não existe (pode ter sido aprovado agora). */
  async template(numberId: string, name: string, language: string): Promise<MessageTemplate> {
    const match = (l: MessageTemplate[]) => l.find((t) => t.name === name && t.language === language);
    const t = match(await this.templates(numberId)) ?? match(await this.templates(numberId, true));
    if (!t) throw new BadRequestException(`Template "${name}" (${language}) não está aprovado neste número.`);
    return t;
  }

  /** Editar mensagem enviada. `false` = o provider do número não edita (Meta); lança se recusar. */
  async editMessage(numberId: string, target: OutboundEdit): Promise<boolean> {
    const ctx = await this.context(numberId);
    const provider = this.registry.get(ctx.provider);
    if (!provider.editMessage) return false;
    await provider.editMessage(ctx, target);
    return true;
  }

  async context(numberId: string): Promise<NumberContext & { provider: ProviderKind }> {
    const n = await this.prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!n) throw new NotFoundException('Número não encontrado');
    return {
      numberId: n.id,
      tenantId: n.tenantId,
      phone: n.phone,
      externalId: n.externalId,
      provider: n.provider,
      config: this.crypto.decryptJson(n.providerConfig),
    };
  }

  /**
   * Troca de provider: um único ponto, uma única transação.
   * Histórico de conversas não é tocado (chave é o telefone do contato).
   */
  async switchProvider(numberId: string, provider: ProviderKind, config: MetaNumberConfig | EvolutionNumberConfig) {
    const current = await this.context(numberId);
    if (current.provider !== provider) {
      await this.registry.get(current.provider).disconnect(current).catch(() => undefined);
    }

    const externalId =
      provider === 'meta' ? (config as MetaNumberConfig).phoneNumberId : (config as EvolutionNumberConfig).instanceName;
    if (!externalId) throw new BadRequestException('Configuração do provider incompleta');

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id: numberId },
      // trocou de provider: o intervalo volta ao padrão do novo (o imediato da Meta não serve na Evolution)
      data: { provider, externalId, providerConfig: this.crypto.encryptJson(config), status: 'disconnected', ...(current.provider !== provider && { sendDelay: defaultSendDelay(provider) }) },
    });

    const ctx = await this.context(updated.id);
    const result = await this.registry.get(provider).connect(ctx);
    await this.prisma.whatsAppNumber.update({ where: { id: numberId }, data: { status: result.status } });
    return { ...updated, providerConfig: undefined, status: result.status, qrCode: result.qrCode };
  }

  /**
   * Excluir = sai do provider e some do painel, mas o registro fica arquivado: apagar levava
   * junto (cascade) todas as conversas, e quem só queria refazer a conexão perdia o histórico.
   * Recadastrar o mesmo telefone na mesma conta revive o número (ver `revive`).
   */
  async remove(numberId: string) {
    const ctx = await this.context(numberId);
    // mesmo motivo do `disconnect`: o 401 do logout não pode virar "removido pelo WhatsApp"
    await this.prisma.whatsAppNumber.update({ where: { id: numberId }, data: { status: 'disconnected' } });
    const provider = this.registry.get(ctx.provider);
    await (provider.destroy ? provider.destroy(ctx) : provider.disconnect(ctx)).catch(() => undefined);
    await this.prisma.whatsAppNumber.update({
      where: { id: numberId },
      // externalId é único global: liberar deixa o mesmo instanceName/phone_number_id ser usado de novo
      data: { deletedAt: new Date(), isActive: false, status: 'disconnected', externalId: `removed:${numberId}` },
    });
  }

  /** Desconecta a sessão (logout na Evolution) sem excluir: o número e as conversas ficam; "Reconectar" gera QR novo. */
  async disconnect(numberId: string) {
    const ctx = await this.context(numberId);
    // marca ANTES do logout: o webhook do logout chega com 401 e, com o número ainda
    // "conectado", seria lido como queda forçada pelo WhatsApp (ver number-removal.ts)
    const { status } = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id: numberId }, select: { status: true } });
    await this.prisma.whatsAppNumber.update({ where: { id: numberId }, data: { status: 'disconnected' } });
    try {
      await this.registry.get(ctx.provider).disconnect(ctx);
    } catch (err) {
      // logout não saiu: a sessão segue de pé, o status também
      await this.prisma.whatsAppNumber.update({ where: { id: numberId }, data: { status } });
      throw err;
    }
  }

  async findByExternal(provider: ProviderKind, externalId: string) {
    return this.prisma.whatsAppNumber.findUnique({ where: { provider_externalId: { provider, externalId } } });
  }
}
