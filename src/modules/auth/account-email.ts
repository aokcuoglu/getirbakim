import { colors, contactHtml, contactText, emailDocument, footerStart, html, link, p, title } from "@/modules/store/order-email-layout";
import { unverifiedKeepPeriod } from "./verification-policy";

// Account e-mails (#1257, #1258). Pure: the caller sends them.

/** The password reset e-mail; `url` carries the single-use token. */
export function buildPasswordResetEmail({ name, url, minutes }: { name: string; url: string; minutes: number }) {
  const subject = "Şifre yenileme bağlantın";
  const greeting = `Merhaba ${name},`;
  const intro = "Getirbakim hesabının şifresini yenilemek için bir talep aldık. Yeni şifreni belirlemek için aşağıdaki bağlantıyı aç:";
  const validity = `Bağlantı ${minutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir. Bağlantıyı kimseyle paylaşma.`;
  const ignore = "Bu talebi sen yapmadıysan bu e-postayı dikkate alma; şifren değişmez.";
  const text = [greeting, "", intro, url, "", validity, "", ignore, "", contactText].join("\n");
  const body = [
    title(subject),
    p(html(greeting)),
    p(html(intro)),
    p(link("Şifremi yenile", url), "font-weight:600;"),
    p(html(validity)),
    p(html(ignore), `color:${colors.muted};`),
    `${footerStart}${contactHtml()}</div>`,
  ].join("\n");
  return { subject, text, html: emailDocument(subject, body) };
}

/**
 * The e-mail verification e-mail (#1258); `url` carries the single-use token. It greets without the name: the name comes
 * from an unverified signup form, so anyone could make it say something to any address.
 */
export function buildEmailVerificationEmail({ url, hours }: { url: string; hours: number }) {
  const subject = "E-posta adresini doğrula";
  const greeting = "Merhaba,";
  const intro = "Getirbakim hesabını açmak için e-posta adresini doğrula. Aşağıdaki bağlantıyı aç:";
  const validity = `Bağlantı ${hours} saat geçerlidir ve yalnızca bir kez kullanılabilir.`;
  const ignore = `Bu hesabı sen oluşturmadıysan bağlantıyı açma; doğrulanmayan kayıt ${unverifiedKeepPeriod} içinde silinir.`;
  const text = [greeting, "", intro, url, "", validity, "", ignore, "", contactText].join("\n");
  const body = [
    title(subject),
    p(html(greeting)),
    p(html(intro)),
    p(link("E-postamı doğrula", url), "font-weight:600;"),
    p(html(validity)),
    p(html(ignore), `color:${colors.muted};`),
    `${footerStart}${contactHtml()}</div>`,
  ].join("\n");
  return { subject, text, html: emailDocument(subject, body) };
}

/** Sent instead of a verification when a signup names an address that already has an account (#1258). */
export function buildAccountExistsEmail({ name, loginUrl, resetUrl }: { name: string; loginUrl: string; resetUrl: string }) {
  const subject = "Zaten bir Getirbakim hesabın var";
  const greeting = `Merhaba ${name},`;
  const intro = "Bu e-posta adresiyle yeni bir kayıt denendi; hesabın zaten açık. Giriş yap ya da şifreni unuttuysan yenile.";
  const ignore = "Bu denemeyi sen yapmadıysan bir şey yapmana gerek yok; hesabın değişmedi.";
  const text = [greeting, "", intro, "", `Giriş yap: ${loginUrl}`, `Şifreni yenile: ${resetUrl}`, "", ignore, "", contactText].join("\n");
  const body = [
    title(subject),
    p(html(greeting)),
    p(html(intro)),
    p(`${link("Giriş yap", loginUrl)} · ${link("Şifreni yenile", resetUrl)}`, "font-weight:600;"),
    p(html(ignore), `color:${colors.muted};`),
    `${footerStart}${contactHtml()}</div>`,
  ].join("\n");
  return { subject, text, html: emailDocument(subject, body) };
}
