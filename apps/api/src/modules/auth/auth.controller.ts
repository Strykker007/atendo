import { Body, Controller, ForbiddenException, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { NoTenantOk } from './tenant.guard';
import { env } from '../../config/env';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
class EmailDto {
  @IsEmail() email: string;
}
class TokenPasswordDto {
  @IsString() token: string;
  @IsString() @MinLength(8) password: string;
}
class ChangePasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(8) password: string;
}
class UpdateMeDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
}

const COOKIE = 'atendo_rt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookie(res: Response, token: string, maxAge: number) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge,
    });
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto.email, dto.password, { userAgent: req.headers['user-agent'], ip: req.ip });
    this.setCookie(res, r.refreshToken, r.refreshMaxAge);
    return { accessToken: r.accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = parseCookie(req.headers.cookie)[COOKIE] ?? '';
    const r = await this.auth.refresh(token, { userAgent: req.headers['user-agent'], ip: req.ip });
    this.setCookie(res, r.refreshToken, r.refreshMaxAge);
    return { accessToken: r.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(parseCookie(req.headers.cookie)[COOKIE] ?? '');
    res.clearCookie(COOKIE, { path: '/auth' });
  }

  /** Esqueci a senha — sempre 200 (não revela se o e-mail existe). */
  @Post('forgot')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async forgot(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Post('reset')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async reset(@Body() dto: TokenPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Post('accept-invite')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async acceptInvite(@Body() dto: TokenPasswordDto) {
    const u = await this.auth.acceptInvite(dto.token, dto.password);
    return { ok: true, email: u.email };
  }

  @Post('change-password')
  @HttpCode(200)
  @NoTenantOk()
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    if (user.impersonatorId) throw new ForbiddenException('Dono entrando como cliente não troca a senha do cliente.');
    await this.auth.changePassword(user.id, dto.current, dto.password);
    return { ok: true };
  }

  /** Editar o próprio perfil (nome de exibição). Vale para qualquer papel. */
  @Patch('me')
  @NoTenantOk()
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    if (user.impersonatorId) throw new ForbiddenException('Dono entrando como cliente não altera o perfil do cliente.');
    return this.auth.updateName(user.id, dto.name);
  }

  @Get('me')
  @NoTenantOk()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

function parseCookie(header?: string): Record<string, string> {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}
