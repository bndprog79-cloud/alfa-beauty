/*
 * QR-код со ссылкой на прайс и карточка для печати.
 *
 * Первый раз (из папки проекта):  cd tools; npm install; cd ..
 * Запуск (из папки проекта):      node tools/qr/build-qr.js
 * (его же первым шагом запускает node tools/pwa/build-pwa.js)
 *
 * Ссылка — priceData.meta.siteUrl из docs/data.js + метка источника ?src=qr. Уровень коррекции M.
 * Что делает:
 *  1. qr/alfa-beauty-qr.svg — для печати: тёмные модули — цвет --text темы nude, фон белый,
 *     вокруг белое поле в 4 модуля (так QR надёжно читается с печати).
 *  2. index.html: QR для окна «QR-код» — SVG между метками /*QR:START*\/ … /*QR:END*\/
 *     (цвета — классы qr-bg / qr-m, т. е. переменные темы --qr-light / --qr-dark).
 *  3. print/card-a6.pdf и print/card-a6.png — карточка A6 (105×148 мм, вертикально) в цветах
 *     темы meta.theme: логотип, название, meta.share.heading, крупный QR, ui.qrHint (RU · KK),
 *     адрес (RU и KK) и телефон. Фон до края листа, всё важное — не ближе 7 мм к краю
 *     (запас под обрезку). PNG — 1240×1748 px, 300 dpi. Рисует Microsoft Edge без окна.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const QRCode = require('qrcode');
const { ROOT, INDEX, loadData, themeVar, logoSvg, esc, findEdge, pngSize } = require('../common');

const OUT_SVG = path.join(ROOT, 'qr', 'alfa-beauty-qr.svg');
const PRINT = path.join(ROOT, 'print');
const CARD_PDF = path.join(PRINT, 'card-a6.pdf');
const CARD_PNG = path.join(PRINT, 'card-a6.png');

const SRC = 'qr';                      // метка источника для всех QR
const CARD_MM = { w: 105, h: 148 };    // A6 вертикально
const DPI = 300;
const PX_PER_MM = 96 / 25.4;           // CSS-пиксели в миллиметре
const PNG_W = Math.round(CARD_MM.w / 25.4 * DPI); // 1240
const PNG_H = Math.round(CARD_MM.h / 25.4 * DPI); // 1748

function qrUrl(data) {
  return data.meta.siteUrl + '?src=' + SRC;
}

// QR как один path из прямоугольников (по строкам), поле 4 модуля; цвета — классами
function qrSvg(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const q = 4;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!bits[y * n + x]) continue;
      let run = 1;
      while (x + run < n && bits[y * n + x + run]) run++;
      d += 'M' + (x + q) + ' ' + (y + q) + 'h' + run + 'v1h-' + run + 'z';
      x += run - 1;
    }
  }
  const s = n + 2 * q;
  return '<svg class="qr" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
    '<rect class="qr-bg" width="' + s + '" height="' + s + '"/><path class="qr-m" d="' + d + '"/></svg>';
}

async function buildPrintSvg(url, html) {
  const dark = themeVar(html, 'nude', '--text');
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: dark, light: '#FFFFFF' }
  });
  fs.mkdirSync(path.dirname(OUT_SVG), { recursive: true });
  fs.writeFileSync(OUT_SVG, svg.replace('<svg ', '<svg width="600" height="600" ') + '\n');
  console.log('qr/alfa-beauty-qr.svg: ' + url + ' (уровень M, цвет ' + dark + ')');
}

function embedQr(url, svg) {
  let html = fs.readFileSync(INDEX, 'utf8');
  const re = /\/\*QR:START\*\/[\s\S]*?\/\*QR:END\*\//;
  if (!re.test(html)) throw new Error('В index.html нет меток /*QR:START*/ … /*QR:END*/');
  const block = '/*QR:START*/\n// ' + url + ' — собирает tools/qr/build-qr.js, руками не править\n' +
    "const QR_SVG = '" + svg + "';\n/*QR:END*/";
  html = html.replace(re, () => block);
  fs.writeFileSync(INDEX, html);
  console.log('index.html: QR для окна «QR-код» (' + svg.length + ' символов)');
  return html;
}

// ─────────── Карточка A6 ───────────
function cardPage(data, html, theme, svg, zoom) {
  const c = data.company;
  const share = data.meta.share || {};
  const heading = Array.isArray(share.heading) ? share.heading.join(' · ') : (share.heading || '');
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const sans = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  return '<!DOCTYPE html><html data-theme="' + esc(theme) + '"' + (zoom ? ' style="zoom:' + zoom + '"' : '') +
    '><head><meta charset="utf-8">' + style +
    '<style>' +
    '@page{size:' + CARD_MM.w + 'mm ' + CARD_MM.h + 'mm;margin:0}' +
    'html,body{margin:0;padding:0;overflow:hidden;background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.card6{position:relative;width:' + CARD_MM.w + 'mm;height:' + CARD_MM.h + 'mm;background:var(--bg);color:var(--text);overflow:hidden;' +
      'display:flex;align-items:center;justify-content:center;text-align:center;font-family:' + sans + '}' +
    '.frame{position:absolute;inset:4.5mm;border:.3mm solid var(--gold);border-radius:4mm;opacity:.8}' +
    '.stack{display:flex;flex-direction:column;align-items:center;width:' + (CARD_MM.w - 16) + 'mm}' +
    '.card6 .mono{width:15mm;height:15mm}' +
    '.name{font:600 8.4mm/1.05 var(--font-head);font-variant-numeric:lining-nums;margin-top:1mm;white-space:nowrap}' +
    '.card6 .ornament{width:46mm;max-width:none;margin:2.2mm auto 1.8mm;gap:2mm}' +
    '.card6 .ornament span{width:1.4mm;height:1.4mm}' +
    '.head{font:600 6mm/1.15 var(--font-head);color:var(--accent-strong);white-space:nowrap}' +
    '.plate{margin-top:3.5mm;width:58mm;height:58mm;border-radius:3mm;overflow:hidden;background:var(--qr-light)}' +
    '.plate .qr{display:block;width:100%;height:100%}' +
    '.hint{margin-top:3mm;font-weight:600;font-size:3.2mm;line-height:1.3;white-space:nowrap}' +
    '.addr6{margin-top:3mm;color:var(--text-2);font-size:2.7mm;line-height:1.35;white-space:nowrap}' +
    '.tel6{margin-top:1.4mm;font:600 5mm/1.2 var(--font-head);font-variant-numeric:lining-nums;color:var(--accent-strong);white-space:nowrap}' +
    '</style></head><body><div class="card6">' +
    '<div class="frame"></div>' +
    '<div class="stack">' +
      '<div class="mono">' + logoSvg(html) + '</div>' +
      '<div class="name fit">' + esc(c.name) + '</div>' +
      '<div class="ornament"><span></span></div>' +
      '<div class="head fit">' + esc(heading) + '</div>' +
      '<div class="plate">' + svg + '</div>' +
      '<div class="hint fit">' + esc(data.ui.ru.qrHint + ' · ' + data.ui.kk.qrHint) + '</div>' +
      '<div class="addr6"><div class="fit" lang="ru">' + esc(c.address.ru) + '</div><div class="fit" lang="kk">' + esc(c.address.kk) + '</div></div>' +
      '<div class="tel6 fit">' + esc(c.phoneDisplay) + '</div>' +
    '</div></div>' +
    // Длинный текст (другой салон) уменьшается до ширины безопасной зоны — после загрузки шрифта заголовков
    '<script>var st=document.querySelector(".stack");' +
    'document.fonts.load("600 30px \\"AB Head\\"","AБә").catch(function(){}).then(function(){' +
    'document.querySelectorAll(".fit").forEach(function(el){var s=parseFloat(getComputedStyle(el).fontSize);' +
    'while(el.scrollWidth>st.clientWidth&&s>6){s-=.5;el.style.fontSize=s+"px";}});});</script>' +
    '</body></html>';
}

function edgeRun(edge, tmp, args, page) {
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--user-data-dir=' + path.join(tmp, 'profile'), '--virtual-time-budget=3000'
  ].concat(args, 'file:///' + page.replace(/\\/g, '/')), { stdio: 'ignore', timeout: 90000 });
}

// Отметка 300 dpi внутри PNG (блок pHYs после IHDR) — чтобы программа печати взяла верный размер
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function setPngDpi(file, dpi) {
  const png = fs.readFileSync(file);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  // старый pHYs (если есть) убираем
  const parts = [png.slice(0, ihdrEnd)];
  let pos = ihdrEnd;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (type !== 'pHYs') parts.push(png.slice(pos, end));
    pos = end;
  }
  const ppm = Math.round(dpi / 0.0254);
  const body = Buffer.alloc(13);
  body.write('pHYs', 0, 'latin1');
  body.writeUInt32BE(ppm, 4);
  body.writeUInt32BE(ppm, 8);
  body[12] = 1; // единица — метр
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 17);
  parts.splice(1, 0, chunk);
  fs.writeFileSync(file, Buffer.concat(parts));
}

function buildCard(data, html, theme, svg) {
  const edge = findEdge();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-card-'));
  fs.mkdirSync(PRINT, { recursive: true });
  try {
    // PDF: страница ровно A6 (@page), фон печатается
    const pdfPage = path.join(tmp, 'card.html');
    fs.writeFileSync(pdfPage, cardPage(data, html, theme, svg, 0));
    const pdf = path.join(tmp, 'card.pdf');
    edgeRun(edge, tmp, ['--no-pdf-header-footer', '--print-to-pdf-no-header', '--print-to-pdf=' + pdf], pdfPage);
    if (!fs.existsSync(pdf)) throw new Error('Edge не создал card-a6.pdf');
    fs.copyFileSync(pdf, CARD_PDF);

    // PNG: та же страница, увеличенная до 300 dpi
    const zoom = PNG_W / (CARD_MM.w * PX_PER_MM);
    const pngPage = path.join(tmp, 'card-png.html');
    fs.writeFileSync(pngPage, cardPage(data, html, theme, svg, zoom.toFixed(5)));
    const shot = path.join(tmp, 'card.png');
    edgeRun(edge, tmp, ['--force-device-scale-factor=1', '--window-size=' + PNG_W + ',' + PNG_H, '--screenshot=' + shot], pngPage);
    if (!fs.existsSync(shot)) throw new Error('Edge не создал card-a6.png');
    const s = pngSize(shot);
    if (s.w !== PNG_W || s.h !== PNG_H) throw new Error('card-a6.png: получилось ' + s.w + '×' + s.h + ' вместо ' + PNG_W + '×' + PNG_H);
    setPngDpi(shot, DPI);
    fs.copyFileSync(shot, CARD_PNG);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* временная папка — не страшно */ }
  }
  console.log('print/card-a6.pdf — ' + CARD_MM.w + '×' + CARD_MM.h + ' мм, ' + fs.statSync(CARD_PDF).size + ' байт');
  console.log('print/card-a6.png — ' + PNG_W + '×' + PNG_H + ' px (' + DPI + ' dpi), ' + fs.statSync(CARD_PNG).size + ' байт');
}

async function buildQr() {
  const data = loadData();
  const theme = data.meta.theme || 'nude';
  const url = qrUrl(data);
  const svg = qrSvg(url);
  await buildPrintSvg(url, fs.readFileSync(INDEX, 'utf8'));
  const html = embedQr(url, svg);
  buildCard(data, html, theme, svg);
}

module.exports = { buildQr };

if (require.main === module) {
  buildQr().catch(e => { console.error(e.message); process.exit(1); });
}
