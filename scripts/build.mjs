import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

console.log('Static GitHub Pages build is ready in dist/client.');
