import { build } from 'esbuild';
import { cp, mkdir, access, chmod } from 'node:fs/promises';

const exists = (p) => access(p).then(() => true, () => false);

await mkdir('dist/web', { recursive: true });

if (await exists('src/server/cli.ts')) {
  await build({
    entryPoints: ['src/server/cli.ts'],
    outfile: 'dist/cli.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  });
  await chmod('dist/cli.js', 0o755);
} else {
  console.log('skip: src/server/cli.ts not present yet');
}

if (await exists('src/web/main.ts')) {
  await build({
    entryPoints: ['src/web/main.ts'],
    outfile: 'dist/web/main.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
} else {
  console.log('skip: src/web/main.ts not present yet');
}

// dev-only sprite sheet (harmless to ship): /sprite-sheet.html
if (await exists('src/web/sprite-sheet.ts')) {
  await build({
    entryPoints: ['src/web/sprite-sheet.ts'],
    outfile: 'dist/web/sprite-sheet.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
  await cp('src/web/sprite-sheet.html', 'dist/web/sprite-sheet.html');
}

if (await exists('src/web/index.html')) await cp('src/web/index.html', 'dist/web/index.html');
else console.log('skip: src/web/index.html not present yet');

if (await exists('roles')) await cp('roles', 'dist/roles', { recursive: true });
else console.log('skip: roles/ not present yet');
