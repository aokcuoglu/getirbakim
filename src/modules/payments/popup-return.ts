import "server-only";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/site";
import { PAYMENT_WINDOW } from "./messages";

/**
 * Ends the payment window: inside our popup it notifies the opener and closes itself; opened any other
 * way (popup blocked, no JS, new tab on mobile) it continues to the order page.
 */
export function popupReturn(orderId: string, result: string) {
  const target = new URL(`/siparis/${orderId}?odeme=${result}`, siteUrl).toString();
  const message = JSON.stringify({ type: "tami-payment", orderId, result });
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Getirbakım ödeme</title><noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;color:#212b36}</style></head>
<body><p>Getirbakım’a dönülüyor…</p><script>
(function(){var t=${JSON.stringify(target)};
try{if(window.name===${JSON.stringify(PAYMENT_WINDOW)}&&window.opener&&!window.opener.closed){window.opener.postMessage(${message},location.origin);window.close();}}catch(e){}
setTimeout(function(){location.replace(t)},400);})();
</script></body></html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
