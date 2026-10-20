import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../../config/env';

export interface MailMessage {
  to: string | string[];
  subject: string;
  /** texto simples (sempre) */
  text: string;
  /** HTML opcional; se ausente, gera a partir do texto */
  html?: string;
}

/**
 * E-mail transacional via Brevo (BREVO_API_KEY, prioridade) ou Resend (RESEND_API_KEY).
 * Sem nenhuma chave (dev) o e-mail vai para o log da API — o fluxo continua funcionando e o
 * link aparece no terminal.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private readonly provider: 'brevo' | 'resend' | null = env.BREVO_API_KEY ? 'brevo' : env.RESEND_API_KEY ? 'resend' : null;
  private readonly resend = this.provider === 'resend' ? new Resend(env.RESEND_API_KEY) : null;
  readonly enabled = !!this.provider;

  async send(msg: MailMessage) {
    if (!this.provider) {
      this.log.log(`[e-mail simulado] para: ${Array.isArray(msg.to) ? msg.to.join(', ') : msg.to} | assunto: ${msg.subject}\n${msg.text}`);
      return { simulated: true };
    }
    const html = msg.html ?? this.wrap(msg.subject, msg.text);
    const error = this.provider === 'brevo' ? await this.sendBrevo(msg, html) : await this.sendResend(msg, html);
    if (error) {
      this.log.error(`falha ao enviar e-mail "${msg.subject}" (${this.provider}): ${error}`);
      throw new Error(error);
    }
    return { simulated: false };
  }

  private async sendResend(msg: MailMessage, html: string): Promise<string | null> {
    const { error } = await this.resend!.emails.send({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html });
    return error ? error.message : null;
  }

  /** API transacional do Brevo: POST /v3/smtp/email. O remetente precisa estar validado na conta. */
  private async sendBrevo(msg: MailMessage, html: string): Promise<string | null> {
    const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((email) => ({ email }));
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: parseSender(env.MAIL_FROM), to, subject: msg.subject, textContent: msg.text, htmlContent: html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return null;
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      return `HTTP ${res.status}${body?.code ? ` ${body.code}` : ''}: ${body?.message ?? res.statusText}`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Layout simples e legível em qualquer cliente de e-mail. */
  private wrap(title: string, text: string) {
    const body = text
      .split('\n')
      .map((l) => (/^https?:\/\/\S+$/.test(l.trim()) ? `<p style="margin:16px 0"><a href="${l.trim()}" style="background:#2f5bea;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${l.trim()}</a></p>` : `<p style="margin:0 0 10px">${escapeHtml(l) || '&nbsp;'}</p>`))
      .join('');
    return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1e2433;max-width:560px;margin:0 auto;padding:24px"><h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h2>${body}<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">Atendo · atendimento via WhatsApp</p></div>`;
  }
}

/** "Atendo <no-reply@dominio>" → { name, email }; aceita também só o e-mail. */
const parseSender = (from: string) => {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: from.trim() };
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
