import { readFileSync } from 'fs';
import { build } from 'esbuild';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
);

const banner = `#!/usr/bin/env node
var _cw=console.warn;console.warn=function(){var s=arguments[0];if(typeof s==='string'&&s.includes('Failed to load bindings'))return;_cw.apply(console,arguments)};var _pe=process.emit;process.emit=function(e,a){if(e==='warning'&&a&&a.name==='DeprecationWarning')return false;return _pe.apply(this,arguments)};`;

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  banner: { js: banner },
  define: {
    __BYREAL_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  external: [
    // Titan SDK has native addon transitive deps (websocket) that cannot be bundled.
    '@titanexchange/sdk-ts',
  ],
});
