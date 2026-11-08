import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
// mammoth é `export =` e o projeto não liga esModuleInterop
import mammoth = require('mammoth');
import { KNOWLEDGE_MAX_CHARS, KNOWLEDGE_MAX_DOCS, type AgentKnowledgeDoc, type KnowledgeHit } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { AiUsageService } from './ai-usage.service';
import { HITS_MAX_CHARS, HITS_TOP, chunkText, dot, fold, fuse, keywordQuery, packVector, searchableOf, unpackVector } from './knowledge-text';
import { embed, embedCostUsd, embedModel, embeddingsOn } from './providers/embeddings';

export const QUEUE_AI_KNOWLEDGE = 'ai';
/** quantos candidatos cada busca traz antes de juntar */
const CANDIDATES = 12;
/** teto de trechos por agente: acima disso, comparar na API começa a pesar (docs/agente-ia.md#documentos) */
const MAX_CHUNKS_PER_AGENT = 5000;

const MIME: Record<string, 'pdf' | 'docx' | 'txt'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'txt',
};
const byExt = (name: string) => ({ pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'txt' } as const)[name.toLowerCase().split('.').pop() ?? ''];

/** Arquivo → texto. Lança com mensagem para a pessoa (formato, senha, imagem sem texto). */
export async function extractText(file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<string> {
  const kind = MIME[file.mimetype] ?? byExt(file.originalname);
  if (!kind) throw new BadRequestException('Formato não aceito. Envie PDF, Word (.docx) ou texto (.txt).');
  if (kind === 'txt') return file.buffer.toString('utf8');
  if (kind === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
  try {
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await pdfText(pdf, { mergePages: false });
    return text.join('\n\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) throw new BadRequestException('O PDF está protegido por senha. Tire a senha e envie de novo.');
    throw new BadRequestException('Não deu para ler este PDF. Tente salvar de novo como PDF ou enviar em Word.');
  }
}

/**
 * Documentos dos agentes de IA (RAG). O arquivo vira texto e trechos na hora do upload — a busca
 * por palavra já funciona aí. Os embeddings (busca por significado) saem num job da fila `ai`,
 * quando `AI_EMBED_API_KEY` está configurada.
 */
@Injectable()
export class KnowledgeService {
  private readonly log = new AppLogger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: AiUsageService,
    @InjectQueue(QUEUE_AI_KNOWLEDGE) private readonly queue: Queue,
  ) {}

  private async agentOf(tenantId: string, agentId: string) {
    const a = await this.prisma.aiAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true } });
    if (!a) throw new NotFoundException('Agente não encontrado.');
  }

  /** Documentos do agente + se a busca por significado está ligada neste ambiente. */
  async list(tenantId: string, agentId: string): Promise<{ semantic: boolean; docs: AgentKnowledgeDoc[] }> {
    await this.agentOf(tenantId, agentId);
    const [docs, embedded] = await Promise.all([
      this.prisma.aiKnowledgeDoc.findMany({ where: { tenantId, agentId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { chunks: true } } } }),
      this.prisma.aiKnowledgeChunk.groupBy({ by: ['docId'], where: { tenantId, agentId, embedModel: embedModel(), NOT: { embedding: null } }, _count: { _all: true } }),
    ]);
    const emb = new Map(embedded.map((e) => [e.docId, e._count._all]));
    return {
      semantic: embeddingsOn(),
      docs: docs.map((d) => ({
        id: d.id, name: d.name, mime: d.mime, sizeBytes: d.sizeBytes, chars: d.chars, chunks: d._count.chunks,
        status: d.status as AgentKnowledgeDoc['status'], error: d.error, embedded: emb.get(d.id) ?? 0, createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /** Upload: extrai, corta e grava os trechos (busca por palavra pronta) e agenda os embeddings. */
  async upload(tenantId: string, agentId: string, userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Escolha um arquivo.');
    await this.agentOf(tenantId, agentId);
    const [docs, chunksNow] = await Promise.all([
      this.prisma.aiKnowledgeDoc.count({ where: { tenantId, agentId } }),
      this.prisma.aiKnowledgeChunk.count({ where: { tenantId, agentId } }),
    ]);
    if (docs >= KNOWLEDGE_MAX_DOCS) throw new BadRequestException(`No máximo ${KNOWLEDGE_MAX_DOCS} documentos por agente. Apague um para enviar outro.`);
    // multer entrega o nome em latin1
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);

    // \0 vem em alguns PDFs e o Postgres recusa em coluna de texto
    const text = (await extractText(file)).replace(/\u0000/g, '').trim();
    if (text.replace(/\s/g, '').length < 50) {
      throw new BadRequestException('Não encontramos texto neste arquivo. Se for um PDF escaneado (foto do papel), envie a versão em Word ou um PDF com texto selecionável.');
    }
    if (text.length > KNOWLEDGE_MAX_CHARS) throw new BadRequestException(`Documento grande demais (${Math.round(text.length / 1000)} mil caracteres). Divida em partes de até ${KNOWLEDGE_MAX_CHARS / 1000} mil.`);
    const chunks = chunkText(text);
    if (chunksNow + chunks.length > MAX_CHUNKS_PER_AGENT) throw new BadRequestException('Este agente já tem documentos demais. Apague algum ou divida entre agentes.');

    const doc = await this.prisma.$transaction(async (tx) => {
      const d = await tx.aiKnowledgeDoc.create({
        data: { tenantId, agentId, name, mime: file.mimetype || 'application/octet-stream', sizeBytes: file.size, chars: text.length, uploadedById: userId },
      });
      await tx.aiKnowledgeChunk.createMany({
        data: chunks.map((c) => ({ tenantId, agentId, docId: d.id, position: c.position, heading: c.heading, text: c.text, search: fold(searchableOf(c)) })),
      });
      // tsvector não passa pelo Prisma: preenche em SQL, com o dicionário português
      await tx.$executeRaw`UPDATE ai_knowledge_chunks SET tsv = to_tsvector('portuguese', search) WHERE "docId" = ${d.id}`;
      return d;
    });
    if (embeddingsOn()) await this.queue.add('knowledge-embed', { docId: doc.id }, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
    return { id: doc.id, chunks: chunks.length, semantic: embeddingsOn() };
  }

  async remove(tenantId: string, agentId: string, docId: string) {
    const { count } = await this.prisma.aiKnowledgeDoc.deleteMany({ where: { id: docId, tenantId, agentId } });
    if (!count) throw new NotFoundException('Documento não encontrado.');
    return { ok: true };
  }

  /** Agente tem documento? Evita busca (e embedding da pergunta) para quem não usa. */
  hasDocs(tenantId: string, agentId: string) {
    return this.prisma.aiKnowledgeDoc.count({ where: { tenantId, agentId, status: 'ready' } }).then((n) => n > 0);
  }

  /**
   * Os trechos mais úteis para a pergunta: busca por palavra (Postgres, português) + por
   * significado (embeddings, comparados aqui), juntas por posição. Falha no embedding da
   * pergunta não derruba: fica só a busca por palavra.
   */
  async search(tenantId: string, agentId: string, question: string, top = HITS_TOP): Promise<KnowledgeHit[]> {
    const q = question.trim().slice(0, 1000);
    if (!q) return [];
    const tsq = keywordQuery(q);
    const [keyword, semantic] = await Promise.all([
      tsq
        ? this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM ai_knowledge_chunks
            WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND tsv @@ to_tsquery('portuguese', ${tsq})
            ORDER BY ts_rank_cd(tsv, to_tsquery('portuguese', ${tsq})) DESC
            LIMIT ${CANDIDATES}`)
        : Promise.resolve([]),
      this.semantic(tenantId, agentId, q),
    ]);
    const ranked = fuse(keyword.map((r) => r.id), semantic).slice(0, top * 2);
    if (!ranked.length) return [];
    const rows = await this.prisma.aiKnowledgeChunk.findMany({
      where: { id: { in: ranked.map((r) => r.id) }, tenantId },
      select: { id: true, docId: true, position: true, heading: true, text: true, doc: { select: { name: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const hits: KnowledgeHit[] = [];
    let chars = 0;
    for (const r of ranked) {
      const c = byId.get(r.id);
      if (!c || hits.length >= top) continue;
      if (hits.length && chars + c.text.length > HITS_MAX_CHARS) break;
      chars += c.text.length;
      hits.push({ docId: c.docId, docName: c.doc.name, position: c.position, heading: c.heading, text: c.text, via: r.via });
    }
    return hits;
  }

  /** Ids dos trechos mais parecidos com a pergunta (vazio se a busca por significado está desligada ou falhou). */
  private async semantic(tenantId: string, agentId: string, q: string): Promise<string[]> {
    if (!embeddingsOn()) return [];
    const model = embedModel();
    const rows = await this.prisma.aiKnowledgeChunk.findMany({ where: { tenantId, agentId, embedModel: model, NOT: { embedding: null } }, select: { id: true, embedding: true } });
    if (!rows.length) return [];
    try {
      // a pergunta custa ~20 tokens (milésimos de centavo): não vai ao ledger, só a indexação vai
      const { vectors } = await embed([q], 8000);
      const qv = unpackVector(packVector(vectors[0]));
      return rows
        .map((r) => ({ id: r.id, s: dot(qv, unpackVector(r.embedding!)) }))
        .filter((r) => r.s > 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, CANDIDATES)
        .map((r) => r.id);
    } catch (err) {
      this.log.warn(`embedding da pergunta falhou (agente ${agentId}): ${err instanceof Error ? err.message : err}; só busca por palavra`);
      return [];
    }
  }

  /**
   * Job: gera os embeddings que faltam (ou de outro modelo) — de um documento, ou de todos quando
   * a chave acabou de ser configurada. Custo vai ao ledger como `knowledge` (não é interação).
   */
  async embedPending(docId?: string) {
    if (!embeddingsOn()) return;
    const model = embedModel();
    const where: Prisma.AiKnowledgeChunkWhereInput = { ...(docId ? { docId } : {}), OR: [{ embedding: null }, { embedModel: { not: model } }] };
    for (;;) {
      const batch = await this.prisma.aiKnowledgeChunk.findMany({ where, take: 256, orderBy: [{ docId: 'asc' }, { position: 'asc' }], select: { id: true, tenantId: true, heading: true, text: true } });
      if (!batch.length) return;
      const started = Date.now();
      const { vectors, tokens } = await embed(batch.map((c) => searchableOf(c)));
      for (let i = 0; i < batch.length; i++) {
        await this.prisma.aiKnowledgeChunk.update({ where: { id: batch[i].id }, data: { embedding: new Uint8Array(packVector(vectors[i])), embedModel: model } });
      }
      // um lançamento por cliente no lote, com os tokens divididos pelo tamanho do texto
      const per = new Map<string, number>();
      for (const c of batch) per.set(c.tenantId, (per.get(c.tenantId) ?? 0) + c.text.length);
      const total = [...per.values()].reduce((s, v) => s + v, 0) || 1;
      for (const [tenantId, len] of per) {
        const t = Math.round((tokens * len) / total);
        await this.usage.record({ tenantId, kind: 'knowledge', provider: 'embeddings', model, tokensIn: t, tokensOut: 0, latencyMs: Date.now() - started, costUsd: embedCostUsd(t) });
      }
      this.log.log(`embeddings: ${batch.length} trechos (${tokens} tokens)`);
    }
  }
}
