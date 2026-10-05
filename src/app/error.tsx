"use client";
export default function ErrorPage({retry}:{retry:()=>void}) {return <section className="empty"><h1>Şu anda bu alanı açamıyoruz.</h1><p>Lütfen tekrar dene. Sorun sürerse Getirbakim yönetimiyle iletişime geç.</p><button onClick={retry}>Tekrar dene</button></section>;}
