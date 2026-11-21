import { contactEmail, contactPhone, siteName } from "@/lib/site";

// Shared HTML pieces of the order emails (#951, #1036): inline styles only, no remote images. Pure, no database access.

export const colors = { text: "#222831", muted: "#626b75", link: "#0077c7", divider: "#e5e7eb" };

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export const html = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");
export const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });
export const linkDate = (value: Date) => value.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long" });
/** +902163870078 → +90 216 387 00 78 */
export const phoneLabel = (phone: string) => phone.replace(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/, "+90 $1 $2 $3 $4");

/** `content` is HTML already escaped by the caller. */
export const p = (content: string, style = "") => `<p style="margin:0 0 12px;${style}">${content}</p>`;
export const heading = (content: string) => `<h2 style="margin:24px 0 8px;font-size:16px;line-height:24px;font-weight:600;color:${colors.text};">${content}</h2>`;
/** `label` is HTML already escaped by the caller; the URL is escaped here. */
export const link = (label: string, url: string) => `<a href="${escapeHtml(url)}" style="color:${colors.link};text-decoration:underline;">${label}</a>`;
export const orderLabel = (number: string) => `<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:${colors.muted};">SİPARİŞ #${html(number)}</p>`;
export const title = (content: string) => `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:${colors.text};">${html(content)}</h1>`;
export const footerStart = `<div style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${colors.divider};">`;

export const contactText = `Sorun olursa bize ${contactEmail} adresinden ya da ${phoneLabel(contactPhone)} numarasından ulaşabilirsin.`;
export const contactHtml = () =>
  p(`Sorun olursa bize ${link(html(contactEmail), `mailto:${contactEmail}`)} adresinden ya da ${link(html(phoneLabel(contactPhone)), `tel:${contactPhone}`)} numarasından ulaşabilirsin.`, `color:${colors.muted};font-size:13px;`);

/** The full HTML document around an email body. */
export function emailDocument(subject: string, body: string) {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${colors.text};">
<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:${colors.text};">${html(siteName)}</p>
${body}
</td></tr></table>
</td></tr></table>
</body></html>`;
}
