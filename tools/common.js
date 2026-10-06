/*
 * Общие функции скриптов сборки (tools/pwa/build-pwa.js, tools/qr/build-qr.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'docs', 'data.js');

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

module.exports = { ROOT, INDEX, DATA, loadData, themeVar, logoSvg, esc, findEdge, pngSize };
