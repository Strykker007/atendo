import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
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
