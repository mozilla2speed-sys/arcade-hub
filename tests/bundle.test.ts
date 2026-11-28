import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';

// The bundler once dropped the "connection lost" handler, which no source-level check can see
test('production bundle keeps the connection handlers', { timeout: 60_000 }, async () => {
  const result = await build({
    configFile: 'client/vite.config.ts',
    logLevel: 'silent',
    build: { write: false, minify: false },
  });
  const outputs = [result].flat().flatMap((r) => ('output' in r ? r.output : []));
  const code = outputs.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n');

  assert.match(code, /ws\.onclose = \(\) => \{[^}]*handlers\.onClose\(\)/);
  assert.match(code, /handlers\.onMessage\(msg\)/);
});
