/*
 * PWA-файлы прайса: иконки, manifest, блок <noscript> и версия кэша service worker.
 *
 * Запуск (из папки проекта):  node tools/pwa/build-pwa.js
 * Запускать заново после любого изменения index.html (цены, тексты, тема) — перед публикацией.
 *
 * Что делает:
 *  1. index.html: тема из priceData.meta.theme → <html data-theme> и <meta name="theme-color">
 *     (чтобы и без JavaScript страница была в своей теме); блок <noscript> между метками
 *     <!--NOSCRIPT:START--> … <!--NOSCRIPT:END--> — тексты из docs/data.js (название, ui.noscriptText,
 *     телефон, ui.openInBrowser на RU и KK, ссылка meta.siteUrl).
 *  2. icons/: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180) —
 *     логотип ILLUSTRATIONS.logo из index.html в цветах темы. Рисует Microsoft Edge без окна
 *     (headless, снимок экрана). Путь к Edge можно задать переменной окружения EDGE_PATH.
 *  3. manifest.webmanifest: названия, start_url, цвета темы, иконки.
 *  4. sw.js: CACHE_VERSION = хеш index.html, manifest и иконок. Изменился любой файл →
 *     новая версия кэша, у клиентов старый кэш удалится.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'docs', 'data.js');
const ICONS = path.join(ROOT, 'icons');
const MANIFEST = path.join(ROOT, 'manifest.webmanifest');
const SW = path.join(ROOT, 'sw.js');

const SHORT_NAME = 'Alfa Beauty'; // docs/TZ.md, раздел 9

// Иконки: размер и доля стороны, которую занимает логотип (квадрат viewBox 0 0 120 120).
// maskable: Android обрезает иконку кругом/каплей, видимая зона — круг 80% стороны.
const ICON_SET = [
  { file: 'icon-192.png', size: 192, logo: 0.9 },
  { file: 'icon-512.png', size: 512, logo: 0.9 },
  { file: 'icon-maskable-512.png', size: 512, logo: 0.74 },
  { file: 'apple-touch-icon.png', size: 180, logo: 0.84 }
];

// ─────────── Данные и тема ───────────
function loadData() {
  const code = fs.readFileSync(DATA, 'utf8');
  return vm.runInNewContext(code + '\n;priceData');
}

// Значение CSS-переменной темы из <style> index.html (nude — блок :root, остальные — :root[data-theme="…"])
function themeVar(html, theme, name) {
  const head = theme === 'nude' ? ':root {' : ':root[data-theme="' + theme + '"] {';
  const start = html.indexOf(head);
  if (start === -1) throw new Error('В index.html нет темы «' + theme + '»');
  const block = html.slice(start, html.indexOf('}', start));
  const m = block.match(new RegExp('\\s' + name + ':\\s*([^;]+);'));
  if (!m) throw new Error('В теме «' + theme + '» нет переменной ' + name);
  return m[1].trim();
}

function logoSvg(html) {
  const m = html.match(/'logo':\s*'([^']+)'/);
  if (!m) throw new Error('В index.html не найден ILLUSTRATIONS.logo');
  return m[1];
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────── 1. index.html: тема и noscript ───────────
function noscriptBlock(data, html) {
  const c = data.company;
  const ru = data.ui.ru;
  const kk = data.ui.kk;
  return [
    '<noscript>',
    '<div class="nos">',
    '  <div class="mono">' + logoSvg(html) + '</div>',
    '  <p class="salon">' + esc(c.name) + '</p>',
    '  <p lang="ru">' + esc(ru.noscriptText) + '</p>',
    '  <p lang="kk">' + esc(kk.noscriptText) + '</p>',
    '  <a class="nos-tel" href="tel:+' + esc(c.phone) + '">' + esc(c.phoneDisplay) + '</a>',
    '  <a class="btn-book" href="' + esc(data.meta.siteUrl) + '"><span lang="ru">' + esc(ru.openInBrowser) +
      '</span><span lang="kk">' + esc(kk.openInBrowser) + '</span></a>',
    '</div>',
    '</noscript>'
  ].join('\n');
}

function updateIndex(data, theme, bg) {
  let html = fs.readFileSync(INDEX, 'utf8');
  const re = /<!--NOSCRIPT:START-->[\s\S]*?<!--NOSCRIPT:END-->/;
  if (!re.test(html)) throw new Error('В index.html нет меток <!--NOSCRIPT:START--> … <!--NOSCRIPT:END-->');
  const block = noscriptBlock(data, html);
  html = html.replace(re, () => '<!--NOSCRIPT:START-->\n' + block + '\n<!--NOSCRIPT:END-->');
  html = html.replace(/<html\b[^>]*>/, '<html lang="' + esc(data.meta.defaultLang || 'ru') + '" data-theme="' + esc(theme) + '">');
  html = html.replace(/<meta name="theme-color" content="[^"]*">/, '<meta name="theme-color" content="' + esc(bg) + '">');
  fs.writeFileSync(INDEX, html);
  return html;
}

// ─────────── 2. Иконки (Edge headless) ───────────
function findEdge() {
  const list = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const found = list.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('Не найден Microsoft Edge (msedge.exe). Укажите путь в переменной EDGE_PATH.');
  return found;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function buildIcons(html, theme) {
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const logo = logoSvg(html);
  const edge = findEdge();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-icons-'));
  fs.mkdirSync(ICONS, { recursive: true });
  try {
    ICON_SET.forEach(icon => {
      const box = Math.round(icon.size * icon.logo);
      const page = '<!DOCTYPE html><html data-theme="' + theme + '"><head><meta charset="utf-8">' + style +
        '<style>html,body{margin:0;overflow:hidden}' +
        '.icon{width:' + icon.size + 'px;height:' + icon.size + 'px;display:flex;align-items:center;justify-content:center;background:var(--bg)}' +
        '.icon .mono{width:' + box + 'px;height:' + box + 'px}</style></head>' +
        '<body><div class="icon"><div class="mono">' + logo + '</div></div></body></html>';
      const pageFile = path.join(tmp, 'icon.html');
      const out = path.join(ICONS, icon.file);
      fs.writeFileSync(pageFile, page);
      if (fs.existsSync(out)) fs.unlinkSync(out);
      execFileSync(edge, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--force-device-scale-factor=1', '--user-data-dir=' + path.join(tmp, 'profile'),
        '--window-size=' + icon.size + ',' + icon.size,
        '--screenshot=' + out, 'file:///' + pageFile.replace(/\\/g, '/')
      ], { stdio: 'ignore', timeout: 60000 });
      if (!fs.existsSync(out)) throw new Error('Edge не создал ' + icon.file);
      const s = pngSize(out);
      if (s.w !== icon.size || s.h !== icon.size) {
        throw new Error(icon.file + ': получилось ' + s.w + '×' + s.h + ' вместо ' + icon.size + '×' + icon.size);
      }
      console.log('  icons/' + icon.file + ' — ' + icon.size + '×' + icon.size + ', ' + fs.statSync(out).size + ' байт');
    });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* временная папка — не страшно */ }
  }
}

// ─────────── 3. manifest ───────────
function buildManifest(data, bg) {
  const manifest = {
    name: data.company.name,
    short_name: SHORT_NAME,
    description: data.company.name + ' — ' + data.company.subtitle.ru,
    lang: data.meta.defaultLang || 'ru',
    start_url: './',
    scope: './',
    display: 'standalone',
    theme_color: bg,
    background_color: bg,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

// ─────────── 4. Версия кэша в sw.js ───────────
function updateSwVersion() {
  const hash = crypto.createHash('sha256');
  [INDEX, MANIFEST].concat(ICON_SET.map(i => path.join(ICONS, i.file))).forEach(f => hash.update(fs.readFileSync(f)));
  const version = hash.digest('hex').slice(0, 10);
  const sw = fs.readFileSync(SW, 'utf8');
  const re = /const CACHE_VERSION = '[^']*';/;
  if (!re.test(sw)) throw new Error('В sw.js нет строки const CACHE_VERSION = \'…\';');
  fs.writeFileSync(SW, sw.replace(re, "const CACHE_VERSION = '" + version + "';"));
  return version;
}

function main() {
  const data = loadData();
  const theme = data.meta.theme || 'nude';
  const src = fs.readFileSync(INDEX, 'utf8');
  const bg = themeVar(src, theme, '--bg');

  const html = updateIndex(data, theme, bg);
  console.log('index.html: тема ' + theme + ', noscript обновлён');
  console.log('Иконки:');
  buildIcons(html, theme);
  buildManifest(data, bg);
  console.log('manifest.webmanifest: theme_color / background_color ' + bg);
  console.log('sw.js: CACHE_VERSION = ' + updateSwVersion());
}

main();
