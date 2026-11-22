import { colors, contactHtml, contactText, emailDocument, footerStart, html, link, p, title } from "@/modules/store/order-email-layout";

// Account e-mails (#1257). Pure: the caller sends them.

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
