/*
 * Галерея иллюстраций для согласования стиля (в продукт не входит).
 *
 * Берёт из index.html стили, priceData и ILLUSTRATIONS и собирает tools/preview/gallery.html:
 *  - все готовые иллюстрации в трёх размерах (крупно, плитка, 48px) в темах nude, noir, sage;
 *  - «в контексте»: шапка главной и экраны категорий со строками услуг, как в прайсе.
 *
 * Запуск (из папки проекта):  node tools/preview/build-gallery.js
 * Потом открыть tools/preview/gallery.html двойным кликом.
 * Необязательные аргументы — ключи или префиксы и темы: node tools/preview/build-gallery.js hair,color noir
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Стили: темы переводим с :root на атрибут, чтобы на одной странице были все три
let css = html.match(/<style>([\s\S]*?)<\/style>/)[1]
  .replace(/:root\[data-theme="(\w+)"\]/g, '[data-theme="$1"]')
  .replace(/:root \{/, ':root, [data-theme="nude"] {');

// Данные и иллюстрации: выполняем начало скрипта (до блока «Тема»)
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const head = script.slice(0, script.indexOf('// ─────────── Тема'));
const ctx = {};
vm.runInNewContext(head + '\nthis.out = { priceData, ILLUSTRATIONS, ICONS };', ctx);
const { priceData, ILLUSTRATIONS, ICONS } = ctx.out;

const filter = (process.argv[2] || 'logo,hair,color').split(',');
const keys = Object.keys(ILLUSTRATIONS).filter((k) => filter.some((f) => k === f || k.indexOf(f) === 0));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ui = priceData.ui.ru;
const fmtNum = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const price = (p) => {
  let s = fmtNum(p.amount) + ' ₸';
  if (p.from) s = ui.priceFrom.replace('{price}', s);
  if (p.per) s += ui.perPrefix + p.per.ru;
  return s;
};
const dur = (m) => {
  const h = Math.floor(m / 60), mm = m % 60, parts = [];
  if (h) parts.push(h + ' ' + ui.hours);
  if (mm || !h) parts.push(mm + ' ' + ui.minutes);
  return ui.durationApprox + ' ' + parts.join(' ');
};
const ill = (key, cls) => '<div class="ill ' + cls + '">' + ILLUSTRATIONS[key] + '</div>';

function sheet() {
  let s = '<div class="g-sheet">';
  keys.filter((k) => k !== 'logo').forEach((k) => {
    s += '<figure class="g-fig">' + ill(k, 'ill-big') +
      '<figcaption><span class="g-key">' + esc(k) + '</span>' +
      '<span class="g-small"><span class="g-tile">' + ill(k, 'ill-tile') + '</span>' + ill(k, 'ill-mini') + '</span></figcaption></figure>';
  });
  return s + '</div>';
}

function minis() {
  let s = '<div class="g-minis">';
  keys.filter((k) => k !== 'logo').forEach((k) => { s += ill(k, 'ill-mini'); });
  return s + '</div>';
}

function phoneHome() {
  const c = priceData.company;
  let s = '<div class="g-phone"><header class="hero"><div class="hero-top"><div class="mono">' + ILLUSTRATIONS.logo + '</div></div>' +
    '<h1 class="salon">' + esc(c.name) + '</h1><p class="sub">' + esc(c.subtitle.ru) + '</p></header>' +
    '<h2 class="section-title">' + esc(ui.categories) + '</h2><div class="grid">';
  priceData.categories.forEach((cat) => {
    const has = ILLUSTRATIONS[cat.illustration];
    s += '<a class="cat-card">' + (has ? ill(cat.illustration, 'ill-tile') : '<div class="ill ill-tile g-empty"></div>') +
      '<div class="body"><div class="name">' + esc(cat.name.ru) + '</div><div class="count">' + cat.items.length + '</div></div></a>';
  });
  return s + '</div></div>';
}

function phoneCategory(cat) {
  const min = Math.min.apply(null, cat.items.map((i) => i.price.amount));
  let s = '<div class="g-phone"><header class="screen-head">' + ill(cat.illustration, 'ill-big') +
    '<h1>' + esc(cat.name.ru) + '</h1><p class="from num">' + esc(ui.priceFrom.replace('{price}', fmtNum(min) + ' ₸')) + '</p></header><ul class="list">';
  cat.items.forEach((item) => {
    s += '<li><a class="row">' + ill(item.illustration, 'ill-mini') + '<div class="info"><div class="name">' + esc(item.name.ru) + '</div>';
    if (item.duration || item.hit) {
      s += '<div class="meta">';
      if (item.duration) s += '<span class="dur">' + ICONS.clock + '<span class="num">' + esc(dur(item.duration)) + '</span></span>';
      if (item.hit) s += '<span class="hit">' + esc(ui.hit) + '</span>';
      s += '</div>';
    }
    s += '</div><div class="price num">' + esc(price(item.price)) + '</div>' + ICONS.chev + '</a></li>';
  });
  return s + '</ul></div>';
}

function phoneItem(cat, item) {
  return '<div class="g-phone"><article class="card">' + ill(item.illustration, 'ill-hero') +
    '<div class="card-body"><h1>' + esc(item.name.ru) + '</h1><p class="price-big num">' + esc(price(item.price)) + '</p></div></article></div>';
}

const cats = priceData.categories.filter((c) => keys.indexOf(c.illustration) !== -1);
let body = '';
(process.argv[3] ? process.argv[3].split(',') : ['nude', 'noir', 'sage']).forEach((theme) => {
  body += '<section class="g-theme" data-theme="' + theme + '"><h2 class="g-h">Тема ' + theme + '</h2>' +
    '<h3 class="g-sub">В контексте</h3><div class="g-phones">' + phoneHome() +
    cats.map(phoneCategory).join('') +
    (cats[0] ? phoneItem(cats[0], cats[0].items[1] || cats[0].items[0]) : '') + '</div>' +
    '<h3 class="g-sub">Все рисунки: крупно, плитка, 48px</h3>' + sheet() +
    '<h3 class="g-sub">Мини 48px подряд</h3>' + minis() +
    '</section>';
});

const out = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Галерея иллюстраций</title><style>' + css +
  '\n.g-theme{background:var(--bg);color:var(--text);padding:24px 20px 40px}' +
  '.g-h{font:600 30px/1.2 var(--font-head);margin:0 0 8px}.g-sub{font:600 13px/1.4 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--text-2);margin:24px 0 12px}' +
  '.g-sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}' +
  '.g-fig{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px}' +
  '.g-fig figcaption{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}' +
  '.g-key{font-size:13px;color:var(--text-2)}.g-small{display:flex;align-items:center;gap:10px}.g-tile{display:block;width:120px}' +
  '.g-minis{display:flex;flex-wrap:wrap;gap:12px}' +
  '.g-phones{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}' +
  '.g-phone{width:390px;max-width:100%;padding:16px;background:var(--bg);border:1px solid var(--line);border-radius:28px}' +
  '.g-phone .list{margin:0}.g-empty{opacity:.5}' +
  '</style></head><body>' + body + '</body></html>';

const file = path.join(__dirname, 'gallery.html');
fs.writeFileSync(file, out);
console.log('Готово: ' + path.relative(ROOT, file) + ' (' + keys.length + ' рисунков)');
