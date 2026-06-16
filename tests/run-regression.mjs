import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['tests/naval-regression.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});

const code = result.outputFiles[0]?.text;
if (!code) {
  throw new Error('Regression bundle was empty');
}

await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
