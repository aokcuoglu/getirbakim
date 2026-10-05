"""Generate outlined SVG brand assets. Requires fonttools[woff] (see docs/brand-guide.md)."""
from pathlib import Path
from html import escape
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root = Path(__file__).resolve().parents[1]
out = root / 'public/brand'
out.mkdir(exist_ok=True)
font = TTFont(root / 'public/media/trodo/fonts/Inter-SemiBold.woff2')
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm

def text(value, x, y, size, color):
    parts = []
    scale = size / units
    for char in value:
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        parts.append(f'<path d="{pen.getCommands()}" transform="translate({x:.3f} {y}) scale({scale:.6f} {-scale:.6f})" fill="{color}"/>')
        x += glyph.width * scale
    return ''.join(parts)

def svg(width, height, title, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img"><title>{escape(title)}</title>{body}</svg>'

for name, color in [('light', '#0077c7'), ('dark', '#ffffff')]:
    (out / f'logo-{name}.svg').write_text(svg(230, 52, 'getirbakim', text('getirbakim', 2, 38, 40, color)))
# A dotted i inside a search lens: a small-size symbol derived from the wordmark.
symbol = '<rect width="128" height="128" rx="28" fill="#0077c7"/><circle cx="59" cy="57" r="32" fill="none" stroke="white" stroke-width="8"/><path d="m83 82 24 24" stroke="white" stroke-width="10" stroke-linecap="round"/><circle cx="59" cy="43" r="5" fill="white"/><path d="M59 57v17" stroke="white" stroke-width="8" stroke-linecap="round"/>'
(out / 'profile.svg').write_text(svg(128, 128, 'Getirbakim', symbol))
(root / 'src/app/icon.svg').write_text(svg(128, 128, 'Getirbakim', symbol))
for filename, kicker, lines, foot in [
    ('social-getirbakim', 'GETİRBAKİM NEDİR?', ['Parçadan anlayan', 'insanların yedek', 'parça mağazası.'], 'Araç sahiplerine ve oto servislerine.'),
    ('social-bir-bakalim', 'BİR BAKALIM', ['Aynı model.', 'Farklı motor.', 'Farklı parça.'], 'OEM kodunu ve araç özelliklerini karşılaştır.'),
    ('social-servisler', 'SERVİSLER İÇİN GETİRBAKİM', ['Servisinin parça', 'ihtiyacı için', 'güvenilir tedarik.'], 'Servis hesabına başvur: getirbakim.com/servisler'),
]:
    body = '<rect width="1080" height="1080" fill="#eef7fd"/><circle cx="990" cy="60" r="220" fill="#0077c7" opacity=".08"/>'
    body += text('getirbakim', 80, 145, 68, '#0077c7')
    body += text(kicker, 80, 300, 25, '#0077c7')
    for index, line in enumerate(lines): body += text(line, 80, 420 + index * 90, 62, '#222831')
    body += text(foot, 80, 810, 27, '#222831')
    body += '<path d="M80 865H1000" stroke="#0077c7" stroke-width="2"/>'
    body += text('Bir bakalım, doğru parçayı bulalım.', 80, 935, 30, '#0077c7')
    (out / f'{filename}.svg').write_text(svg(1080, 1080, kicker, body))
print('Outlined SVG brand assets generated.')
