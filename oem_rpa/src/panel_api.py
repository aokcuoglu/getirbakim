"""
KULLANIM DISI (deprecated).

Ilk tasarimda dogrudan panel API'sine yaziyorduk. Ancak RPA ciktisi web
cikarimi sinifi bir veri oldugu icin (uretici katalogu degil), dogrudan
product_oems/product_overrides'a yazmak yanlis: yanlis bir OEM, tedarikci
eslestirmesini (match-supplier-rows rung 2a/2b) bozar.

Dogru akis: cikti onay kuyruguna (catalog.product_ref_suggestions, PENDING)
gider ve Zenginlestirme ekraninda onaylanir. Bkz. src/suggestions.py ve README.

Bu dosya artik kullanilmiyor; ileride silinebilir.
"""
