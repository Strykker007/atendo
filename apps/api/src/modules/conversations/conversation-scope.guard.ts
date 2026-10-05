import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseNumber, unrestricted } from '../auth/number-scope';
import { canSeeDepartment, departmentRestricted } from '../auth/department-scope';
import type { AuthUser } from '../auth/current-user.decorator';

/**
 * Impede que quem opera só alguns números abra uma conversa de outro número — e que quem é
 * só de alguns departamentos abra a de outro departamento (ver department-scope.ts).
 *
 * Fica num ponto só, no controller, em vez de repetido em cada método do service: são dez
 * rotas `:id` hoje e vão aparecer mais, e a que esquecessem de checar seria o furo.
 *
 * Responde **404, não 403**: um 403 confirmaria que a conversa existe, e para quem não pode
 * vê-la ela não deveria sequer ser distinguível de uma inexistente.
 */
@Injectable()
export class ConversationScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; params?: Record<string, string> }>();
    const user = req.user;
    const id = req.params?.id;
    if (!user || !id || (unrestricted(user) && !departmentRestricted(user))) return true;

    const conv = await this.prisma.conversation.findFirst({ where: { id, tenantId: user.tenantId }, select: { numberId: true, departmentId: true } });
    // conversa inexistente segue o fluxo normal: quem responde 404 com a mensagem certa é o
    // service, e duplicar isso aqui só criaria duas mensagens para o mesmo caso
    if (conv && (!canUseNumber(user, conv.numberId) || !canSeeDepartment(user, conv.departmentId))) throw new NotFoundException('Conversa não encontrada');
    return true;
  }
}
