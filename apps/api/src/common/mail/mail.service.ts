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
 * E-mail transacional via Resend. Sem RESEND_API_KEY (dev) o e-mail vai para o log da API —
 * o fluxo continua funcionando e o link aparece no terminal.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private readonly client = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  readonly enabled = !!this.client;

  async send(msg: MailMessage) {
    if (!this.client) {
      this.log.log(`[e-mail simulado] para: ${Array.isArray(msg.to) ? msg.to.join(', ') : msg.to} | assunto: ${msg.subject}\n${msg.text}`);
      return { simulated: true };
    }
    const { error } = await this.client.emails.send({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html ?? this.wrap(msg.subject, msg.text) });
    if (error) {
      this.log.error(`falha ao enviar e-mail "${msg.subject}": ${error.message}`);
      throw new Error(error.message);
    }
    return { simulated: false };
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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
