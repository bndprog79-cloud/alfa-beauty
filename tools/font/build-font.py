"""
Подготовка шрифта заголовков для index.html.

1. Скачивает кандидатов (Cormorant Garamond, Lora) из github.com/google/fonts.
2. Проверяет, есть ли в шрифте все казахские буквы. Выбирает первого подходящего.
3. Делает статический вес, подмножество символов, woff2, base64.
4. Вставляет результат в index.html между метками /*FONT:START*/ и /*FONT:END*/.

Запуск (из папки проекта):  python tools/font/build-font.py
Нужно: python -m pip install fonttools brotli
"""
import base64
import io
import os
import re
import sys
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
INDEX = os.path.join(ROOT, "index.html")
RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

CANDIDATES = [
    {"name": "Cormorant Garamond", "dir": "cormorantgaramond", "file": "CormorantGaramond[wght].ttf", "wght": 600},
    {"name": "Lora", "dir": "lora", "file": "Lora[wght].ttf", "wght": 500},
]

KAZAKH = "әғқңөұүһіӘҒҚҢӨҰҮҺІ"
MAX_WOFF2 = 80 * 1024

# Подмножество: латиница, кириллица (с казахскими), цифры, ₸, типографские знаки
UNICODES = (
    list(range(0x20, 0x7F))            # базовая латиница, цифры, пунктуация
    + list(range(0xA0, 0x100))         # Latin-1: «» · © nbsp и т. п.
    + list(range(0x400, 0x460))        # кириллица
    + [ord(c) for c in KAZAKH]
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x201E, 0x2026,
       0x2022, 0x2116, 0x2248, 0x2039, 0x203A, 0x20B8]  # – — ‘ ’ “ ” „ … • № ≈ ‹ › ₸
)


def download(url, path):
    if os.path.exists(path):
        return
    print("Скачиваю", url)
    with urllib.request.urlopen(url) as r, open(path, "wb") as f:
        f.write(r.read())


def main():
    report = []
    chosen = None
    for c in CANDIDATES:
        src = os.path.join(HERE, c["file"])
        download(RAW + c["dir"] + "/" + c["file"].replace("[", "%5B").replace("]", "%5D"), src)
        download(RAW + c["dir"] + "/OFL.txt", os.path.join(HERE, "OFL-" + c["dir"] + ".txt"))
        cmap = TTFont(src).getBestCmap()
        missing = [ch for ch in KAZAKH if ord(ch) not in cmap]
        has_tenge = 0x20B8 in cmap
        ok = not missing
        report.append("%s: казахские буквы %s, ₸ %s" % (
            c["name"], "все есть" if ok else "нет " + "".join(missing), "есть" if has_tenge else "нет"))
        if ok and chosen is None:
            chosen = c
    print("\n".join(report))
    if not chosen:
        sys.exit("Ни один шрифт не содержит все казахские буквы")

    font = TTFont(os.path.join(HERE, chosen["file"]))
    if "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": chosen["wght"]})

    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "lnum", "tnum", "pnum", "onum", "locl"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)

    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    data = buf.getvalue()
    print("Выбран: %s, вес %d, woff2 %.1f КБ, ₸ в подмножестве: %s" % (
        chosen["name"], chosen["wght"], len(data) / 1024,
        "да" if 0x20B8 in font.getBestCmap() else "нет"))
    if len(data) > MAX_WOFF2:
        sys.exit("Шрифт больше 80 КБ")

    with open(os.path.join(HERE, "head-font.woff2"), "wb") as f:
        f.write(data)

    b64 = base64.b64encode(data).decode("ascii")
    face = ("/*FONT:START*/@font-face{font-family:\"AB Head\";src:url(data:font/woff2;base64,%s) format(\"woff2\");"
            "font-weight:%d;font-style:normal;font-display:swap}/*FONT:END*/") % (b64, chosen["wght"])
    with open(INDEX, "r", encoding="utf-8", newline="") as f:
        html = f.read()
    new, n = re.subn(r"/\*FONT:START\*/.*?/\*FONT:END\*/", lambda m: face, html, flags=re.S)
    if n != 1:
        sys.exit("В index.html не найдена метка /*FONT:START*/ … /*FONT:END*/")
    with open(INDEX, "w", encoding="utf-8", newline="") as f:
        f.write(new)
    print("Шрифт вставлен в index.html")


if __name__ == "__main__":
    main()
