import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * `searchText` é coluna gerada só para busca (ver common/text-search.ts): nunca sai nas respostas.
 * O omit vale em runtime; o tipo segue o `PrismaClient` padrão (o genérico com omit não encaixa em
 * `Prisma.TransactionClient`/`GetPayload`). Nada lê `searchText` — só filtra por ele.
 */
const options = {
  omit: { contact: { searchText: true }, phonebookEntry: { searchText: true } },
} satisfies Prisma.PrismaClientOptions;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(options);
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
