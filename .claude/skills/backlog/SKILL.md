---
name: backlog
description: Triage and burn down the getirbakim GitHub backlog — runs the getirbakim-triage agent over all open issues, applies the safe, evidenced bookkeeping (tick checklists, close verifiably-done issues, link duplicates), and reports a priority order plus the next conflict-free parallel wave for /ship. Use for "/backlog", "ne kaldı?", "issue'ları temizle", or after a batch of merges.
---

1. `cd /Users/void/www/getirbakim && git fetch origin` (ana checkout'u değiştirme; ajan `origin/dev`'i okur).
2. `getirbakim-triage`'ı çağır (ek argüman gerekmez). Tablosunu bekle.
3. Yalnız geri alınabilir ve kanıtlı düzenlemeleri uygula:
   - Merge edilmiş PR'ı olan checklist maddelerini işaretle (`gh issue view N --json body -q .body` → düzenle → `gh issue edit N --body-file …`; gövdenin geri kalanını koru).
   - **bitti** olanları kanıtı anan yorumla kapat: `gh issue close N --comment "Done in #PR — <kanıt>"`.
   - **mükerrer**: "Duplicate of #M" yorumu, yenisini kapat.
   - **geçersiz** ve **operasyon**: otomatik kapatma — gerekçesiyle kullanıcıya listele.
   - **kısmen**: kalanı yorum olarak yaz; kalan farklı bir kapsamsa `/issue` kurallarıyla yeni Issue aç ve bağla.
4. Kullanıcıya Türkçe raporla: açık sayısı (önce → sonra), neyin neden kapandığı, öncelik sırası ve sonraki paralel dalga. Dalgayı `/ship` ile başlatmayı öner (worktree'ler paralel, tarayıcı QA'sı tek tek).
