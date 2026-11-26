import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'www');
const assets = [
  'index.html',
  'boxeo.html',
  'privacidad.html',
  'terminos.html',
  'manifest.webmanifest',
  'sw.js',
  'favicon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png'
];

await mkdir(output, { recursive: true });

for (const asset of assets) {
  await copyFile(resolve(root, asset), resolve(output, asset));
}

console.log(`VIPER: ${assets.length} archivos preparados en ./www`);
