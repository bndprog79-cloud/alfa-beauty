/*
 * QR-код со ссылкой на сайт прайса — для печати (qr/alfa-beauty-qr.svg).
 *
 * Первый раз (из папки проекта):  cd tools; npm install; cd ..
 * Запуск (из папки проекта):      node tools/qr/build-qr.js
 *
 * Ссылка — priceData.meta.siteUrl из docs/data.js. Уровень коррекции M.
 * Тёмные модули — цвет --text темы nude из index.html, фон белый, вокруг белое поле
 * в 4 модуля (так QR надёжно читается с печати).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const QRCode = require('qrcode');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'docs', 'data.js');
const OUT = path.join(ROOT, 'qr', 'alfa-beauty-qr.svg');

function nudeText() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const start = html.indexOf(':root {');
  const block = html.slice(start, html.indexOf('}', start));
  const m = block.match(/\s--text:\s*([^;]+);/);
  if (!m) throw new Error('В index.html (тема nude) нет переменной --text');
  return m[1].trim();
}

async function main() {
  const data = vm.runInNewContext(fs.readFileSync(DATA, 'utf8') + '\n;priceData');
  const url = data.meta.siteUrl;
  const dark = nudeText();
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: dark, light: '#FFFFFF' }
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg.replace('<svg ', '<svg width="600" height="600" ') + '\n');
  console.log('qr/alfa-beauty-qr.svg: ' + url + ' (уровень M, цвет ' + dark + ')');
}

main().catch(e => { console.error(e.message); process.exit(1); });
