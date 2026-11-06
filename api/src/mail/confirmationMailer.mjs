import nodemailer from 'nodemailer';
import { env } from '../config/env.mjs';

function smtpAuth(config) {
  if (Boolean(config.user) !== Boolean(config.password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be provided together');
  }
  return config.user ? { user: config.user, pass: config.password } : undefined;
}

function transportOptions(config) {
  if (!config.host || !config.from) {
    throw new Error('Enabled mail requires SMTP_HOST and MAIL_FROM');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new Error('SMTP_TIMEOUT_MS must be a positive integer');
  }
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: smtpAuth(config),
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    dnsTimeout: config.timeoutMs
  };
}

// The factory lets tests exercise email composition and failures without a network transport.
export function createConfirmationMailer(config, createTransport = nodemailer.createTransport) {
  let transport;
  return {
    async sendConfirmation(registration, event) {
      if (!config.enabled) return;

      // Validate and create lazily so mail configuration cannot prevent API startup.
      transport ??= createTransport(transportOptions(config));
      await transport.sendMail({
        from: config.from,
        to: registration.email,
        subject: 'Registration confirmed: ' + event.title,
        text: [
          `Hello ${registration.name},`,
          '',
          `You are registered for ${event.title}.`,
          `Location: ${event.location}`,
          `Starts at: ${new Date(event.startsAt).toISOString()} (UTC)`,
          '',
          'Campus Events'
        ].join('\n')
      });
    }
  };
}

export const confirmationMailer = createConfirmationMailer(env.mail);
