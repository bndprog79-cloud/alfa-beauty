/*
 * Резервная копия: векторные рисунки feet-* (последний вариант до перехода на готовую картинку assets/feet-gel.png).
 * В продукт не входит и сам по себе не запускается: это фрагмент tools/illustrations/build-illustrations.js.
 * Чтобы вернуть — вставить фрагмент в build-illustrations.js перед разделом «Запись в index.html»
 * и убрать ключи feet-* из объекта RASTER. Использует помощники скрипта (P, frame, smooth, nailD, ring, polishBottle и др.)
 * и цвет --ill-white / класс c-wh (их тоже нужно вернуть в index.html).
 */

// ─────────── Ноги: стопа (feet-*) ───────────
// Передняя часть стопы по диагонали: подъём сверху-слева, пальцы снизу-справа лежат на полотенце.
// Щиколотка и задняя часть стопы укутаны в мягкое полотенце — без среза краем рисунка.
// Система стопы F(u, v): u — вдоль стопы к пальцам (вниз-вправо), v — поперёк (v < 0 — сторона большого пальца).
const FT_A = 30, F = frame([100, 74], FT_A);
// Пальцы от большого к мизинцу: [u, v основания, поворот, длина, ширина]; пухлые, веером
const TOE_SPECS = [
  [-4, -14, -10, 32, 25],
  [-6, 5.8, 0, 26, 16],
  [-10, 20.6, 10, 22.6, 14.6],
  [-15.6, 33.8, 20, 19.4, 13.2],
  [-22, 45.4, 30, 16, 11.8]
];
const TOES = TOE_SPECS.map((g) => ({ f: frame(F(g[0], g[1]), FT_A + g[2]), L: g[3], W: g[4] }));
// Края стопы как функции: верхний (подъём) и нижний (наружный край) — смещение v на высоте u
const lerpTable = (tab) => (u) => {
  for (let i = 0; i < tab.length - 1; i++) {
    if (u <= tab[i + 1][0]) { const t = (u - tab[i][0]) / (tab[i + 1][0] - tab[i][0]); return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * (t * t * (3 - 2 * t)); }
  }
  return tab[tab.length - 1][1];
};
const vTop = lerpTable([[-60, -18.4], [-40, -21.6], [-20, -24.6], [-8, -25.4], [0, -24.6]]);
const vBot = lerpTable([[-60, 25], [-44, 33], [-32, 42], [-24, 48.6], [-18, 51.4]]);
const edge = (u0, u1, vf) => { const pts = []; for (let i = 0; i <= 8; i++) { const u = u0 + (u1 - u0) * i / 8; pts.push(F(u, vf(u))); } return pts; };
const FOOT_BACK = -58; // задняя граница стопы (скрыта под полотенцем)

// Палец ноги — пухлая «фасолинка»: уже у основания, шире к кончику, кончик круглый
const TOE_W = [[0, 0.4], [0.34, 0.45], [0.64, 0.5], [0.84, 0.45]];
function toeSide(g, k, from) {
  return [[from, TOE_W[0][1] + (TOE_W[1][1] - TOE_W[0][1]) * from / 0.34]].concat(TOE_W.filter((q) => q[0] > from + 0.02))
    .map((q) => g.f(g.L * q[0], k * g.W * q[1]));
}
function toeCap(g, k) { // от верхней стороны (k = −1) через кончик к нижней, или наоборот
  const f = g.f, L = g.L, W = g.W;
  return 'C' + pt(f(L * 0.95, k * W * 0.38)) + ' ' + pt(f(L, k * W * 0.2)) + ' ' + pt(f(L, 0)) +
    'C' + pt(f(L, -k * W * 0.2)) + ' ' + pt(f(L * 0.95, -k * W * 0.38)) + ' ' + pt(f(L * 0.84, -k * W * 0.45));
}
const toeFill = (g) => smooth(toeSide(g, -1, 0)) + toeCap(g, -1) + smooth(toeSide(g, 1, 0).reverse(), true) + 'Z';
// Контур пальца: верхняя сторона от a, кончик, нижняя сторона до b (доли длины)
const toeLine = (g, a, b) => smooth(toeSide(g, -1, a)) + toeCap(g, -1) + smooth(toeSide(g, 1, b).reverse(), true);
// Заливка стопы: подъём → основания пальцев (их закрывают пальцы) → наружный край
function footFill() {
  let d = smooth(edge(FOOT_BACK, 0, vTop));
  TOES.forEach((g) => { d += 'L' + pt(g.f(g.L * 0.4, 0)); });
  d += 'L' + pt(F(-18, vBot(-18)));
  return d + smooth(edge(-18, FOOT_BACK, vBot), true) + 'Z';
}

// nail(f, L, W, i) — ноготь пальца i (0 — большой … 4 — мизинец); ring2 — золотое колечко на втором пальце
function foot(nail, ring2) {
  let out = P('c-sk', footFill());
  // мягкая тень вдоль наружного края
  out += P('c-hm', smooth(edge(-16, -44, vBot)) + 'L' + pt(F(-44, vBot(-44) - 8)) +
    smooth(edge(-44, -16, (u) => vBot(u) - 10), true) + 'Z', { op: 0.14 });
  out += P('lc', smooth(edge(-32, 0, vTop))) + P('lc', smooth(edge(-18, -34, vBot)));
  // пальцы — от мизинца к большому: каждый следующий чуть перекрывает соседа, складки — его контуром
  for (let i = 4; i >= 0; i--) {
    const g = TOES[i];
    out += P('c-sk', toeFill(g)) +
      P('c-hm', 'M' + pt(g.f(g.L * 0.2, g.W * 0.43)) + 'Q' + pt(g.f(g.L * 0.62, g.W * 0.56)) + ' ' + pt(g.f(g.L * 0.9, g.W * 0.36)) +
        'Q' + pt(g.f(g.L * 0.55, g.W * 0.26)) + ' ' + pt(g.f(g.L * 0.2, g.W * 0.3)) + 'Z', { op: 0.22 }) +
      P('lc', toeLine(g, i === 0 ? 0 : 0.3, i === 4 ? 0 : 0.14));
  }
  out += towelWrap();
  if (ring2) out += ring(Object.assign({ W0: TOES[1].W * 0.9 }, TOES[1]), 0.4);
  if (nail) TOES.forEach((g, i) => { out += nail(g.f, g.L, g.W, i); });
  return out;
}
// Ногти: крупные, почти во всю ширину пальца, мягкий скруглённый квадрат
const toeNail = (i) => ({ lk: i === 0 ? 0.7 : 0.74, wk: 0.34, off: -TOE_SPECS[i][4] * 0.03, ext: -TOE_SPECS[i][4] * 0.1 });
const toeShine = (f, L, W, i) => P('c-mt', nailShine(f, L, W, toeNail(i), 1.6), { op: 0.9 });
// Цветок на ногте: розовые лепестки, жёлтая серединка
function nailFlower(f, L, W, i) {
  const c = nailAt(f, L, W, 0.5, 0, toeNail(i)), r = W * 0.19;
  let d = '';
  for (let k = 0; k < 5; k++) d += leaf(c, -90 + k * 72, r * 1.6, r * 1.05);
  return P('c-be', d, { op: 0.75 }) + P('c-go', circle(c, r * 0.42));
}
// Мягкое белое полотенце: пышный верхний край, петельки ворса, тень снизу
function towel() {
  const d = 'M34 128C34 112 44 100 62 96C82 92 100 98 118 95C136 92 156 96 166 106C172 112 172 122 168 128Z';
  let loops = '';
  [[52, 112], [70, 106], [146, 104], [158, 114], [60, 122], [150, 122], [44, 120]].forEach((p) => {
    loops += 'M' + pt([p[0] - 2.2, p[1]]) + 'Q' + pt([p[0], p[1] - 2.6]) + ' ' + pt([p[0] + 2.2, p[1]]);
  });
  return P('lc c-wh', d) + P('c-mt', 'M36 128C38 120 46 116 56 118C80 122 120 122 146 118C158 116 166 120 168 128Z', { op: 0.5 }) +
    P('lc', loops, { o: 0.25 });
}
// Полотенце, в которое укутана щиколотка: мягкий валик со складками, край волной поперёк стопы
function towelWrap() {
  const front = [F(-26, -32), F(-31, -20), F(-27, -8), F(-32, 4), F(-28, 16), F(-33, 28), F(-30, 38), F(-36, 44)];
  const back = [F(-36, 44), F(-46, 46), F(-56, 40), F(-60, 26), F(-61, 6), F(-58, -14), F(-50, -28), F(-38, -36), F(-26, -32)];
  const d = smooth(front) + smooth(back, true) + 'Z';
  const folds = smooth([F(-40, -26), F(-43, -10), F(-40, 6), F(-45, 22), F(-43, 34)]);
  return P('lc c-wh', d) + P('c-mt', smooth([F(-36, 44), F(-46, 46), F(-56, 40), F(-60, 26)]) + 'L' + pt(F(-54, 24)) +
    smooth([F(-54, 24), F(-48, 34), F(-38, 38)], true) + 'Z', { op: 0.55 }) +
    P('lc', folds, { o: 0.3 }) + P('c-hm', smooth([F(-22, -28), F(-25, -12), F(-21, 4), F(-24, 20)]) + 'L' + pt(F(-18, 20)) +
      smooth([F(-18, 20), F(-15, 4), F(-19, -12), F(-16, -28)], true) + 'Z', { op: 0.18 });
}
// Тень стопы на полотенце
const towelShadow = () => P('c-mt', 'M64 112C84 118 112 122 138 116C150 113 156 106 154 100C140 104 112 108 88 104Z', { op: 0.6 });

// feet-base: стопа на белом полотенце, ягодные ногти с бликом, колечко
ILL['feet-base'] = svg(BG +
  towel() + towelShadow() +
  foot((f, L, W, i) => P('lc c-be', nailD(f, L, W, toeNail(i))) + toeShine(f, L, W, i), true) +
  glow([148, 34], 5) + glow([160, 50], 3)
);

// feet-classic: натуральные розоватые ногти и пемза
ILL['feet-classic'] = svg(BG +
  foot((f, L, W, i) => P('lc c-be', nailD(f, L, W, toeNail(i)), { op: 0.25 }) +
    P('c-mt', nailShine(f, L, W, toeNail(i), 1.2), { op: 0.7 })) +
  P('lc c-mt', rrect([146, 118], -16, -15, -7, 30, 14, 7)) +
  [[-8, -2.4, 1.2], [-2, 2.2, 1], [3, -2.6, 1.3], [8.6, 1.6, 1.1], [-6, 3.4, 0.8]].map((q) =>
    P('c-hd', circle(add([146, 118], rot([q[0], q[1]], -16)), q[2]), { op: 0.3 })).join('') +
  glow([148, 34], 5) + glow([160, 50], 3)
);

// feet-gel: мятные ногти с бликом, на среднем пальце — розовый цветок
ILL['feet-gel'] = svg(BG +
  towel() + towelShadow() +
  foot((f, L, W, i) => P('lc c-aq', nailD(f, L, W, toeNail(i))) + toeShine(f, L, W, i) +
    (i === 2 ? nailFlower(f, L, W, i) : '')) +
  glow([148, 34], 5) + glow([160, 50], 3)
);

// feet-coat: стопа с ягодными ногтями и флакон с золотой крышкой
ILL['feet-coat'] = svg(BG +
  foot((f, L, W, i) => P('lc c-be', nailD(f, L, W, toeNail(i))) + toeShine(f, L, W, i)) +
  polishBottle([146, 76], 0.56, true) +
  glow([120, 30], 4) + glow([160, 108], 3)
);

