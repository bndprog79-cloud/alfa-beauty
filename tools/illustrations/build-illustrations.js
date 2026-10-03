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

// ─────────── Запись в index.html ───────────
function build() {
  const keys = Object.keys(ILL);
  let js = 'const ILLUSTRATIONS = {\n';
  js += keys.map((k) => "  '" + k + "':\n    '" + ILL[k] + "'").join(',\n');
  js += '\n};';
  for (const k of keys) {
    if (/#[0-9a-f]{3,8}\b|rgb|hsl|\bid=|url\(/i.test(ILL[k])) throw new Error('Запрещённый цвет или id в ' + k);
  }
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /\/\*ILL:START\*\/[\s\S]*?\/\*ILL:END\*\//;
  if (!re.test(html)) throw new Error('В index.html нет меток /*ILL:START*/ … /*ILL:END*/');
  fs.writeFileSync(INDEX, html.replace(re, () => '/*ILL:START*/\n' + js + '\n/*ILL:END*/'));
  const bytes = keys.reduce((s, k) => s + Buffer.byteLength(ILL[k]), 0);
  console.log('Иллюстраций: ' + keys.length + ' (' + keys.join(', ') + '), ' + (bytes / 1024).toFixed(1) + ' КБ');
}

// Запись в index.html — только при прямом запуске (не при подключении через require)
module.exports = { ILL };
if (require.main === module) build();
