import { HttpException, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumbersService } from './numbers.service';
import { ProviderRegistry } from './providers/provider.registry';
import { InboundService } from '../conversations/inbound.service';

export const QUEUE_CONTACTS_SYNC = 'wa-contacts-sync';
/**
 * De quanto em quanto tempo a agenda do aparelho é relida inteira: uma vez por dia. O webhook
 * cobre o dia a dia; reler milhares de contatos mais que isso só pesa na Evolution.
 */
export const CONTACTS_SYNC_EVERY_MS = 24 * 60 * 60_000;

/** Job com `numberId` = só aquele número (botão "Sincronizar contatos"); sem = todos. */
export interface ContactsSyncJob {
  numberId?: string;
}

/**
 * Sincronização periódica da agenda de contatos do aparelho (Evolution).
 *
 * O webhook `contacts.upsert` já traz nomes conforme o celular sincroniza, mas perde o que
 * chegou com a instância fora do ar, antes do webhook existir ou durante um deploy. A releitura
 * completa fecha esses buracos: atualiza a agenda do número (`phonebook_entries`) e o nome de
 * quem já é contato, pela mesma regra do webhook. Não cria contato (ver `applyContactName`).
 */
@Injectable()
export class ContactsSyncScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_CONTACTS_SYNC) private readonly queue: Queue<ContactsSyncJob>) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('contacts-sync', { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, { name: 'sync', data: {} });
  }
  /**
   * Sincronizar um número agora — no máximo uma vez por dia por número. `jobId` fixo: clicar
   * várias vezes não empilha rodadas, e o job concluído fica guardado 24 h como marca da última
   * vez. Falha não conta (`removeOnFail`): dá para tentar de novo.
   */
  async enqueue(numberId: string) {
    const jobId = `contacts-sync-${numberId}`;
    const anterior = await this.queue.getJob(jobId);
    if (anterior) {
      if (!anterior.finishedOn) return; // ainda na fila ou rodando
      const falta = anterior.finishedOn + CONTACTS_SYNC_EVERY_MS - Date.now();
      if (falta > 0) {
        const horas = Math.ceil(falta / 3_600_000);
        throw new HttpException(`A agenda deste número já foi sincronizada hoje. Tente de novo em ${horas} h.`, HttpStatus.TOO_MANY_REQUESTS);
      }
      // a limpeza por idade do BullMQ é preguiçosa: o job velho ainda bloquearia o `jobId`
      await anterior.remove();
    }
    await this.queue.add('sync', { numberId }, { jobId, removeOnComplete: { age: CONTACTS_SYNC_EVERY_MS / 1000 }, removeOnFail: true });
  }
}

@Processor(QUEUE_CONTACTS_SYNC)
export class ContactsSyncProcessor extends TrackedWorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly inbound: InboundService,
  ) {
    super(QUEUE_CONTACTS_SYNC);
  }

  protected async handle(job: Job<ContactsSyncJob>) {
    const list = await this.prisma.whatsAppNumber.findMany({
      where: { isActive: true, status: 'connected', ...(job.data?.numberId && { id: job.data.numberId }) },
    });
    for (const n of list) {
      const provider = this.registry.get(n.provider);
      if (!provider.listContacts) continue;
      try {
        const ctx = await this.numbers.context(n.id);
        const r = await this.inbound.syncPhonebook(n, await provider.listContacts(ctx));
        if (r.changed) this.log.log(`Agenda de ${n.label}: ${r.changed} de ${r.total} contato(s) atualizados`);
      } catch (err) {
        // um número com problema não impede os outros
        this.log.warn(`agenda ${n.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
