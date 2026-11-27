import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html=read('../index.html');
const manifest=JSON.parse(read('../manifest.webmanifest'));
const worker=read('../sw.js');
const prepare=read('./prepare-web.mjs');
const capacitor=read('../capacitor.config.ts');

// Static PWA install readiness. These checks cannot replace testing on a physical phone.
assert.equal(manifest.display,'standalone','Home screen installation must open a standalone app');
assert.equal(manifest.start_url,'./');
assert.equal(manifest.scope,'./');
assert.ok(manifest.name && manifest.short_name && manifest.theme_color);
assert.ok(manifest.icons.some(x=>x.sizes==='192x192' && x.type==='image/png'));
assert.ok(manifest.icons.some(x=>x.sizes==='512x512' && x.type==='image/png'));
for(const name of ['index.html','sw.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png','favicon.svg']){
  assert.ok(existsSync(new URL('../'+name,import.meta.url)),name+' is missing');
  assert.ok(prepare.includes("'"+name+"'"),name+' is missing from the Capacitor asset packager');
}
assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'));
assert.ok(html.includes('rel="apple-touch-icon" href="icon-180.png"'));
assert.ok(html.includes('name="apple-mobile-web-app-capable"'));
assert.ok(html.includes('viewport-fit=cover'), 'iPhone safe-area support is expected');
assert.ok(/navigator\.serviceWorker\.register\(['"]sw\.js['"]\)/.test(html),'Service worker must be registered');
new Script(worker, {filename:'sw.js'}); // syntax check without installing a worker

// VIPER uses network-first, no offline data cache: avoid accidentally caching private user data.
assert.ok(!/\bcaches\.(?:open|match|delete|keys)\s*\(/.test(worker),
  'No cached private user data without a reviewed offline strategy');
assert.ok(!/self\.addEventListener\(\s*['"]push['"]/.test(worker),
  'Push delivery has not been implemented; do not claim background push notifications');

// Real camera capture is required on both platforms for AI photos and gym proof.
for(const type of ['gym','meal','protein']){
  assert.ok(html.includes(type+'-camera-overlay'),'Missing '+type+' live camera UI');
  assert.ok(html.includes(type+'-camera-video'),'Missing '+type+' preview');
  assert.ok(html.includes(type+'-camera-close'),'Missing '+type+' camera close control');
}
assert.ok((html.match(/getUserMedia\(/g)||[]).length>=3,'Food, shake and gym must ask for camera');
assert.ok((html.match(/getTracks\(\)\.forEach\(function\(t\)\{t\.stop\(\);\}\)/g)||[]).length>=3,
  'Each camera flow must release its media tracks');
assert.ok(html.includes('autoplay playsinline muted'),'Inline iOS camera preview expected');
assert.ok(html.includes('id="mobile-tabs"'),'Bottom navigation must exist');
assert.ok(html.includes('[hidden]{display:none!important}'),'Hidden modals must stay hidden');

// OAuth currently targets the active web URL. A native wrapper needs its own deep-link flow.
assert.ok(html.includes('redirectTo: location.origin + location.pathname + location.search'),
  'Keep OAuth redirect tied to the current hosted web URL');
assert.ok(html.includes("sb.auth.getSession()"),'Persisted sign-in must be restored');
assert.ok(html.includes("window.viperPasswordRecovery"),'Recovery mode must be guarded');

// Capacitor configuration exists, but compiling for stores requires the native platforms and QA.
assert.ok(capacitor.includes("appId: 'com.viper.fitness'"));
assert.ok(capacitor.includes("webDir: 'www'"));
console.log('VIPER mobile static readiness passed: Android/iOS PWA assets, camera, auth, privacy and Capacitor configuration.');
