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
 *  5. og-image.png (1200×630) — картинка для превью ссылки в WhatsApp и Telegram: логотип, название,
 *     meta.share.tagline и строки meta.share.heading (крупно — в WhatsApp картинка уменьшается ~в 4 раза), рисунки hair-base / nails-base / lashes-base в цветах темы (тоже Edge headless).
 *     Важное — в центральном квадрате 630×630 (мессенджер может обрезать края). Если файл больше
 *     300 КБ — палитра уменьшается через ffmpeg.
 *     В index.html между метками <!--OG:START--> … <!--OG:END--> — теги Open Graph и description;
 *     адрес картинки абсолютный (meta.siteUrl) с ?v=<хеш картинки>, чтобы мессенджеры брали новую версию.
 *  0. Первым шагом — tools/qr/build-qr.js: QR-код (qr/*.svg, окно QR в index.html) и карточка для печати
 *     print/card-a6.pdf / .png. QR должен попасть в index.html до подсчёта версии кэша.
 *     Нужны пакеты из tools/ (первый раз: cd tools; npm install; cd ..).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { ROOT, INDEX, loadData, themeVar, logoSvg, esc, findEdge, pngSize } = require('../common');
const { buildQr } = require('../qr/build-qr');
const ICONS = path.join(ROOT, 'icons');
const MANIFEST = path.join(ROOT, 'manifest.webmanifest');
const SW = path.join(ROOT, 'sw.js');
const OG_IMAGE = path.join(ROOT, 'og-image.png');

// Картинка превью: размер, предел файла (WhatsApp может не показать больше ~300 КБ), рисунки по бокам
const OG_W = 1200;
const OG_H = 630;
const OG_MAX_BYTES = 300 * 1024;
const OG_ILLS = { left: ['hair-base', 'nails-base'], right: ['lashes-base'] }; // слева два, справа один

const SHORT_NAME = 'Alfa Beauty'; // docs/TZ.md, раздел 9

// Иконки: размер и доля стороны, которую занимает логотип (квадрат viewBox 0 0 120 120).
// maskable: Android обрезает иконку кругом/каплей, видимая зона — круг 80% стороны.
const ICON_SET = [
  { file: 'icon-192.png', size: 192, logo: 0.9 },
  { file: 'icon-512.png', size: 512, logo: 0.9 },
  { file: 'icon-maskable-512.png', size: 512, logo: 0.74 },
  { file: 'apple-touch-icon.png', size: 180, logo: 0.84 }
];

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

// ─────────── 5. Превью ссылки: og-image.png и теги Open Graph ───────────
// Рисунки ILLUSTRATIONS из index.html (блок между /*ILL:START*/ и /*ILL:END*/)
function illustrations(html) {
  const m = html.match(/\/\*ILL:START\*\/([\s\S]*?)\/\*ILL:END\*\//);
  if (!m) throw new Error('В index.html нет меток /*ILL:START*/ … /*ILL:END*/');
  return vm.runInNewContext(m[1] + '\n;ILLUSTRATIONS');
}

function ogPage(data, html, theme) {
  const share = data.meta.share;
  // heading — массив строк; строку (старый формат) делим по « · »
  const heading = Array.isArray(share.heading) ? share.heading : String(share.heading).split(' · ');
  const ill = illustrations(html);
  const art = (k, cls) => {
    if (!ill[k]) throw new Error('В ILLUSTRATIONS нет рисунка ' + k);
    return '<div class="ill ' + cls + '">' + ill[k] + '</div>';
  };
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const sans = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  return '<!DOCTYPE html><html data-theme="' + esc(theme) + '"><head><meta charset="utf-8">' + style +
    '<style>' +
    'html,body{margin:0;overflow:hidden;background:var(--bg)}' +
    '.og{position:relative;width:' + OG_W + 'px;height:' + OG_H + 'px;background:var(--bg);color:var(--text);overflow:hidden}' +
    '.frame{position:absolute;inset:10px;border:1px solid var(--gold);opacity:.7;border-radius:24px}' +
    // Рисунки по бокам, за пределами центрального квадрата (видимая часть рисунка — середина viewBox)
    '.og .ill{position:absolute;--sw:1.3;background:none;border-radius:0;transform:translate(-50%,-50%)}' +
    '.a1{left:150px;top:162px;width:410px;height:287px}' +
    '.a2{left:150px;top:468px;width:410px;height:287px}' +
    '.a3{left:1046px;top:315px;width:410px;height:287px}' +
    '.mid{position:absolute;left:' + (OG_W - OG_H) / 2 + 'px;top:0;width:' + OG_H + 'px;height:' + OG_H + 'px;' +
      'display:flex;align-items:center;justify-content:center;text-align:center}' +
    '.stack{display:flex;flex-direction:column;align-items:center}' +
    '.mid .mono{width:195px;height:195px}' +
    '.name{font:600 112px/1.02 var(--font-head);margin-top:2px;white-space:nowrap}' +
    '.tag{color:var(--text-2);font:600 30px/1.3 ' + sans + ';letter-spacing:.14em;text-transform:uppercase;margin-top:8px;white-space:nowrap}' +
    '.mid .ornament{width:360px;max-width:none;margin:16px auto 12px}' +
    '.head{font:600 76px/1.08 var(--font-head);color:var(--accent-strong);white-space:nowrap}' +
    '</style></head><body><div class="og">' +
    '<div class="frame"></div>' +
    art(OG_ILLS.left[0], 'a1') + art(OG_ILLS.left[1], 'a2') + art(OG_ILLS.right[0], 'a3') +
    '<div class="mid"><div class="stack">' +
      '<div class="mono">' + logoSvg(html) + '</div>' +
      '<div class="name fit">' + esc(data.company.name) + '</div>' +
      '<div class="tag fit">' + esc(share.tagline) + '</div>' +
      '<div class="ornament"><span></span></div>' +
      heading.map(h => '<div class="head fit">' + esc(h) + '</div>').join('') +
    '</div></div></div>' +
    // Длинный текст (другой салон) уменьшается: по ширине — до 590 px, по высоте — весь блок в квадрат.
    // Только после загрузки шрифта заголовков (запасной шрифт шире — иначе название зря уменьшится)
    '<script>var nf=getComputedStyle(document.querySelector(".name"));' +
    'document.fonts.load(nf.fontWeight+" 100px "+nf.fontFamily,"AБә").catch(function(){}).then(function(){function fs(el){return parseFloat(getComputedStyle(el).fontSize);}' +
    'document.querySelectorAll(".fit").forEach(function(el){var s=fs(el);' +
    'while(el.scrollWidth>' + (OG_H - 40) + '&&s>12){s-=1;el.style.fontSize=s+"px";}});' +
    'var st=document.querySelector(".stack"),big=document.querySelectorAll(".name,.head"),n=0;' +
    'while(st.offsetHeight>' + (OG_H - 30) + '&&n++<200){big.forEach(function(el){el.style.fontSize=Math.max(12,fs(el)-1)+"px";});}' +
    '});</script>' +
    '</body></html>';
}

function buildOgImage(data, html, theme) {
  const edge = findEdge();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-og-'));
  try {
    const pageFile = path.join(tmp, 'og.html');
    fs.writeFileSync(pageFile, ogPage(data, html, theme));
    const shot = path.join(tmp, 'og.png');
    execFileSync(edge, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--force-device-scale-factor=1', '--user-data-dir=' + path.join(tmp, 'profile'),
      '--window-size=' + OG_W + ',' + OG_H, '--virtual-time-budget=2000',
      '--screenshot=' + shot, 'file:///' + pageFile.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 60000 });
    if (!fs.existsSync(shot)) throw new Error('Edge не создал og-image.png');
    const s = pngSize(shot);
    if (s.w !== OG_W || s.h !== OG_H) throw new Error('og-image.png: получилось ' + s.w + '×' + s.h + ' вместо ' + OG_W + '×' + OG_H);
    let file = shot;
    if (fs.statSync(file).size > OG_MAX_BYTES) {
      // Слишком большой — 256 цветов без сглаживающего шума (нужен ffmpeg)
      file = path.join(tmp, 'og-256.png');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', shot, '-vf',
        'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none', file], { stdio: 'inherit' });
      if (fs.statSync(file).size > OG_MAX_BYTES) throw new Error('og-image.png больше 300 КБ даже после уменьшения палитры');
    }
    fs.copyFileSync(file, OG_IMAGE);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* временная папка — не страшно */ }
  }
  const bytes = fs.readFileSync(OG_IMAGE);
  console.log('og-image.png — ' + OG_W + '×' + OG_H + ', ' + bytes.length + ' байт');
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

function updateOgTags(data, imageHash) {
  const share = data.meta.share;
  const site = data.meta.siteUrl;
  const image = site + 'og-image.png?v=' + imageHash;
  const prop = (p, v) => '<meta property="' + p + '" content="' + esc(v) + '">';
  const name = (n, v) => '<meta name="' + n + '" content="' + esc(v) + '">';
  const tags = [
    name('description', share.description),
    prop('og:type', 'website'),
    prop('og:site_name', data.company.name),
    prop('og:title', share.title),
    prop('og:description', share.description),
    prop('og:url', site),
    prop('og:locale', share.locale),
    prop('og:image', image),
    prop('og:image:type', 'image/png'),
    prop('og:image:width', OG_W),
    prop('og:image:height', OG_H),
    prop('og:image:alt', share.title),
    name('twitter:card', 'summary_large_image'),
    name('twitter:title', share.title),
    name('twitter:description', share.description),
    name('twitter:image', image)
  ].join('\n');
  let html = fs.readFileSync(INDEX, 'utf8');
  const re = /<!--OG:START-->[\s\S]*?<!--OG:END-->/;
  if (!re.test(html)) throw new Error('В index.html нет меток <!--OG:START--> … <!--OG:END-->');
  html = html.replace(re, () => '<!--OG:START-->\n' + tags + '\n<!--OG:END-->');
  fs.writeFileSync(INDEX, html);
  return image;
}

async function main() {
  await buildQr();
  const data = loadData();
  const theme = data.meta.theme || 'nude';
  const src = fs.readFileSync(INDEX, 'utf8');
  const bg = themeVar(src, theme, '--bg');
  if (!data.meta.share) throw new Error('В docs/data.js нет meta.share (тексты превью ссылки)');

  let html = updateIndex(data, theme, bg);
  console.log('index.html: тема ' + theme + ', noscript обновлён');
  console.log('index.html: og:image = ' + updateOgTags(data, buildOgImage(data, html, theme)));
  html = fs.readFileSync(INDEX, 'utf8');
  console.log('Иконки:');
  buildIcons(html, theme);
  buildManifest(data, bg);
  console.log('manifest.webmanifest: theme_color / background_color ' + bg);
  console.log('sw.js: CACHE_VERSION = ' + updateSwVersion());
}

main().catch(e => { console.error(e.message); process.exit(1); });
