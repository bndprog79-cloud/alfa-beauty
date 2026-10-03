/*
 * Иллюстрации прайса (объект ILLUSTRATIONS в index.html).
 *
 * Рисунки описаны здесь кодом: контуры — вручную, повторяющаяся геометрия
 * (пряди, спирали, кисти, лепестки) — маленькими функциями-помощниками.
 * Скрипт собирает SVG-строки и вставляет их в index.html между метками
 * /*ILL:START*\/ … /*ILL:END*\/.
 *
 * Запуск (из папки проекта):  node tools/illustrations/build-illustrations.js
 *
 * Правила (docs/TZ.md, раздел 7, и решения этапа 4):
 *  - viewBox 0 0 200 140 (логотип — 0 0 120 120), рисунок в «рабочей зоне» x 44–156, y 16–124,
 *    чтобы мини-версия (квадрат 48px, обрезка до x 30–170) оставалась целой;
 *  - цветной стиль «Яркий»: цвета — палитра иллюстраций (--ill-*), своя в каждой теме;
 *  - цвета только классами, классы красятся в CSS через var(--...);
 *  - никаких id, градиентов, масок, clipPath — оттенки только прозрачностью и наложением;
 *  - каждая обводка — <path pathLength="1"> (для анимации прорисовки).
 *
 * Классы рисунков (палитра --ill-*):
 *   заливки: c-bg — подложка, c-hd / c-hm / c-hl — волосы тёмные / средние / светлые, c-sk — кожа,
 *            c-be — ягодный, c-go — золото, c-mt — металл;
 *   линии:   lc — тонкий контур (--ill-line), lh — светлые пряди (--ill-hair-light), lo — золото (--ill-gold).
 * Логотип — в прежнем стиле темы: lg / la — линии --gold / --accent; fl, fs, fg, fw — заливки.
 *
 * Растровые иллюстрации (feet-*): готовые картинки assets/<ключ>.png → WebP → data:image/webp;base64
 * (объект RASTER и функция rasterBlock ниже; нужен ffmpeg).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');

// ─────────── Числа и пути ───────────
function n(v) {
  const s = (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return s === '-0' ? '0' : s;
}
function pt(p) { return n(p[0]) + ' ' + n(p[1]); }

const STROKES = /(^| )(lc|lh|lo|lg|la)( |$)/;

// Один элемент рисунка. attrs — например { op: .4 } (fill-opacity) или { o: .6 } (opacity)
function P(cls, d, attrs) {
  attrs = attrs || {};
  let s = '<path class="' + cls + '"';
  if (attrs.op != null) s += ' fill-opacity="' + attrs.op + '"';
  if (attrs.o != null) s += ' opacity="' + attrs.o + '"';
  s += ' d="' + d.replace(/\s+/g, ' ').trim() + '"';
  if (STROKES.test(cls)) s += ' pathLength="1"';
  return s + '/>';
}

function circle(c, r) {
  return 'M' + n(c[0] - r) + ' ' + n(c[1]) + 'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0' +
    'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0';
}

// ─────────── Векторы ───────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const perp = (a) => [-a[1], a[0]];
const rot = (a, deg) => {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
const dirDeg = (deg) => rot([1, 0], deg);

// Гладкая линия через точки (Catmull-Rom → кубические Безье). Без «M», если cont = true.
function smooth(pts, cont) {
  let d = cont ? '' : 'M' + pt(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += 'C' + pt(c1) + ' ' + pt(c2) + ' ' + pt(p2);
  }
  return d;
}

// Точки по замкнутому/открытому полилинейному контуру из локальной системы (u — вдоль оси, v — поперёк)
function frame(origin, angleDeg) {
  const u = dirDeg(angleDeg), v = perp(u);
  return (a, b) => add(origin, add(mul(u, a), mul(v, b)));
}
function poly(pts) { return 'M' + pts.map(pt).join('L') + 'Z'; }

// ─────────── Составная кривая Безье (осевая линия пряди) ───────────
function bez(seg, t) {
  const m = 1 - t;
  return [0, 1].map((k) => m * m * m * seg[0][k] + 3 * m * m * t * seg[1][k] + 3 * m * t * t * seg[2][k] + t * t * t * seg[3][k]);
}
function bezD(seg, t) {
  const m = 1 - t;
  return [0, 1].map((k) => 3 * m * m * (seg[1][k] - seg[0][k]) + 6 * m * t * (seg[2][k] - seg[1][k]) + 3 * t * t * (seg[3][k] - seg[2][k]));
}
function curve(segs) {
  const at = (t) => {
    const x = Math.min(t, 0.999999) * segs.length, i = Math.floor(x), s = segs[i];
    return { p: bez(s, x - i), d: bezD(s, x - i) };
  };
  return at;
}

// Прядь: осевая линия + ширина w(t). Возвращает помощники для контура, полос и линий-волосков.
function strand(segs, width) {
  const at = curve(segs);
  const side = (t, k) => { const a = at(t); return add(a.p, mul(norm(perp(a.d)), k * width(t) / 2)); };
  const range = (t0, t1, k, steps) => {
    const out = [];
    for (let i = 0; i <= steps; i++) out.push(side(t0 + (t1 - t0) * i / steps, k));
    return out;
  };
  const steps = (t0, t1) => Math.max(3, Math.round((t1 - t0) * 16));
  return {
    // Контур части пряди от t0 до t1 (полоса окраски)
    band(t0, t1) {
      const s = steps(t0, t1);
      const left = range(t0, t1, 1, s);
      const right = range(t0, t1, -1, s).reverse();
      let d = smooth(left) + 'L' + pt(right[0]) + smooth(right, true);
      // Верхний срез пряди — мягкой дугой, а не прямой
      if (t0 === 0) { const a = at(0); d += 'Q' + pt(sub(a.p, mul(norm(a.d), width(0) * 0.3))) + ' ' + pt(left[0]); }
      return d + 'Z';
    },
    // Волосок внутри пряди: смещение k (−1…1) от оси
    hair(t0, t1, k) { return smooth(range(t0, t1, k, steps(t0, t1))); },
    side
  };
}

// ─────────── Помощники рисунков ───────────
// Плоская кисть для окрашивания: tip — край щетины, angle — направление от щетины к ручке,
// paint — класс цвета краски на щетине, grip — класс цвета ручки
function brush(tip, angle, k, paint, grip) {
  const f = frame(tip, angle);
  const bristle = 'M' + pt(f(0, -7 * k)) + 'Q' + pt(f(-1.5 * k, 0)) + ' ' + pt(f(0, 7 * k)) +
    'L' + pt(f(12 * k, 6 * k)) + 'L' + pt(f(12 * k, -6 * k)) + 'Z';
  const ferrule = poly([f(12 * k, -5.6 * k), f(20 * k, -5 * k), f(20 * k, 5 * k), f(12 * k, 5.6 * k)]);
  const handle = 'M' + pt(f(20 * k, -4 * k)) + 'C' + pt(f(36 * k, -3.6 * k)) + ' ' + pt(f(52 * k, -1.6 * k)) + ' ' + pt(f(66 * k, 0)) +
    'C' + pt(f(52 * k, 1.6 * k)) + ' ' + pt(f(36 * k, 3.6 * k)) + ' ' + pt(f(20 * k, 4 * k)) + 'Z';
  return P('lc ' + grip, handle) + P('lc c-go', ferrule) + P('lc ' + paint, bristle);
}

// Лист/лепесток: из точки base в направлении angle, длина l, ширина w
function leaf(base, angle, l, w) {
  const f = frame(base, angle);
  return 'M' + pt(f(0, 0)) + 'Q' + pt(f(l * 0.45, w)) + ' ' + pt(f(l, 0)) + 'Q' + pt(f(l * 0.55, -w)) + ' ' + pt(f(0, 0)) + 'Z';
}

// Искорка (четырёхлучевая звёздочка)
function sparkle(c, r) {
  const q = r * 0.18;
  return 'M' + pt([c[0], c[1] - r]) + 'Q' + pt([c[0] + q, c[1] - q]) + ' ' + pt([c[0] + r, c[1]]) +
    'Q' + pt([c[0] + q, c[1] + q]) + ' ' + pt([c[0], c[1] + r]) +
    'Q' + pt([c[0] - q, c[1] + q]) + ' ' + pt([c[0] - r, c[1]]) +
    'Q' + pt([c[0] - q, c[1] - q]) + ' ' + pt([c[0], c[1] - r]) + 'Z';
}

// Спираль-локон: от центра наружу
function spiral(c, r, turns, start) {
  const pts = [];
  const steps = Math.round(turns * 10);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = (start || 0) + t * turns * 2 * Math.PI;
    const rr = r * (0.18 + 0.82 * t);
    pts.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  }
  return smooth(pts);
}

// Капля (остриём вверх)
function drop(c, r) {
  return 'M' + pt([c[0], c[1] - r * 1.7]) + 'Q' + pt([c[0] + r * 1.05, c[1] - r * 0.5]) + ' ' + pt([c[0] + r, c[1]]) +
    'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + pt([c[0] - r, c[1]]) +
    'Q' + pt([c[0] - r * 1.05, c[1] - r * 0.5]) + ' ' + pt([c[0], c[1] - r * 1.7]) + 'Z';
}

// Скруглённый прямоугольник, повёрнутый вокруг точки origin
function rrect(origin, angle, x, y, w, h, r) {
  const f = frame(origin, angle);
  const c = (a, b) => pt(f(a, b));
  return 'M' + c(x + r, y) + 'L' + c(x + w - r, y) + 'Q' + c(x + w, y) + ' ' + c(x + w, y + r) +
    'L' + c(x + w, y + h - r) + 'Q' + c(x + w, y + h) + ' ' + c(x + w - r, y + h) +
    'L' + c(x + r, y + h) + 'Q' + c(x, y + h) + ' ' + c(x, y + h - r) +
    'L' + c(x, y + r) + 'Q' + c(x, y) + ' ' + c(x + r, y) + 'Z';
}

// Подложка — одинаковая для всех рисунков (единый визуальный вес)
const BG = P('c-bg', circle([100, 70], 46));
// Золотая искорка
const glow = (c, r) => P('c-go', sparkle(c, r));

function svg(body, viewBox) {
  return '<svg class="il" viewBox="' + (viewBox || '0 0 200 140') + '" aria-hidden="true" focusable="false">' + body + '</svg>';
}

// ─────────── Пряди: тень, блики, переходы ───────────
// Область пряди между смещениями k0(t)…k1(t) (−1 — один край, 1 — другой)
function region(s, t0, t1, k0, k1, steps) {
  const m = steps || 14, a = [], b = [];
  for (let i = 0; i <= m; i++) {
    const t = t0 + (t1 - t0) * i / m;
    a.push(s.side(t, k0(t)));
    b.push(s.side(t, k1(t)));
  }
  b.reverse();
  return smooth(a) + 'L' + pt(b[0]) + smooth(b, true) + 'Z';
}
// Блик-мазок вдоль волос: узкий в начале и в конце
function streak(s, k, t0, t1, w) {
  const bump = (t) => Math.sin(Math.PI * (t - t0) / (t1 - t0));
  return region(s, t0, t1, (t) => k - w * bump(t), (t) => k + w * bump(t));
}
// Плавный переход без градиента: стопка полос одной прозрачности, гуще к началу (t0)…
function stack(s, t0, t1, count, cls, op) {
  let out = '';
  for (let i = 0; i < count; i++) out += P(cls, s.band(t0, t0 + (t1 - t0) * (i + 1) / count), { op: op });
  return out;
}
// …или гуще к концу (t1)
function stackDown(s, t0, t1, count, cls, op) {
  let out = '';
  for (let i = 0; i < count; i++) out += P(cls, s.band(t0 + (t1 - t0) * i / count, t1), { op: op });
  return out;
}
// Прядь «с объёмом»: основной цвет, тень с одного края, светлый блик, тонкий волосок
function hairStrand(s, base) {
  return P('lc ' + base, s.band(0, 1)) +
    P('c-hd', region(s, 0, 1, () => -1, () => -0.15), { op: 0.75 }) +
    P('c-hl', streak(s, 0.4, 0.06, 0.72, 0.16), { op: 0.9 }) +
    P('lc', s.hair(0.12, 0.92, -0.3), { o: 0.45 });
}

// ─────────── Общая прядь для color-* ───────────
const COLOR_STRAND = strand(
  [[[84, 18], [70, 44], [104, 60], [88, 84]], [[88, 84], [78.4, 98.4], [82, 112], [90, 122]]],
  (t) => 27 * (1 - Math.pow(t, 2.6))
);
// base — класс основного цвета, layers — слои окраски поверх
function colorStrand(base, layers) {
  const s = COLOR_STRAND;
  return P('lc ' + base, s.band(0, 1)) + (layers || '') +
    P('lc', s.hair(0.04, 0.72, 0.35), { o: 0.4 }) + P('lc', s.hair(0.1, 0.9, -0.3), { o: 0.4 });
}

// ─────────── Рисунки ───────────
const ILL = {};

// Логотип: монограмма «AB» (контуры из шрифта, tools/logo/extract-glyphs.py) в тонком круге с веточкой
const AB = 'M35.7 62.2 36.4 60.7H53.1L53.5 62.2ZM67.3 76Q67.6 76 67.6 76.4Q67.6 76.8 67.3 76.8Q65.6 76.8 63.7 76.6Q61.8 76.5 60.1 76.5Q58.1 76.5 56.6 76.6Q55.2 76.8 53.4 76.8Q53.2 76.8 53.2 76.4Q53.2 76 53.4 76Q56.1 76 56.6 75.1Q57.1 74.1 55.7 71.3L43.3 46.1L45.7 42.1L33.9 68.6Q32.4 72.2 33.8 74.1Q35.3 76 38.8 76Q39.1 76 39.1 76.4Q39.1 76.8 38.8 76.8Q37 76.8 35.6 76.6Q34.1 76.5 31.8 76.5Q29.5 76.5 28.2 76.6Q26.8 76.8 24.9 76.8Q24.6 76.8 24.6 76.4Q24.6 76 24.9 76Q26.5 76 27.6 75.4Q28.8 74.7 29.9 73Q31.1 71.2 32.5 68L45.3 39.2Q45.3 39 45.8 39Q46.2 39 46.2 39.2L60.8 68.6Q62.2 71.5 63.3 73.1Q64.3 74.7 65.3 75.4Q66.3 76 67.3 76ZM81.9 56.7 82.5 55.7Q86.4 55.7 89.3 57Q92.2 58.4 93.8 60.6Q95.4 62.9 95.4 65.9Q95.4 69 93.7 71.6Q92 74.1 89 75.5Q86 77 82.3 77Q80.6 77 78.1 76.8Q75.7 76.6 73.6 76.6Q71.6 76.6 69.7 76.7Q67.8 76.8 66.3 76.8Q66.1 76.8 66.1 76.4Q66.1 76 66.3 76Q68.1 76 69.1 75.7Q70.1 75.5 70.5 74.6Q70.9 73.7 70.9 71.9V44.4Q70.9 42.6 70.5 41.8Q70.1 40.9 69.1 40.6Q68.2 40.3 66.3 40.3Q66.2 40.3 66.2 39.9Q66.2 39.5 66.3 39.5Q67.8 39.5 69.7 39.6Q71.6 39.7 73.6 39.7Q75.3 39.7 77.2 39.5Q79.1 39.4 80.9 39.4Q84.4 39.4 86.8 40.3Q89.3 41.2 90.5 42.9Q91.8 44.7 91.8 47.1Q91.8 50.4 89.2 53Q86.6 55.6 81.9 56.7ZM79.8 40.5Q78.6 40.5 77.9 40.8Q77.1 41.2 76.8 42Q76.5 42.8 76.5 44.5V56.2L74.5 55.7Q76.4 55.8 77.7 55.8Q78.9 55.9 79 55.9Q82.7 55.9 84.5 53.5Q86.2 51.1 86.2 47.6Q86.2 45.4 85.5 43.8Q84.8 42.2 83.4 41.4Q82 40.5 79.8 40.5ZM81.3 75.7Q85.5 75.7 87.5 73.5Q89.4 71.3 89.4 67.4Q89.4 62.9 87.1 60.1Q84.8 57.4 80.1 57.3Q79.2 57.3 77.8 57.4Q76.3 57.4 74.7 57.7L76.5 57V71.9Q76.5 73.2 76.9 74Q77.2 74.9 78.2 75.3Q79.2 75.7 81.3 75.7Z';
ILL.logo = svg(
  P('fw', circle([60, 60], 56)) +
  P('lg', circle([60, 60], 56)) +
  P('lg', circle([60, 60], 51.5), { o: 0.55 }) +
  P('fs', AB) +
  // веточка под монограммой
  P('lg', 'M40 91C50 97 70 97 80 91') +
  P('la fl', leaf([48, 95], 200, 9, 3)) + P('la fl', leaf([54, 96.4], 145, 8, 2.8)) +
  P('la fl', leaf([66, 96.4], 35, 8, 2.8)) + P('la fl', leaf([72, 95], -20, 9, 3)) +
  P('fg', circle([60, 96.6], 1.6)),
  '0 0 120 120'
);

// hair-base: каштановая прядь с тенью и бликом, ножницы с ягодными кольцами
(function () {
  const s = strand(
    [[[76, 18], [62, 44], [94, 58], [80, 82]], [[80, 82], [70.4, 96.4], [74, 110], [82, 122]]],
    (t) => 22 * (1 - Math.pow(t, 2.6))
  );
  const pivot = [124, 72];
  const blade = (tip) => {
    const d = norm(sub(tip, pivot)), q = perp(d);
    const a = add(pivot, mul(q, 4)), b = sub(pivot, mul(q, 3));
    const mid = add(pivot, mul(sub(tip, pivot), 0.5));
    return 'M' + pt(a) + 'Q' + pt(add(mid, mul(q, 4))) + ' ' + pt(tip) + 'Q' + pt(sub(mid, mul(q, 1))) + ' ' + pt(b) + 'Z';
  };
  const handle = (tip, k, r) => {
    const d = norm(sub(pivot, tip));
    const c = add(pivot, mul(d, k));
    const edge = sub(c, mul(d, r));
    return P('lc', 'M' + pt(add(pivot, mul(d, 3))) + 'L' + pt(edge)) + P('lc c-be', circle(c, r)) + P('c-bg', circle(c, r * 0.45));
  };
  const t1 = [94, 38], t2 = [90, 60];
  ILL['hair-base'] = svg(BG +
    hairStrand(s, 'c-hm') +
    handle(t1, 25, 7.5) + handle(t2, 24, 7.5) +
    P('lc c-mt', blade(t1)) + P('lc c-mt', blade(t2)) +
    P('c-go', circle(pivot, 2.4)) +
    glow([142, 40], 5) + glow([152, 54], 3)
  );
})();

// hair-men: мужской профиль (силуэт одной линией), короткая тёмная стрижка
(function () {
  const face = 'M85 44C81 50 80 54 80 58C80 61 78 64 75.5 67.5C74.5 69.5 76.5 71 78.5 71C78.5 74 78.5 77 79.5 79.5' +
    'C79.5 84 80.5 88 85 89.5C89 91 93 91.5 95.5 91.5C96 101 95 111 94 122';
  ILL['hair-men'] = svg(BG +
    P('c-sk', face + 'L128 122C124 110 122.5 96 124 84L120 40L90 34Z') +
    P('lc', face) + P('lc', 'M124 84C122.5 96 124 110 128 122') +
    P('lc c-hd', 'M84 44C79 35 83 25 94 21C105 17 121 18 129 26C135 33 136 45 134 55C132 66 129 76 124 84' +
      'C121 82 118 78 117 73C116 68 114 64 110 62C107 61 105 63 104 68L102 74C100 66 99 58 95 52C92 48 88 46 84 44Z') +
    P('lh', 'M89 31C99 24 115 23 125 30') +
    P('lh', 'M92 39C103 33 117 34 127 42', { o: 0.7 }) +
    P('lh', 'M118 50C124 56 127 64 126 74', { o: 0.5 }) +
    glow([146, 34], 5) + glow([154, 48], 3)
  );
})();

// hair-women: женский профиль, каре карамельного цвета
(function () {
  const face = 'M84 45C81 50 80 54 80 58C80 61 78.5 64 76.5 67.5C75.5 69.5 77 70.8 79 71C79 74 79 76 80 78' +
    'C80 82 81.5 86 85 87.5C88.5 89 92 89.5 94.5 89.5C95.5 100 96 111 97 122';
  ILL['hair-women'] = svg(BG +
    P('c-sk', face + 'L127 122C123 114 121 104 122 93L140 40L96 22Z') +
    P('lc', face) + P('lc', 'M122 93C121 104 123 114 127 122') +
    P('lc c-hm', 'M84 46C80 36 86 24 98 20C112 16 130 20 138 34C144 46 142 62 140 74C139 82 140 88 143 92' +
      'C133 97 116 97 104 93C101 92 99 90 99 86C100 76 98 64 94 56C92 52 89 49 84 46Z') +
    P('c-hd', 'M128 30C138 40 140 58 137 76C136 84 137 89 140 93C134 95 128 95.5 122 95.5C127 80 130 50 128 30Z', { op: 0.55 }) +
    P('lh', 'M87 34C96 36 101 44 100 54') +
    P('lh', 'M104 24C121 24 133 38 133 58C133 72 130 82 126 92', { o: 0.8 }) +
    P('lc', 'M112 30C124 36 126 54 122 70C120 79 118 86 116 93', { o: 0.45 }) +
    P('c-go', circle([101.5, 97.5], 2.4)) +
    glow([150, 40], 5) + glow([156, 56], 3)
  );
})();

// hair-styling: волнистая светлая прядь и ягодный фен
(function () {
  const s = strand(
    [[[66, 22], [56, 34], [78, 42], [66, 56]], [[66, 56], [54, 70], [78, 78], [66, 92]], [[66, 92], [57.6, 101.8], [64, 114], [70, 122]]],
    (t) => 22 * (1 - Math.pow(t, 3))
  );
  ILL['hair-styling'] = svg(BG +
    hairStrand(s, 'c-hl') +
    P('lc', 'M94 44Q88 42 82 44', { o: 0.5 }) + P('lc', 'M95 52H81', { o: 0.5 }) + P('lc', 'M94 60Q88 62 82 60', { o: 0.5 }) +
    P('lc c-be', 'M126 64L132 96Q133 101 138 100.4Q143 99.6 142 94L138 64Z') +
    P('lc c-mt', 'M112 44L100 46.5Q98.4 52 100 57.5L112 60Z') +
    P('lc c-be', rrect([0, 0], 0, 112, 40, 38, 24, 12)) +
    P('c-bg', rrect([0, 0], 0, 118, 44, 18, 4, 2), { op: 0.6 }) +
    P('lc', 'M141 46.5V57.5') + P('lc', 'M145 48.5V55.5') +
    P('lo', 'M127.5 72H139.1') +
    P('c-go', circle([135, 82], 2)) +
    glow([150, 30], 4)
  );
})();

// hair-prom: собранная причёска (вид сзади), блонд, шпилька-цветок
(function () {
  let flower = '';
  for (let i = 0; i < 5; i++) flower += P('lc c-be', leaf([121, 26], -90 + i * 72, 9, 4.2));
  ILL['hair-prom'] = svg(BG +
    P('c-sk', 'M90 86C90 100 89 110 86 122L114 122C111 110 110 100 110 86Z') +
    P('lc', 'M90 88C90 100 89 110 86 122') + P('lc', 'M110 88C110 100 111 110 114 122') +
    P('lc c-hl', 'M76 66C74 48 86 36 100 36C114 36 126 48 124 66C123 76 118 84 112 88Q100 94 88 88C82 84 77 76 76 66Z') +
    P('c-hm', 'M108 38C118 42 125 54 124 66C123 76 118 84 112 88Q106 91 100 91C110 80 114 56 108 38Z', { op: 0.45 }) +
    P('lc c-hl', circle([100, 30], 13)) +
    P('lc', spiral([100, 30], 9, 1.6, 0.5), { o: 0.55 }) +
    P('lc', 'M84 82C84 66 90 52 96 44', { o: 0.5 }) + P('lc', 'M100 89C100 74 100 58 100 46', { o: 0.5 }) +
    P('lc', 'M116 82C116 66 110 52 104 44', { o: 0.5 }) +
    P('lc', 'M78 72C72 80 77 88 73 96C71 100 73 104 76 103') +
    P('lo', 'M106 38L118 28') +
    flower + P('c-go', circle([121, 26], 2.6)) +
    glow([146, 52], 4) + glow([152, 66], 2.6)
  );
})();

// hair-afro: облако тёмных спиральных кудрей над профилем
(function () {
  const c = [112, 50], R = 28, k = 11;
  let cloud = '';
  for (let i = 0; i <= k; i++) {
    const a = (i / k) * 2 * Math.PI - Math.PI / 2;
    const p = [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)];
    if (i === 0) { cloud = 'M' + pt(p); continue; }
    const m = a - Math.PI / k;
    cloud += 'Q' + pt([c[0] + R * 1.3 * Math.cos(m), c[1] + R * 1.3 * Math.sin(m)]) + ' ' + pt(p);
  }
  cloud += 'Z';
  const curls = [[98, 36, 0], [116, 28, 2], [132, 42, 4], [113, 49, 1], [96, 58, 3], [130, 62, 5], [113, 70, 2]];
  let body = '';
  curls.forEach((q) => { body += P('lh', spiral([q[0], q[1]], 6, 1.7, q[2])); });
  const face = 'M77 60C75 63 74 65.5 74 68C74 71 72.5 74 70.5 77.5C69.5 79.5 71 80.8 73 81C73 84 73 86 74 88' +
    'C74 92 75.5 96 79 97.5C82.5 99 86 99.5 88.5 99.5C89.5 107 90 114 91 122';
  ILL['hair-afro'] = svg(BG +
    P('c-sk', face + 'L124 122C119.5 112 117.5 98 119 88L110 52Z') +
    P('lc', face) + P('lc', 'M119 88C117.5 98 119.5 112 124 122') +
    P('lc c-hd', cloud) + body +
    glow([150, 100], 4.5) + glow([156, 86], 3)
  );
})();

// color-base: каштановая прядь переходит в ягодный оттенок, кисть с краской
ILL['color-base'] = svg(BG +
  colorStrand('c-hd', stackDown(COLOR_STRAND, 0.36, 1, 7, 'c-be', 0.2)) +
  brush([104, 46], -25, 0.75, 'c-be', 'c-hd') +
  glow([146, 96], 4.5) + glow([152, 82], 3)
);

// color-ombre: тёмно-каштановый верх → карамель → блонд на кончиках
ILL['color-ombre'] = svg(BG +
  colorStrand('c-hl', stack(COLOR_STRAND, 0, 0.82, 9, 'c-hm', 0.17) + stack(COLOR_STRAND, 0, 0.52, 7, 'c-hd', 0.19)) +
  P('lc c-hd', drop([130, 46], 8)) +
  P('lc c-hm', drop([130, 74], 8)) +
  P('lc c-hl', drop([130, 102], 8)) +
  glow([148, 106], 4.5) + glow([150, 32], 3)
);

// color-degrade: чёткие полосы оттенков и веер образцов
(function () {
  const s = COLOR_STRAND;
  const bands = P('c-hm', s.band(0.26, 1)) + P('c-be', s.band(0.5, 1), { op: 0.75 }) + P('c-hl', s.band(0.72, 1));
  const pivot = [124, 108];
  const blade = (ang, cls) => P('lc ' + cls, rrect(pivot, ang, -4, -6, 46, 12, 6));
  ILL['color-degrade'] = svg(BG +
    colorStrand('c-hd', bands) +
    blade(-45, 'c-hl') + blade(-68, 'c-be') + blade(-91, 'c-hd') +
    P('c-go', circle(pivot, 2.4)) +
    glow([150, 36], 4)
  );
})();

// color-balayage: каштановая основа со светлыми мазками и кисть
(function () {
  const s = COLOR_STRAND;
  ILL['color-balayage'] = svg(BG +
    colorStrand('c-hd', [0.3, 0.5, 0.7].map((t) => P('c-hm', s.band(t, 1), { op: 0.35 })).join('') +
      P('c-hl', streak(s, 0.45, 0.22, 0.88, 0.17)) +
      P('c-hl', streak(s, -0.12, 0.32, 0.96, 0.15)) +
      P('c-hl', streak(s, -0.62, 0.16, 0.72, 0.13), { op: 0.85 }) +
      P('c-go', streak(s, 0.1, 0.4, 0.8, 0.06), { op: 0.7 })) +
    brush([110, 58], -30, 0.75, 'c-hl', 'c-be') +
    glow([136, 96], 5) + glow([150, 80], 3.2)
  );
})();

// color-solid: прядь ровного ягодного цвета и чаша с краской
ILL['color-solid'] = svg(BG +
  colorStrand('c-be', P('c-hl', streak(COLOR_STRAND, 0.4, 0.06, 0.8, 0.14), { op: 0.4 })) +
  P('lc c-hd', 'M128 82L147 42Q149 38.6 151.6 40Q153.8 41.6 152 45L135.5 82') +
  P('lc c-mt', 'M110 84Q112 108 130 108Q148 108 150 84Z') +
  P('lc c-be', 'M112.5 84C116 88 144 88 147.5 84C144 80.5 116 80.5 112.5 84Z') +
  P('lc', 'M110 84C112 79 148 79 150 84') +
  P('lo', 'M122 108L120 113H140L138 108') +
  glow([146, 118], 4) + glow([152, 64], 3)
);

// color-roots: блонд с тёмными корнями и кисть у корней
ILL['color-roots'] = svg(BG +
  colorStrand('c-hl', P('c-hd', COLOR_STRAND.band(0, 0.24)) + P('c-hd', COLOR_STRAND.band(0.24, 0.3), { op: 0.5 }) +
    P('c-hd', COLOR_STRAND.band(0.3, 0.34), { op: 0.2 })) +
  brush([98, 30], -18, 0.75, 'c-hd', 'c-be') +
  glow([142, 92], 4.5) + glow([150, 106], 3)
);

// ─────────── Руки: кисть руки и ногти (nails-*) ───────────
// Тыльная сторона кисти: пальцы расслаблены и чуть разведены, кисть наклонена вправо,
// большой палец справа повёрнут боком (его ноготь виден сбоку).

// Палец в своей системе координат f(u, v): u — от основания к кончику, v — поперёк.
// W0 — ширина у основания, W — у кончика; лёгкие утолщения у суставов
function fingerD(f, L, W0, W) {
  const w = (t) => W0 + (W - W0) * t;
  const side = (k) => [0, 0.3, 0.62, 0.8].map((t) => f(t * L, k * (w(t) * (t === 0.62 ? 1.03 : 1)) / 2));
  const r = W / 2, e = L - r;
  const l = side(-1).concat([f(e, -r)]), rr = side(1).concat([f(e, r)]).reverse();
  return smooth(l) + 'C' + pt(f(e + r * 0.56, -r)) + ' ' + pt(f(L, -r * 0.56)) + ' ' + pt(f(L, 0)) +
    'C' + pt(f(L, r * 0.56)) + ' ' + pt(f(e + r * 0.56, r)) + ' ' + pt(rr[0]) + smooth(rr, true);
}

// Геометрия ногтя на кончике пальца: free — край ногтя (u), len — длина, w — полуширина, off — сдвиг поперёк
function nailBox(L, W, o) {
  o = o || {};
  const ext = o.ext || 0, len = W * (o.lk || 0.92) + ext, w = W * (o.wk || 0.34);
  return { top: L - W * 0.08 + ext, bot: L - W * 0.08 - W * (o.lk || 0.92), w: w, off: o.off || 0, len: len };
}
// Ноготь: мягкий скруглённый овал (shape 'almond' — миндаль со скруглённым кончиком)
function nailD(f, L, W, o) {
  const b = nailBox(L, W, o), w = b.w, top = b.top, bot = b.bot;
  const g = (u, v) => f(u, v + b.off);
  // кутикула (последний Q) — мягкая дуга, выпуклая к основанию пальца
  if (o && o.shape === 'almond') {
    const r = w * 0.42;
    return 'M' + pt(g(bot + w * 0.5, -w)) +
      'C' + pt(g(bot + (top - bot) * 0.55, -w * 1.06)) + ' ' + pt(g(top - r * 2.4, -r * 1.25)) + ' ' + pt(g(top - r * 0.9, -r)) +
      'C' + pt(g(top - r * 0.2, -r * 0.8)) + ' ' + pt(g(top, -r * 0.4)) + ' ' + pt(g(top, 0)) +
      'C' + pt(g(top, r * 0.4)) + ' ' + pt(g(top - r * 0.2, r * 0.8)) + ' ' + pt(g(top - r * 0.9, r)) +
      'C' + pt(g(top - r * 2.4, r * 1.25)) + ' ' + pt(g(bot + (top - bot) * 0.55, w * 1.06)) + ' ' + pt(g(bot + w * 0.5, w)) +
      'Q' + pt(g(bot - w * 0.55, 0)) + ' ' + pt(g(bot + w * 0.5, -w)) + 'Z';
  }
  return 'M' + pt(g(bot + w * 0.5, -w)) + 'C' + pt(g(bot + (top - bot) * 0.5, -w * 1.04)) + ' ' + pt(g(top - w * 1.1, -w * 1.02)) + ' ' + pt(g(top - w * 0.7, -w * 0.96)) +
    'C' + pt(g(top - w * 0.15, -w * 0.9)) + ' ' + pt(g(top, -w * 0.5)) + ' ' + pt(g(top, 0)) +
    'C' + pt(g(top, w * 0.5)) + ' ' + pt(g(top - w * 0.15, w * 0.9)) + ' ' + pt(g(top - w * 0.7, w * 0.96)) +
    'C' + pt(g(top - w * 1.1, w * 1.02)) + ' ' + pt(g(bot + (top - bot) * 0.5, w * 1.04)) + ' ' + pt(g(bot + w * 0.5, w)) +
    'Q' + pt(g(bot - w * 0.55, 0)) + ' ' + pt(g(bot + w * 0.5, -w)) + 'Z';
}
// Точка на ногте: t — доля длины от кутикулы (0) к краю (1), k — смещение поперёк (−1…1)
function nailAt(f, L, W, t, k, o) {
  const b = nailBox(L, W, o);
  return f(b.bot + (b.top - b.bot) * t, k * b.w + b.off);
}
// Френч: кончик ногтя от линии «улыбки» до края
function nailTipD(f, L, W, frac) {
  const b = nailBox(L, W), w = b.w, top = b.top, a = top - (top - b.bot) * frac;
  return 'M' + pt(f(a - w * 0.25, -w * 0.98)) + 'L' + pt(f(top - w * 0.7, -w * 0.96)) +
    'C' + pt(f(top - w * 0.15, -w * 0.9)) + ' ' + pt(f(top, -w * 0.5)) + ' ' + pt(f(top, 0)) +
    'C' + pt(f(top, w * 0.5)) + ' ' + pt(f(top - w * 0.15, w * 0.9)) + ' ' + pt(f(top - w * 0.7, w * 0.96)) +
    'L' + pt(f(a - w * 0.25, w * 0.98)) + 'Q' + pt(f(a + w * 0.75, 0)) + ' ' + pt(f(a - w * 0.25, -w * 0.98)) + 'Z';
}
// Блик на ногте — узкий мазок вдоль левого края; k — ширина мазка
function nailShine(f, L, W, o, k) {
  const b = nailBox(L, W, o), w = b.w, kk = k || 1;
  const a = b.bot + (b.top - b.bot) * 0.22, c = b.top - (b.top - b.bot) * 0.2, v = -w * 0.42 + b.off;
  return 'M' + pt(f(a, v)) + 'Q' + pt(f((a + c) / 2, v - w * 0.3 * kk)) + ' ' + pt(f(c, v)) +
    'Q' + pt(f((a + c) / 2, v + w * 0.14 * kk)) + ' ' + pt(f(a, v)) + 'Z';
}
// Страз: золотой камешек с бликом
const strass = (c, r) => P('lc c-go', circle(c, r)) + P('c-mt', circle(add(c, [-r * 0.32, -r * 0.32]), r * 0.36), { op: 0.9 });

// Система кисти H(u, v): u — вдоль пальцев (вверх), v — поперёк (вправо, к большому пальцу)
const HA = -80, H = frame([95, 74], HA);
// Пальцы слева направо: [u, v основания, поворот, длина, ширина у основания]; основания касаются друг друга
const FINGER_SPECS = [
  [-7, -16.9, -9, 32, 8.6],   // мизинец — самый короткий
  [-1, -7.7, -3.5, 44, 9.8],  // безымянный — чуть длиннее указательного
  [1, 2.4, 0, 48, 10.4],      // средний — самый длинный
  [-1.5, 12.6, 4.5, 41.5, 10] // указательный
];
const FINGERS = FINGER_SPECS.map((g) => ({ f: frame(H(g[0], g[1]), HA + g[2]), L: g[3], W0: g[4], W: g[4] * 0.84 }));
// Полуширина пальца на высоте u
const halfW = (g, u) => (g.W0 + (g.W - g.W0) * u / g.L) / 2;
// Большой палец: из правого края кисти вверх-вправо, виден сбоку; v > 0 — наружная сторона
const THUMB = { f: frame(H(-36, 20), HA + 22), L: 33, W0: 14, W: 9.8 };

// Перепонка между соседними пальцами: от боковой линии одного к боковой линии другого
function valley(a, b) {
  const pa = a.f(9, halfW(a, 9)), pb = b.f(9, -halfW(b, 9));
  const mid = mul(add(a.f(3, halfW(a, 3)), b.f(3, -halfW(b, 3))), 0.5);
  return [pa, mid, pb];
}
const VALLEYS = [0, 1, 2].map((i) => valley(FINGERS[i], FINGERS[i + 1]));
// Левый край (мизинец → запястье) и правый край (указательный → перепонка → большой палец → запястье)
const PK = FINGERS[0], IX = FINGERS[3], T = THUMB.f, TR = THUMB.W / 2, TL = THUMB.L;
const HAND_LEFT = [PK.f(9, -halfW(PK, 9)), PK.f(1, -PK.W0 / 2 - 0.2), H(-14, -21.6), H(-27, -20.4), H(-40, -17.6), H(-52, -15.6)];
const THUMB_IN = [IX.f(9, halfW(IX, 9)), IX.f(0, IX.W0 / 2), H(-10, 18.2), H(-18, 18.6), T(11, -6.4), T(22, -5.3), T(TL - TR, -TR)];
const THUMB_CAP = 'C' + pt(T(TL - TR * 0.44, -TR)) + ' ' + pt(T(TL, -TR * 0.56)) + ' ' + pt(T(TL, 0)) +
  'C' + pt(T(TL, TR * 0.56)) + ' ' + pt(T(TL - TR * 0.44, TR)) + ' ' + pt(T(TL - TR, TR));
const THUMB_OUT = [T(TL - TR, TR), T(21, 6.2), T(10, 7.2), H(-40, 23.4), H(-46, 17.6), H(-52, 14.6)];
const HAND_RIGHT = smooth(THUMB_IN) + THUMB_CAP + smooth(THUMB_OUT, true);
// Заливка кисти: левый край, запястье, правый край снизу вверх, перепонки между пальцами
const HAND_FILL = (function () {
  const outRev = THUMB_OUT.slice().reverse(), inRev = THUMB_IN.slice().reverse();
  const capRev = 'C' + pt(T(TL - TR * 0.44, TR)) + ' ' + pt(T(TL, TR * 0.56)) + ' ' + pt(T(TL, 0)) +
    'C' + pt(T(TL, -TR * 0.56)) + ' ' + pt(T(TL - TR * 0.44, -TR)) + ' ' + pt(T(TL - TR, -TR));
  let d = smooth(HAND_LEFT) + 'L' + pt(outRev[0]) + smooth(outRev, true) + capRev + smooth(inRev, true);
  for (let i = 2; i >= 0; i--) {
    const v = VALLEYS[i].slice().reverse();
    d += 'L' + pt(v[0]) + smooth(v, true);
  }
  return d + 'Z';
})();
// Мягкая тень вдоль левого края кисти
const HAND_SHADE = smooth([H(-6, -21.2), H(-14, -21), H(-27, -19.8), H(-40, -17), H(-52, -15)]) + 'L' + pt(H(-52, -11)) +
  smooth([H(-52, -11), H(-40, -13), H(-27, -15.6), H(-14, -17.4), H(-6, -18)], true) + 'Z';

// Тень вдоль левого края пальца
function fingerShade(g) {
  const f = g.f, L = g.L;
  return 'M' + pt(f(0, -g.W0 * 0.48)) + 'Q' + pt(f(L * 0.5, -g.W * 0.54)) + ' ' + pt(f(L - g.W * 0.5, -g.W * 0.4)) +
    'Q' + pt(f(L * 0.5, -g.W * 0.18)) + ' ' + pt(f(0, -g.W0 * 0.22)) + 'Z';
}
// Колечко на пальце: золотой ободок и камешек
function ring(g, t) {
  const f = g.f, u = g.L * t, h = halfW(g, u) + 0.5;
  return P('lc c-go', 'M' + pt(f(u, -h)) + 'Q' + pt(f(u - 1.6, 0)) + ' ' + pt(f(u, h)) + 'L' + pt(f(u + 2.4, h)) +
    'Q' + pt(f(u + 0.8, 0)) + ' ' + pt(f(u + 2.4, -h)) + 'Z') +
    P('lc c-mt', circle(f(u + 0.3, 0), 2.1)) + P('c-go', circle(f(u + 0.8, -0.6), 0.7), { op: 0.8 });
}

// nail(f, L, W, i, o) — разметка ногтя для пальца i (0 — мизинец … 3 — указательный, 4 — большой);
// o — геометрия ногтя (у большого пальца — узкий, сбоку). Колечко — на безымянном пальце.
function hand(nail) {
  let out = '';
  FINGERS.forEach((g) => { out += P('lc c-sk', fingerD(g.f, g.L, g.W0, g.W)) + P('c-hm', fingerShade(g), { op: 0.18 }); });
  out += P('c-sk', HAND_FILL) + P('c-hm', HAND_SHADE, { op: 0.18 });
  out += P('lc', smooth(HAND_LEFT)) + P('lc', HAND_RIGHT) + VALLEYS.map((v) => P('lc', smooth(v))).join('');
  out += ring(FINGERS[1], 0.3);
  FINGERS.forEach((g, i) => { out += nail(g.f, g.L, g.W, i, {}); });
  out += nail(THUMB.f, THUMB.L, THUMB.W, 4, { wk: 0.18, lk: 0.74, off: THUMB.W * 0.24 });
  return out;
}
const merge = (a, b) => Object.assign({}, a, b);

// nails-base: тыльная сторона кисти, ягодные ногти
ILL['nails-base'] = svg(BG +
  hand((f, L, W, i, o) => P('lc c-be', nailD(f, L, W, o))) +
  glow([64, 40], 5) + glow([56, 56], 3)
);

// nails-gel: глянцевые карамельные ногти с крупным бликом
ILL['nails-gel'] = svg(BG +
  hand((f, L, W, i, o) => P('lc c-hm', nailD(f, L, W, o)) +
    P('c-hl', nailShine(f, L, W, o, i === 4 ? 1 : 2), { op: 0.95 }) +
    (i < 4 ? P('c-hl', circle(nailAt(f, L, W, 0.8, 0.45, o), W * 0.07)) : '')) +
  glow([64, 40], 5) + glow([56, 56], 3) + glow([146, 30], 3.4)
);

// nails-classic: натуральные ногти и пилочка
ILL['nails-classic'] = svg(BG +
  hand((f, L, W, i, o) => P('lc c-be', nailD(f, L, W, o), { op: 0.25 }) +
    (i < 4 ? P('c-mt', nailTipD(f, L, W, 0.2), { op: 0.8 }) : '')) +
  P('lc c-be', rrect([51, 121], -80, 0, -3.4, 52, 6.8, 3.4)) +
  P('c-hl', rrect([51, 121], -80, 5, -1.4, 42, 2.8, 1.4), { op: 0.7 }) +
  glow([146, 30], 4.5) + glow([150, 46], 3)
);

// Перенос абсолютного пути (команды M L C Q H V Z): точка (x, y) → o + (x − 96, y − 120) · k
function tx(d, o, k) {
  let cmd = '', i = 0;
  return d.replace(/([MLCQHVZ])|(-?[\d.]+)/g, (m, c, num) => {
    if (c) { cmd = c; i = 0; return c; }
    const v = parseFloat(num), axis = cmd === 'H' ? 0 : cmd === 'V' ? 1 : i++ % 2;
    return n(axis === 0 ? o[0] + (v - 96) * k : o[1] + (v - 120) * k);
  });
}
// Флакон лака: o — середина дна, k — масштаб (1 — как в nails-coat); cap — закрытая золотая крышка
function polishBottle(o, k, cap) {
  const t = (d) => tx(d, o, k), m = (x, y) => [o[0] + (x - 96) * k, o[1] + (y - 120) * k];
  let out = P('lc c-be', t('M78 74C78 69 81 66 86 66H106C111 66 114 69 114 74V112C114 117 111 120 106 120H86C81 120 78 117 78 112Z')) +
    P('c-hd', t('M104 70C109 72 110 76 110 80V110C110 114 108 116 104 116H96C103 110 106 92 104 70Z'), { op: 0.35 }) +
    P('c-mt', t('M84 74C84 72 85 71 86.5 71C88 71 88.6 72 88.6 74V100C88.6 102 88 103 86.3 103C84.6 103 84 102 84 100Z'), { op: 0.85 }) +
    P('c-mt', circle(m(86.3, 108), 2.2 * k), { op: 0.85 }) +
    P('lc c-go', t('M88 66V58H104V66Z')) +
    P('lc', t('M88 61H104'), { o: 0.5 });
  if (cap) {
    out += P('lc c-go', t('M86 58V28Q86 24 90 24H102Q106 24 106 28V58Z')) +
      P('c-hl', t('M89 30Q89 28 91 28Q93 28 93 30V54H89Z'), { op: 0.85 }) +
      P('c-hd', t('M101 28Q103 29 103 31V56H100Z'), { op: 0.25 });
  }
  return out;
}

// nails-coat: флакон гель-лака и золотая кисточка-крышка с каплей лака
(function () {
  const cap = frame([126, 86], -62); // кисточка-крышка: от щетины вверх к ручке
  ILL['nails-coat'] = svg(BG +
    // флакон: стекло с лаком, тень, блик, горлышко
    polishBottle([96, 120], 1) +
    // кисточка-крышка: золотая ручка с бликом и ободком
    P('lc c-go', 'M' + pt(cap(18, -6.5)) + 'L' + pt(cap(52, -6)) + 'Q' + pt(cap(56, -6)) + ' ' + pt(cap(56, -2)) + 'L' + pt(cap(56, 2)) +
      'Q' + pt(cap(56, 6)) + ' ' + pt(cap(52, 6)) + 'L' + pt(cap(18, 6.5)) + 'Z') +
    P('c-hl', 'M' + pt(cap(22, -4.4)) + 'L' + pt(cap(50, -4.2)) + 'L' + pt(cap(50, -1.6)) + 'L' + pt(cap(22, -1.8)) + 'Z', { op: 0.85 }) +
    P('c-hd', 'M' + pt(cap(22, 3)) + 'L' + pt(cap(50, 2.8)) + 'L' + pt(cap(50, 4.6)) + 'L' + pt(cap(22, 5)) + 'Z', { op: 0.25 }) +
    P('lc c-hl', 'M' + pt(cap(13, -5)) + 'L' + pt(cap(18, -6.5)) + 'L' + pt(cap(18, 6.5)) + 'L' + pt(cap(13, 5)) + 'Z') +
    P('lc c-mt', 'M' + pt(cap(6, -1.6)) + 'L' + pt(cap(13, -1.8)) + 'L' + pt(cap(13, 1.8)) + 'L' + pt(cap(6, 1.6)) + 'Z') +
    P('lc c-be', 'M' + pt(cap(6, -3.2)) + 'C' + pt(cap(2, -3.4)) + ' ' + pt(cap(-3, -1.6)) + ' ' + pt(cap(-5, 0)) +
      'C' + pt(cap(-3, 1.6)) + ' ' + pt(cap(2, 3.4)) + ' ' + pt(cap(6, 3.2)) + 'Z') +
    // капля лака
    P('lc c-be', drop([118, 104], 3.6)) +
    glow([136, 112], 4.5) + glow([66, 50], 3.2)
  );
})();

// nails-design: пастельные ногти разных цветов, френч и золотые стразы
ILL['nails-design'] = svg(BG +
  hand((f, L, W, i, o) => {
    if (i === 0) return P('lc c-be', nailD(f, L, W, o), { op: 0.5 });                       // пудрово-розовый
    if (i === 1) return P('lc c-mt', nailD(f, L, W, o)) + P('c-be', nailTipD(f, L, W, 0.4)); // френч
    if (i === 2) return P('lc c-aq', nailD(f, L, W, o)) +                                       // мятный со стразами
      [0.28, 0.56, 0.84].map((t) => strass(nailAt(f, L, W, t, 0, o), W * 0.11)).join('');
    if (i === 3) return P('lc c-aq', nailD(f, L, W, o)) + strass(nailAt(f, L, W, 0.3, 0, o), W * 0.13);
    return P('lc c-hl', nailD(f, L, W, o));                                                    // большой — сливочный
  }) +
  glow([64, 40], 5) + glow([56, 56], 3)
);

// nails-extension: длинные миндалевидные ногти со скруглённым кончиком и бликом
ILL['nails-extension'] = svg(BG +
  hand((f, L, W, i, o) => {
    const e = merge(o, { ext: i === 4 ? W * 0.3 : W * 0.75, shape: 'almond' });
    return P('lc c-be', nailD(f, L, W, e)) + P('c-mt', nailShine(f, L, W, e), { op: 0.75 });
  }) +
  glow([64, 40], 5) + glow([56, 56], 3)
);

// ─────────── Ресницы и брови (lashes-base, lash-*, brow-*) ───────────
// Закрытый глаз: край века — плавная дуга вниз от внутреннего уголка A (слева) к внешнему B;
// верхнее веко выпуклое, складка высоко; ресницы растут от края века вниз и изгибаются вверх-наружу,
// к внешнему уголку длиннее. Бровь — над глазом на естественном расстоянии, как на лице.
const EYE = { A: [46, 56], C: [97, 92], B: [150, 48] };
const qp = (t) => { const m = 1 - t; return [0, 1].map((k) => m * m * EYE.A[k] + 2 * m * t * EYE.C[k] + t * t * EYE.B[k]); };
const qn = (t) => { // нормаль вниз (от века к ресницам)
  const m = 1 - t, d = [0, 1].map((k) => 2 * m * (EYE.C[k] - EYE.A[k]) + 2 * t * (EYE.B[k] - EYE.C[k]));
  return norm(perp(d));
};
// Одна ресница: сужающийся штрих от основания base под углом ang (градусы), длина l, ширина w, изгиб bend
function lashD(m, base, ang, l, w, bend) {
  const d = dirDeg(ang), p = perp(d);
  const tip = add(base, add(mul(d, l), mul(p, bend * 0.6)));
  const c = add(base, add(mul(d, l * 0.55), mul(p, bend)));
  return 'M' + pt(m(add(base, mul(p, -w / 2)))) + 'Q' + pt(m(c)) + ' ' + pt(m(tip)) +
    'Q' + pt(m(add(c, mul(p, w * 0.3)))) + ' ' + pt(m(add(base, mul(p, w / 2)))) + 'Z';
}
// Ресницы: n пучков вдоль века, в пучке per ресниц с разлётом spread; lk — длина, w — толщина у основания, curl — изгиб
function lashes(m, o) {
  let d = '';
  for (let i = 0; i < o.n; i++) {
    const t = 0.05 + 0.91 * i / (o.n - 1);
    const base = add(qp(t), mul(qn(t), 0.8));
    const l = (8 + 23 * Math.pow(t, 1.1)) * (t > 0.84 ? 1 - (t - 0.84) * 2.4 : 1) * (o.lk || 1);
    const ang = (o.ang0 || 108) - (o.ang1 || 64) * t;
    for (let j = 0; j < o.per; j++) {
      const s = o.per === 1 ? 0 : (j / (o.per - 1) - 0.5) * 2;
      d += lashD(m, add(base, mul(dirDeg(ang - 90), s * 0.9)), ang + s * (o.spread || 0), l * (1 - Math.abs(s) * 0.14),
        o.w || 2, (o.curl != null ? o.curl : -0.42) * l);
    }
  }
  return P('c-ik', d);
}
// Глаз: выпуклое веко (кожа, тень у складки, блик), складка, подводка по краю века и ресницы
function eye(m, o) {
  o = o || {};
  m = m || ((p) => p);
  const M = (pts) => pts.map(m);
  const lid = [], crease = [], shade = [], shine = [], top = [], bot = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, up = mul(qn(t), -1), h = Math.sin(Math.PI * t);
    lid.push(qp(t));
    crease.push(add(qp(t), mul(up, 2 + 32 * h)));
    shade.push(add(qp(t), mul(up, 1.5 + 21 * h)));
    shine.push(add(qp(t), mul(up, 1 + 10 * h)));
  }
  const rev = (a) => a.slice().reverse();
  let out = P('c-sk', smooth(M(lid)) + smooth(M(rev(crease)), true) + 'Z');
  out += P(o.shadow || 'c-hm', smooth(M(shade)) + smooth(M(rev(crease)), true) + 'Z', { op: o.shadowOp || 0.32 });
  // блик посередине века — веко выглядит выпуклым
  const sh = shine.slice(3, 12), sh2 = shade.slice(3, 12).map((p, k) => add(p, mul(sub(sh[k], p), 0.25)));
  out += P('c-hl', smooth(M(sh)) + smooth(M(rev(sh2)), true) + 'Z', { op: 0.5 });
  out += P('lc', smooth(M(crease.slice(1, 14))), { o: 0.6 });
  // подводка: полоса вдоль края века, толще к внешнему уголку
  const th = (t) => (o.liner || 2.2) * (0.3 + Math.sin(Math.PI * Math.min(t, 0.97)) * 0.7 * (0.55 + 0.45 * t));
  for (let i = 0; i <= 14; i++) { const t = i / 14; top.push(add(qp(t), mul(qn(t), -th(t) * 0.3))); }
  for (let i = 14; i >= 0; i--) { const t = i / 14; bot.push(add(qp(t), mul(qn(t), th(t) * 0.7))); }
  let liner = smooth(M(top)) + 'L' + pt(m(bot[0])) + smooth(M(bot), true) + 'Z';
  if (o.wing) liner += 'M' + pt(m(add(EYE.B, [-12, 3.6]))) + 'Q' + pt(m(add(EYE.B, [6, -1]))) + ' ' + pt(m(add(EYE.B, [17, -11]))) +
    'Q' + pt(m(add(EYE.B, [4, 5]))) + ' ' + pt(m(add(EYE.B, [-12, 7.4]))) + 'Z';
  out += P('c-ik', liner);
  if (o.lashes) out += lashes(m, o.lashes);
  return out;
}

// Бровь (свои координаты: начало у переносицы x 0, хвост x 100): широкое округлое начало,
// плавный подъём к изгибу на 2/3 длины, тонкий заострённый хвост
const BROW_TOP = [[0, -1], [12, -6], [30, -10.6], [50, -14.6], [66, -17], [78, -14], [90, -8], [100, -2]];
const BROW_BOT = [[0, 12], [12, 10.4], [30, 6], [50, 1.6], [66, -1.6], [78, -2.6], [90, -2.6], [100, -2]];
const lerpPts = (pts) => (x) => {
  for (let i = 0; i < pts.length - 1; i++) {
    if (x <= pts[i + 1][0]) { const a = pts[i], b = pts[i + 1]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  }
  return pts[pts.length - 1][1];
};
const browTop = lerpPts(BROW_TOP), browBot = lerpPts(BROW_BOT);
// Контур брови от начала до x1 (x1 = 100 — вся бровь)
function browPart(m, x1) {
  const top = BROW_TOP.filter((p) => p[0] < x1).concat([[x1, browTop(x1)]]);
  const bot = [[x1, browBot(x1)]].concat(BROW_BOT.filter((p) => p[0] < x1).reverse());
  return smooth(top.map(m)) + (x1 < 100 ? 'L' + pt(m(bot[0])) : '') + smooth(bot.map(m), true) +
    'C' + pt(m([-3, 10])) + ' ' + pt(m([-3, 1])) + ' ' + pt(m([0, -1])) + 'Z';
}
// Волоски: у начала — вверх, дальше по диагонали к хвосту; combed — уложенные параллельно (ламинирование)
function browHairs(m, combed) {
  let d = '';
  for (let x = 1, i = 0; x < 96; x += 1.9, i++) {
    const tp = browTop(x), bt = browBot(x), hgt = bt - tp;
    // направление роста: у начала почти вертикально вверх, к изгибу — по диагонали, у хвоста — вдоль брови
    const a = combed ? -40 + x * 0.3 : x < 12 ? -88 + x * 2.2 : x < 66 ? -62 + (x - 12) * 0.66 : -26 + (x - 66) * 0.85;
    const rows = hgt > 10 ? 3 : hgt > 5 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const y = bt - 0.4 - (hgt - 0.8) * (r + (i % 2) * 0.45) / rows;
      const l = Math.min(12, hgt * 0.9 + 3);
      d += lashD(m, [x, y], a + ((i * 7 + r * 13) % 9 - 4), l, 0.9, combed ? -0.4 : 0.9);
    }
  }
  return P('c-br', d);
}
// Бровь целиком: мягкая основа и волоски поверх
const brow = (m, combed) => P('c-br', browPart(m, 100), { op: 0.78 }) + browHairs(m, combed);
const at = (o, k) => (p) => [o[0] + p[0] * k, o[1] + p[1] * k];
// Бровь над глазом — на естественном расстоянии
const BROW_M = at([40, 29], 1.08);

// lashes-base: закрытый глаз с длинными ресницами и бровь
ILL['lashes-base'] = svg(BG +
  brow(BROW_M) +
  eye(null, { lashes: { n: 12, per: 1, w: 2.2, lk: 1.1 } }) +
  glow([162, 30], 4.5) + glow([30, 96], 3)
);
// Без брови глаз чуть ниже — по центру рамки
const EYE_LOW = at([0, 7], 1);
// lash-classic: редкие отдельные ресницы
ILL['lash-classic'] = svg(BG +
  eye(EYE_LOW, { lashes: { n: 9, per: 1, w: 2.3, lk: 1 } }) +
  glow([152, 28], 5) + glow([164, 42], 3)
);
// lash-2d: заметно гуще — по две
ILL['lash-2d'] = svg(BG +
  eye(EYE_LOW, { lashes: { n: 13, per: 2, w: 1.8, spread: 9, lk: 1.04 } }) +
  glow([152, 28], 5) + glow([164, 42], 3)
);
// lash-3d: ещё гуще — по три
ILL['lash-3d'] = svg(BG +
  eye(EYE_LOW, { lashes: { n: 15, per: 3, w: 1.55, spread: 13, lk: 1.08 } }) +
  glow([152, 28], 5) + glow([164, 42], 3)
);
// lash-mega: пушистые веера
ILL['lash-mega'] = svg(BG +
  eye(EYE_LOW, { liner: 2.8, lashes: { n: 16, per: 5, w: 1.25, spread: 19, lk: 1.14 } }) +
  glow([152, 28], 5) + glow([164, 42], 3)
);
// lash-hollywood: максимально пышные веера и блёстки
ILL['lash-hollywood'] = svg(BG +
  eye(EYE_LOW, { liner: 3.2, lashes: { n: 18, per: 7, w: 1.2, spread: 24, lk: 1.24 } }) +
  P('c-go', circle([82, 79], 1.4)) + P('c-go', circle([112, 80], 1.2)) + P('c-go', circle([134, 68], 1.3)) +
  glow([150, 26], 6) + glow([36, 34], 3.4) + glow([166, 44], 3)
);
// lash-lami: ресницы изогнуты вверх, блеск
ILL['lash-lami'] = svg(BG +
  eye(EYE_LOW, { lashes: { n: 11, per: 1, w: 2.2, lk: 1.02, ang0: 96, ang1: 58, curl: -0.78 } }) +
  glow([152, 28], 5) + glow([164, 42], 3) + glow([36, 96], 2.6)
);

// Брови: та же композиция «бровь над глазом», ресницы естественные
const browEye = () => eye(null, { lashes: { n: 11, per: 1, w: 2, lk: 0.8 } });

// brow-shape: бровь и пинцет у хвоста
ILL['brow-shape'] = svg(BG +
  browEye() + brow(BROW_M) +
  P('lc c-mt', 'M162 8L167 12L150 36Q148.6 37.8 147.6 36.8Z') +
  P('lc c-mt', 'M157.4 9L162.6 5.4L148.4 35Q147.2 37 146.2 35.8Z') +
  P('lc c-go', 'M159 12L164.6 15.6L162.4 19.4L156.6 15.8Z') +
  glow([30, 30], 4.5) + glow([30, 96], 3)
);

// brow-tint: бровь окрашивается — у начала светлее, к хвосту темнее; кисточка с краской у хвоста
ILL['brow-tint'] = svg(BG +
  browEye() + brow(BROW_M) +
  // плавный переход: светлые слои от начала брови разной длины накладываются друг на друга
  [10, 18, 26, 34, 42, 50].map((x) => P('c-hm', browPart(BROW_M, x), { op: 0.14 })).join('') +
  brush([150, 36], -26, 0.56, 'c-br', 'c-be') +
  glow([30, 30], 4.5) + glow([30, 96], 3)
);

// brow-lami: гладкая уложенная бровь с бликом
ILL['brow-lami'] = svg(BG +
  browEye() + brow(BROW_M, true) +
  P('c-hl', smooth([[16, -2.2], [34, -6.6], [52, -10.4], [66, -12.4]].map(BROW_M)) +
    smooth([[66, -10.6], [52, -8.4], [34, -4.6], [16, -0.2]].map(BROW_M), true) + 'Z', { op: 0.6 }) +
  glow([30, 30], 4) + glow([158, 26], 5.4) + glow([168, 42], 2.8)
);

// ─────────── Макияж (makeup-*) ───────────
// Поворот локальных координат: (x, y) → o + rot((x, y), ang) · k
const place = (o, ang, k) => (x, y) => add(o, mul(rot([x, y], ang), k || 1));
// Помада: золотой футляр и ягодный стержень со скошенным кончиком (o — середина дна)
function lipstick(o, ang, k) {
  const g = place(o, ang, k), q = (pts) => 'M' + pts.map((p) => pt(g(p[0], p[1]))).join('L') + 'Z';
  const bullet = 'M' + pt(g(-6, -36)) + 'L' + pt(g(-6, -50)) + 'C' + pt(g(-6, -54)) + ' ' + pt(g(-3, -56)) + ' ' + pt(g(0, -57.6)) +
    'L' + pt(g(4.4, -60)) + 'Q' + pt(g(6, -60.8)) + ' ' + pt(g(6, -58.6)) + 'L' + pt(g(6, -36)) + 'Z';
  return P('lc c-go', q([[-9.5, 0], [-9.5, -26], [9.5, -26], [9.5, 0]])) +
    P('c-hl', q([[-7, -2], [-7, -24], [-4.4, -24], [-4.4, -2]]), { op: 0.8 }) +
    P('c-hd', q([[5.6, -2], [5.6, -24], [7.6, -24], [7.6, -2]]), { op: 0.25 }) +
    P('lc c-hl', q([[-7.6, -26], [-7.6, -36], [7.6, -36], [7.6, -26]])) +
    P('lc c-be', bullet) +
    P('c-mt', q([[-3.8, -38], [-3.8, -50], [-2, -52], [-2, -38]]), { op: 0.6 });
}
// Пушистая кисть для макияжа: o — конец ручки, щетина в сторону ang−90; tipCls — пудра на кончике
function fluffyBrush(o, ang, k, tipCls) {
  const g = place(o, ang, k);
  const P2 = (x, y) => pt(g(x, y));
  const handle = 'M' + P2(-2.6, 0) + 'Q' + P2(-4, -22) + ' ' + P2(-4.6, -40) + 'L' + P2(4.6, -40) + 'Q' + P2(4, -22) + ' ' + P2(2.6, 0) +
    'Q' + P2(0, 1.6) + ' ' + P2(-2.6, 0) + 'Z';
  const ferrule = 'M' + P2(-4.8, -40) + 'L' + P2(-5.4, -52) + 'L' + P2(5.4, -52) + 'L' + P2(4.8, -40) + 'Z';
  const bristle = 'M' + P2(-5.4, -52) + 'C' + P2(-11, -58) + ' ' + P2(-11, -72) + ' ' + P2(-5, -78) +
    'C' + P2(-2, -81) + ' ' + P2(2, -81) + ' ' + P2(5, -78) + 'C' + P2(11, -72) + ' ' + P2(11, -58) + ' ' + P2(5.4, -52) + 'Z';
  const tip = 'M' + P2(-9.6, -68) + 'C' + P2(-8, -78) + ' ' + P2(-3, -80.4) + ' ' + P2(0, -80.4) +
    'C' + P2(3, -80.4) + ' ' + P2(8, -78) + ' ' + P2(9.6, -68) + 'Q' + P2(0, -72) + ' ' + P2(-9.6, -68) + 'Z';
  return P('lc c-hd', handle) + P('c-hl', 'M' + P2(-2, -6) + 'Q' + P2(-3, -22) + ' ' + P2(-3.2, -36) + 'L' + P2(-1.6, -36) +
    'Q' + P2(-1.4, -22) + ' ' + P2(-0.6, -6) + 'Z', { op: 0.5 }) +
    P('lc c-go', ferrule) + P('lc c-hm', bristle) + P(tipCls || 'c-be', tip, { op: 0.45 }) +
    P('lc', 'M' + P2(-3, -56) + 'Q' + P2(-5, -66) + ' ' + P2(-3, -74), { o: 0.35 }) + P('lc', 'M' + P2(2.4, -56) + 'Q' + P2(3.6, -66) + ' ' + P2(2.2, -74), { o: 0.35 });
}

// makeup-base: помада и кисть для макияжа
ILL['makeup-base'] = svg(BG +
  fluffyBrush([128, 124], 16, 1.02, 'c-be') +
  lipstick([90, 120], -12, 1.08) +
  glow([62, 40], 5) + glow([150, 34], 3)
);

// makeup-day: палетка нюдовых теней и мягкая кисть
(function () {
  const pans = [['c-hl', 1], ['c-sk', 1], ['c-hm', 1], ['c-be', 0.45], ['c-hd', 1], ['c-go', 1]];
  let s = P('lc c-be', rrect([0, 0], 0, 54, 50, 86, 58, 10)) + P('c-hd', rrect([0, 0], 0, 60, 56, 74, 46, 6), { op: 0.25 });
  pans.forEach((p, i) => {
    const c = [72 + (i % 3) * 25, 68 + Math.floor(i / 3) * 22];
    s += P('lc ' + p[0], circle(c, 9), p[1] < 1 ? { op: p[1] } : {}) + P('c-mt', circle(add(c, [-3.2, -3.2]), 2), { op: 0.5 });
  });
  ILL['makeup-day'] = svg(BG + s +
    fluffyBrush([160, 124], -34, 0.74, 'c-hm') +
    glow([60, 36], 5) + glow([150, 32], 3)
  );
})();

// makeup-evening: глаз со стрелкой и губы с яркой помадой
(function () {
  const lips = 'M74 98C80 93 87 84.6 93.4 85.4C96.6 85.8 98.4 87.6 100 89.6C101.6 87.6 103.4 85.8 106.6 85.4' +
    'C113 84.6 120 93 126 98C119 108 109 112.6 100 112.6C91 112.6 81 108 74 98Z';
  ILL['makeup-evening'] = svg(BG +
    eye(at([25, 4], 0.75), { liner: 3.4, wing: true, shadow: 'c-be', shadowOp: 0.28, lashes: { n: 10, per: 2, w: 1.2, spread: 8, lk: 0.9 } }) +
    P('lc c-be', lips) +
    P('c-hd', 'M74 98C80 93 87 84.6 93.4 85.4C96.6 85.8 98.4 87.6 100 89.6C101.6 87.6 103.4 85.8 106.6 85.4C113 84.6 120 93 126 98' +
      'C116 96.4 108 97.6 100 99C92 97.6 84 96.4 74 98Z', { op: 0.22 }) +
    P('lc', 'M76 98C86 97 92 98.4 100 99.6C108 98.4 114 97 124 98') +
    P('c-mt', 'M94 104.6Q100 102.6 108 104.4Q101 107 94 104.6Z', { op: 0.75 }) +
    glow([148, 40], 5) + glow([56, 86], 3)
  );
})();

// ─────────── Растровые иллюстрации (готовые картинки) ───────────
// Ключ берёт свой файл assets/<ключ>.png, а если его нет — общий файл группы (fallback).
const RASTER = {
  'feet-base': { fallback: 'feet-gel' },
  'feet-classic': { fallback: 'feet-gel' },
  'feet-gel': { fallback: 'feet-gel' },
  'feet-coat': { fallback: 'feet-gel' }
};
// Настройки кадра для файла (по имени без .png); у файла без настроек всё по центру:
//   crop  — обрезать поля до конвертации (ffmpeg crop=ширина:высота:x:y), например чтобы убрать огрехи по краям;
//   pos   — какая часть остаётся в крупных рамках (CSS object-position);
//   focus — точка, к которой кадрируется и увеличивается 48px; zoom — увеличение в 48px.
const RASTER_FILES = {
  // feet-gel: убраны светлые пятна в верхних углах (y < 12) и тонкая белая рамка справа (x ≈ 443) и снизу (y ≈ 397)
  'feet-gel': { crop: '438:382:0:12', pos: '50% 100%', focus: '100% 100%', zoom: 1.45 }
};
// Папка с картинками; для проверки можно указать другую: ILL_ASSETS=путь
const ASSETS = process.env.ILL_ASSETS || path.join(ROOT, 'assets');
const WEBP_WIDTH = 480, WEBP_QUALITY = 80, WEBP_LIMIT = 40 * 1024;

// PNG → WebP через ffmpeg: ширина 480, качество 80; если файл больше 40 КБ — качество ниже (не меньше 50)
function toWebp(file, crop) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const out = path.join(os.tmpdir(), 'alfa-ill-' + process.pid + '.webp');
  let q = WEBP_QUALITY, buf;
  for (;;) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', (crop ? 'crop=' + crop + ',' : '') + 'scale=\'min(' + WEBP_WIDTH + ',iw)\':-2:flags=lanczos',
      '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-frames:v', '1', out]);
    buf = fs.readFileSync(out);
    if (buf.length <= WEBP_LIMIT || q <= 50) break;
    q -= 5;
  }
  fs.unlinkSync(out);
  if (buf.length > WEBP_LIMIT) console.warn('Внимание: ' + path.basename(file) + ' — ' + (buf.length / 1024).toFixed(1) + ' КБ даже при качестве ' + q);
  return { data: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length, q: q };
}

// Каждая картинка встраивается один раз (ILL_IMG), ключи ссылаются на неё через rasterIll()
function rasterBlock() {
  const imgs = {}, uses = {};
  for (const key of Object.keys(RASTER)) {
    const own = path.join(ASSETS, key + '.png'), common = path.join(ASSETS, RASTER[key].fallback + '.png');
    const file = fs.existsSync(own) ? own : fs.existsSync(common) ? common : null;
    if (!file) { console.warn('Нет картинки для ' + key + ' (ожидается assets/' + key + '.png) — будет заглушка'); continue; }
    const name = path.basename(file, '.png');
    if (!imgs[name]) {
      imgs[name] = toWebp(file, (RASTER_FILES[name] || {}).crop);
      console.log('  assets/' + name + '.png → WebP ' + (imgs[name].bytes / 1024).toFixed(1) + ' КБ (качество ' + imgs[name].q + ')');
    }
    uses[key] = name;
  }
  const names = Object.keys(imgs);
  // Картинка и её кадр: style задаёт CSS-переменные --pos, --focus, --zoom
  let js = 'const ILL_IMG = {\n' + names.map((nm) => {
    const o = RASTER_FILES[nm] || {};
    const style = '--pos: ' + (o.pos || '50% 50%') + '; --focus: ' + (o.focus || '50% 50%') + '; --zoom: ' + (o.zoom || 1);
    return "  '" + nm + "': { src: '" + imgs[nm].data + "', style: '" + style + "' }";
  }).join(',\n') + '\n};\n';
  js += "function rasterIll(name) {\n" +
    "  return '<img class=\"ilr\" src=\"' + ILL_IMG[name].src + '\" alt=\"\" decoding=\"async\" style=\"' + ILL_IMG[name].style + '\">';\n}\n";
  const entries = Object.keys(uses).map((k) => "  '" + k + "': rasterIll('" + uses[k] + "')");
  return { js: js, entries: entries, bytes: names.reduce((s, nm) => s + imgs[nm].data.length, 0), keys: Object.keys(uses) };
}

// ─────────── Запись в index.html ───────────
function build() {
  const keys = Object.keys(ILL);
  for (const k of keys) {
    if (/#[0-9a-f]{3,8}\b|rgb|hsl|\bid=|url\(/i.test(ILL[k])) throw new Error('Запрещённый цвет или id в ' + k);
  }
  const raster = rasterBlock();
  let js = raster.js + 'const ILLUSTRATIONS = {\n';
  js += keys.map((k) => "  '" + k + "':\n    '" + ILL[k] + "'").concat(raster.entries).join(',\n');
  js += '\n};';
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /\/\*ILL:START\*\/[\s\S]*?\/\*ILL:END\*\//;
  if (!re.test(html)) throw new Error('В index.html нет меток /*ILL:START*/ … /*ILL:END*/');
  fs.writeFileSync(INDEX, html.replace(re, () => '/*ILL:START*/\n' + js + '\n/*ILL:END*/'));
  const bytes = keys.reduce((s, k) => s + Buffer.byteLength(ILL[k]), 0);
  console.log('Иллюстраций SVG: ' + keys.length + ' (' + keys.join(', ') + '), ' + (bytes / 1024).toFixed(1) + ' КБ');
  console.log('Картинок: ' + raster.keys.length + ' (' + raster.keys.join(', ') + '), встроено ' + (raster.bytes / 1024).toFixed(1) + ' КБ');
}

// Запись в index.html — только при прямом запуске (не при подключении через require)
module.exports = { ILL };
if (require.main === module) build();
