// Build the Windows installer and publish it as a GitHub release that the in-app updater can find.
// Usage: npm run release [-- notes.md]   (needs the gh CLI, logged in, and a pushed, clean main branch)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const { version, build } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const { owner, repo } = build.publish[0];
const tag = `v${version}`;
const notes = process.argv[2];
// Only npm (npm.cmd on Windows) needs a shell; git and gh run directly so arguments with spaces stay intact.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (out('git', ['status', '--porcelain'])) throw new Error('工作区有未提交的修改，请先提交');
if (notes && !fs.existsSync(notes)) throw new Error(`找不到更新说明文件 ${notes}`);
let exists = true;
try { out('gh', ['release', 'view', tag, '-R', `${owner}/${repo}`]); } catch { exists = false; }
if (exists) throw new Error(`${tag} 已经发布过了，请先在 package.json 中提高版本号`);

run('npm', ['run', 'dist'], { shell: process.platform === 'win32' });

// latest.yml tells installed copies about this version; the blockmap enables smaller differential downloads.
const exe = `release/TeX-Studio-Minimal-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'release/latest.yml'];
for (const f of files) if (!fs.existsSync(f)) throw new Error(`缺少构建产物 ${f}`);
if (!fs.readFileSync('release/latest.yml', 'utf8').includes(`version: ${version}`)) throw new Error('release/latest.yml 的版本号与 package.json 不一致');

run('gh', ['release', 'create', tag, ...files, '-R', `${owner}/${repo}`, '--target', 'main', '--title', `TeX Studio Minimal ${version}`, ...(notes ? ['--notes-file', notes] : ['--generate-notes'])]);
console.log(`\n已发布 ${tag}：已安装的旧版本会在下次启动时提示更新。`);
