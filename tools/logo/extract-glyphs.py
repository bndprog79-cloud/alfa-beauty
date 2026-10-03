"""
Контуры букв монограммы «AB» для логотипа (ILLUSTRATIONS.logo в index.html).

Берёт буквы из шрифта заголовков (Cormorant Garamond, вес 600), ставит их рядом
с небольшим сближением, масштабирует под нужную высоту и центрирует в точке.
Печатает готовый атрибут d="…" для <path> — его вставляют в логотип вручную.

Запуск (из папки проекта):  python tools/logo/extract-glyphs.py
Нужно: python -m pip install fonttools  и  python tools/font/build-font.py (скачивает .ttf)
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(os.path.dirname(HERE), "font", "CormorantGaramond[wght].ttf")

TEXT = "AB"
WEIGHT = 600
CAP_HEIGHT = 38.0     # высота букв в единицах viewBox логотипа
CENTER = (60.0, 58.0)  # центр монограммы в viewBox 0 0 120 120
TRACKING = -0.06      # сближение букв (доля от кегля)


def fmt(v):
    s = ("%.1f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def main():
    if not os.path.exists(FONT):
        sys.exit("Нет файла шрифта. Сначала запустите tools/font/build-font.py")
    font = TTFont(FONT)
    if "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": WEIGHT})
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    hmtx = font["hmtx"]

    # Раскладка в единицах шрифта и общие границы
    placed = []
    x = 0.0
    for ch in TEXT:
        name = cmap[ord(ch)]
        placed.append((name, x))
        x += hmtx[name][0] + TRACKING * upm
    bounds = None
    for name, dx in placed:
        bp = BoundsPen(gs)
        gs[name].draw(TransformPen(bp, (1, 0, 0, 1, dx, 0)))
        if bp.bounds:
            b = bp.bounds
            bounds = b if bounds is None else (min(bounds[0], b[0]), min(bounds[1], b[1]),
                                               max(bounds[2], b[2]), max(bounds[3], b[3]))

    xmin, ymin, xmax, ymax = bounds
    k = CAP_HEIGHT / (ymax - ymin)
    cx, cy = CENTER
    ox = cx - (xmin + xmax) / 2 * k
    oy = cy + (ymin + ymax) / 2 * k

    pen = SVGPathPen(gs, ntos=fmt)
    for name, dx in placed:
        # y в шрифте вверх, в SVG вниз — отражаем
        gs[name].draw(TransformPen(pen, (k, 0, 0, -k, ox + dx * k, oy)))
    print(pen.getCommands())
    print("ширина монограммы: %.1f, высота: %.1f" % ((xmax - xmin) * k, CAP_HEIGHT), file=sys.stderr)


if __name__ == "__main__":
    main()
