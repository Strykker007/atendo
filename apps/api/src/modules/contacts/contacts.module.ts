import { BadRequestException, Body, Controller, Get, Header, Injectable, Module, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppLogger } from '../../common/observability/app-logger';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { phoneVariants } from '../conversations/phone-variants';
import { EXPORT_HEADER, EXPORT_MAX_ROWS, IMPORT_MAX_ROWS, mergeContact, parseCsv, readImportRows, toCsv, type ImportRecord } from './contacts-io';

class ImportDto {
  /** conteúdo de um .csv (`;`, `,` ou tabulação) */
  @IsOptional() @IsString() @MaxLength(20_000_000) csv?: string;
  /** planilha já lida no navegador (.xlsx): linhas × colunas, a 1ª pode ser o cabeçalho */
  @IsOptional() @IsArray() @ArrayMaxSize(IMPORT_MAX_ROWS + 1) rows?: string[][];
  /** a planilha vence o que já está na ficha (inclusive o nome digitado pela equipe) */
  @IsOptional() @IsBoolean() overwrite?: boolean;
  /** só confere e devolve o relatório, sem gravar */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  invalid: { line: number; value: string; reason: string }[];
  invalidCount: number;
  /** tags da planilha que não existem no cliente (não são criadas: isso é de quem gerencia tags) */
  unknownTags: string[];
  dryRun: boolean;
}

@Injectable()
export class ContactsIoService {
  private readonly log = new AppLogger('ContactsIo');

  constructor(private readonly prisma: PrismaService) {}

  /** Base inteira do cliente em CSV, com as tags e os campos personalizados como colunas. */
  async exportCsv(tenantId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_MAX_ROWS,
      select: {
        name: true, phone: true, email: true, document: true, address: true, note1: true, note2: true, optOutAt: true, createdAt: true,
        tags: { select: { tag: { select: { name: true } } } },
        attributes: { select: { label: true, value: true }, orderBy: { position: 'asc' } },
      },
    });
    // campo personalizado = uma coluna por nome de campo, na ordem em que aparecem
    const labels = [...new Set(contacts.flatMap((c) => c.attributes.map((a) => a.label)))];
    const rows = contacts.map((c) => {
      const attrs = new Map(c.attributes.map((a) => [a.label, a.value]));
      return [
        c.name, c.phone, c.email, c.document, c.address, c.note1, c.note2,
        c.tags.map((t) => t.tag.name).join(', '),
        c.optOutAt ? 'sim' : 'não',
        c.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        ...labels.map((l) => attrs.get(l) ?? ''),
      ];
    });
    return toCsv([[...EXPORT_HEADER, ...labels], ...rows]);
  }

  async import(tenantId: string, dto: ImportDto): Promise<ImportReport> {
    const matrix = dto.rows ? dto.rows.map((r) => (Array.isArray(r) ? r.map((v) => String(v ?? '')) : [])) : dto.csv ? parseCsv(dto.csv) : null;
    if (!matrix?.length) throw new BadRequestException('Envie uma planilha com ao menos uma linha.');
    if (matrix.length > IMPORT_MAX_ROWS + 1) throw new BadRequestException(`Planilha grande demais: o máximo é ${IMPORT_MAX_ROWS.toLocaleString('pt-BR')} contatos por importação. Divida o arquivo.`);
    const { records, invalid, duplicates } = readImportRows(matrix);
    if (!records.length && !invalid.length) throw new BadRequestException('Não encontramos a coluna de telefone. Use um cabeçalho como "Nome;Telefone".');

    // contato que já existe, inclusive com/sem o nono dígito (o mesmo celular não vira dois)
    const variantes = new Map<string, string>();
    for (const r of records) for (const v of phoneVariants(r.phone)) if (!variantes.has(v)) variantes.set(v, r.phone);
    const existentes = await this.prisma.contact.findMany({
      where: { tenantId, phone: { in: [...variantes.keys()] } },
      select: { id: true, phone: true, name: true, nameSource: true, email: true, document: true, address: true, note1: true, note2: true },
    });
    const porTelefone = new Map<string, (typeof existentes)[number]>();
    for (const c of existentes) {
      const dono = variantes.get(c.phone);
      if (dono && (!porTelefone.has(dono) || c.phone === dono)) porTelefone.set(dono, c);
    }

    const tags = await this.prisma.tag.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const tagPorNome = new Map(tags.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const unknownTags = new Set<string>();
    const tagIds = (r: ImportRecord) => r.tags.flatMap((n) => {
      const id = tagPorNome.get(n.toLowerCase());
      if (!id) unknownTags.add(n);
      return id ? [id] : [];
    });

    const novos = records.filter((r) => !porTelefone.has(r.phone));
    const atualizacoes = records.flatMap((r) => {
      const cur = porTelefone.get(r.phone);
      if (!cur) return [];
      return [{ id: cur.id, data: mergeContact(cur, r, !!dto.overwrite), tags: tagIds(r) }];
    });
    const tagsDosNovos = new Map(novos.map((r) => [r.phone, tagIds(r)]));
    const report: ImportReport = {
      total: records.length + invalid.length + duplicates,
      created: novos.length,
      updated: atualizacoes.filter((u) => Object.keys(u.data).length || u.tags.length).length,
      unchanged: atualizacoes.filter((u) => !Object.keys(u.data).length && !u.tags.length).length,
      duplicates,
      invalid: invalid.slice(0, 50),
      invalidCount: invalid.length,
      unknownTags: [...unknownTags].slice(0, 50),
      dryRun: !!dto.dryRun,
    };
    if (dto.dryRun) return report;

    if (novos.length) {
      await this.prisma.contact.createMany({
        data: novos.map((r) => ({ tenantId, phone: r.phone, name: r.name, nameSource: r.name ? 'manual' as const : 'whatsapp' as const, email: r.email, document: r.document, address: r.address, note1: r.note1, note2: r.note2 })),
        skipDuplicates: true,
      });
    }
    const criados = novos.length ? await this.prisma.contact.findMany({ where: { tenantId, phone: { in: novos.map((r) => r.phone) } }, select: { id: true, phone: true } }) : [];
    const vinculos = [
      ...criados.flatMap((c) => (tagsDosNovos.get(c.phone) ?? []).map((tagId) => ({ contactId: c.id, tagId }))),
      ...atualizacoes.flatMap((u) => u.tags.map((tagId) => ({ contactId: u.id, tagId }))),
    ];
    // em blocos: milhares de updates numa transação só seguram o banco
    const mudancas = atualizacoes.filter((u) => Object.keys(u.data).length);
    for (let i = 0; i < mudancas.length; i += 200) {
      await this.prisma.$transaction(mudancas.slice(i, i + 200).map((u) => this.prisma.contact.update({ where: { id: u.id }, data: u.data })));
    }
    if (vinculos.length) await this.prisma.contactTag.createMany({ data: vinculos, skipDuplicates: true });
    this.log.log(`Importação de contatos: ${report.created} novos, ${report.updated} atualizados, ${report.invalidCount} inválidos`, { tenantId });
    return report;
  }
}

/** Importar/exportar a base de contatos em planilha — docs/07-api.md › /contacts. */
@Controller('contacts')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
@RequirePermission('contacts.import_export')
class ContactsIoController {
  constructor(private readonly io: ContactsIoService) {}

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) {
    const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    res.setHeader('Content-Disposition', `attachment; filename="contatos-${dia}.csv"`);
    return this.io.exportCsv(u.tenantId);
  }

  @Post('import')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) {
    return this.io.import(u.tenantId, dto);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ContactsIoController],
  providers: [ContactsIoService],
})
export class ContactsModule {}
