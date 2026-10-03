# Шрифт заголовков

Скрипт `build-font.py` скачивает шрифты-кандидаты из github.com/google/fonts (Cormorant Garamond, Lora),
выбирает первый, в котором есть все казахские буквы, делает подмножество (woff2, вес 600)
и вставляет его в index.html между метками `/*FONT:START*/ … /*FONT:END*/`.

Запуск из папки проекта (PowerShell):

```
python -m pip install fonttools brotli
python tools/font/build-font.py
```

Скачанные .ttf и готовый head-font.woff2 в git не попадают (см. .gitignore).
Лицензии шрифтов — OFL-*.txt в этой папке.

У Cormorant Garamond по умолчанию «старинные» цифры, поэтому в index.html для цен и заголовков
включено `font-variant-numeric: lining-nums` (цифры одинаковой высоты).
