import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const startedAt = Date.now();
const executable = process.platform === 'win32'
  ? join('node_modules', '.bin', 'vinext.CMD')
  : join('node_modules', '.bin', 'vinext');
const result = spawnSync(executable, ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const outputDirectory = join(process.cwd(), 'dist', 'client');
const indexPath = join(outputDirectory, 'index.html');
const freshStaticOutput = existsSync(indexPath) && statSync(indexPath).mtimeMs >= startedAt - 2000;

// vinext beta 5 can finish successfully on Windows and then hit a libuv shutdown
// assertion. Accept only that late shutdown case when this run wrote fresh output.
if (result.status !== 0 && !(process.platform === 'win32' && freshStaticOutput)) {
  process.exit(result.status ?? 1);
}

for (const fileName of ['index.html', '404.html']) {
  const filePath = join(outputDirectory, fileName);
  const source = readFileSync(filePath, 'utf8');
  const fixed = source.replaceAll('="/./_next/', '="./_next/');
  writeFileSync(filePath, fixed, 'utf8');
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const cachedAssets = listFiles(outputDirectory)
  .map((filePath) => relative(outputDirectory, filePath).split(sep).join('/'))
  .filter((fileName) => fileName !== 'sw.js' && !fileName.endsWith('.map'))
  .map((fileName) => `./${fileName}`);
cachedAssets.unshift('./');

const serviceWorker = `const CACHE_NAME = 'schultag-shell-v4';
const ROOT = new URL('./', self.registration.scope).href;
const CORE_ASSETS = ${JSON.stringify(cachedAssets, null, 2)}.map((path) => new URL(path, self.registration.scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(ROOT, copy)));
      }
      return response;
    }).catch(() => caches.match(ROOT)));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});
`;

writeFileSync(join(outputDirectory, 'sw.js'), serviceWorker, 'utf8');

console.log(`Static GitHub Pages build is ready with ${cachedAssets.length} offline assets.`);
