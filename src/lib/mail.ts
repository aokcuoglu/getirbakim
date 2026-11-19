import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { contactEmail } from "@/lib/site";

/**
 * Outgoing email (#951). MAIL_TRANSPORT picks the transport: `smtp` (any provider, e.g. Amazon SES SMTP) or `file`
 * (writes .eml files for local checks, refused in production). Unset, unknown or incomplete settings send nothing:
 * sendMail returns `skipped` so callers record it instead of failing the order flow.
 */
export type MailConfig =
  | { kind: "smtp"; from: string; replyTo: string; host: string; port: number; secure: boolean; user: string | null; password: string | null }
  | { kind: "file"; from: string; replyTo: string; dir: string }
  | { kind: "none"; reason: string };

export type MailMessage = { to: string; subject: string; text: string; html: string; messageId?: string };
export type MailResult = { status: "sent"; messageId: string } | { status: "skipped"; reason: string };

type Env = Record<string, string | undefined>;
const value = (env: Env, key: string) => env[key]?.trim() || null;

export function mailConfig(env: Env = process.env): MailConfig {
  const transport = value(env, "MAIL_TRANSPORT");
  if (!transport) return { kind: "none", reason: "MAIL_TRANSPORT is not set" };
  if (transport !== "smtp" && transport !== "file") return { kind: "none", reason: `unknown MAIL_TRANSPORT ${transport}` };
  const from = value(env, "MAIL_FROM");
  if (!from) return { kind: "none", reason: "MAIL_FROM is missing" };
  const replyTo = value(env, "MAIL_REPLY_TO") ?? contactEmail;
  if (transport === "file") {
    if (env.NODE_ENV === "production") return { kind: "none", reason: "MAIL_TRANSPORT=file is refused in production" };
    return { kind: "file", from, replyTo, dir: value(env, "MAIL_FILE_DIR") ?? ".local/mail" };
  }
  const host = value(env, "SMTP_HOST");
  if (!host) return { kind: "none", reason: "SMTP_HOST is missing" };
  const port = Number(value(env, "SMTP_PORT") ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { kind: "none", reason: "SMTP_PORT is invalid" };
  const user = value(env, "SMTP_USER"), password = env.SMTP_PASSWORD || null;
  // Credentials come as a pair; one without the other would fail every send at the server.
  if (Boolean(user) !== Boolean(password)) return { kind: "none", reason: "SMTP_USER and SMTP_PASSWORD must be set together" };
  return { kind: "smtp", from, replyTo, host, port, secure: value(env, "SMTP_SECURE") === "true", user, password };
}

const transporters = new Map<string, Transporter>();

function smtpTransport(config: Extract<MailConfig, { kind: "smtp" }>) {
  const key = JSON.stringify(config);
  let transporter = transporters.get(key);
  if (!transporter) {
    // SMTP_SECURE=true: implicit TLS (port 465); otherwise STARTTLS is required, never plain text.
    transporter = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure,
      auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    transporters.set(key, transporter);
  }
  return transporter;
}

/** Sends one message; transport errors throw. An unconfigured transport returns `skipped` without throwing. */
export async function sendMail(message: MailMessage, config: MailConfig = mailConfig()): Promise<MailResult> {
  if (config.kind === "none") return { status: "skipped", reason: config.reason };
  const mail = { from: config.from, replyTo: config.replyTo, to: message.to, subject: message.subject, text: message.text, html: message.html, messageId: message.messageId };
  if (config.kind === "smtp") {
    const info = await smtpTransport(config).sendMail(mail);
    return { status: "sent", messageId: info.messageId };
  }
  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }).sendMail(mail);
  if (!Buffer.isBuffer(info.message)) throw new Error("Mail file transport returned no buffer");
  await mkdir(config.dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${info.messageId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80)}.eml`;
  await writeFile(path.join(config.dir, name), info.message);
  return { status: "sent", messageId: info.messageId };
}
