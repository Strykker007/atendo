import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { ShiftAccessService } from './shift-access.service';
import { AccessLogService } from './access-log.service';
import { AccessLogController } from './access-log.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, AccessLogController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, TenantGuard, PermissionsGuard, PermissionsService, ShiftAccessService, AccessLogService],
  exports: [AuthService, JwtAuthGuard, RolesGuard, TenantGuard, PermissionsGuard, PermissionsService, ShiftAccessService, AccessLogService, JwtModule],
})
export class AuthModule {}
