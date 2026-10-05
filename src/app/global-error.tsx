"use client";

export default function GlobalError({ retry }: { retry: () => void }) {
  return <html lang="tr"><body style={{ margin: 0, padding: "48px 20px", background: "#f7f8fa", color: "#222831", fontFamily: "system-ui, sans-serif" }}>
    <title>Geçici sorun | Getirbakim</title>
    <main style={{ maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>
      <h1>Şu anda siteyi açamıyoruz.</h1>
      <p>Geçici bir sorun oluştu. Lütfen tekrar dene.</p>
      <button onClick={retry} style={{ minHeight: 48, padding: "12px 24px", border: 0, borderRadius: 8, background: "#0077c7", color: "white", font: "inherit", cursor: "pointer" }}>Tekrar dene</button>
    </main>
  </body></html>;
}
