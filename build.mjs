// Bundle the renderer and copy static assets into app/renderer.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const out = 'app/renderer';
const watch = process.argv.includes('--watch');
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => fs.cpSync(from, path.join(out, to), { recursive: true });
copy('src/index.html', 'index.html');
copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.mjs');
copy('node_modules/pdfjs-dist/cmaps', 'cmaps');
copy('node_modules/pdfjs-dist/standard_fonts', 'standard_fonts');
if (fs.existsSync('build/icon.png')) copy('build/icon.png', 'icon.png');

const ctx = await esbuild.context({
  entryPoints: { bundle: 'src/renderer/main.js' },
  bundle: true,
  format: 'esm',
  target: 'chrome130',
  outdir: out,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'dataurl', '.png': 'dataurl' },
  assetNames: 'assets/[name]-[hash]',
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
