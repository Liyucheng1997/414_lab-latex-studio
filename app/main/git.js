// Version control through the git command line (and gh for publishing to GitHub).
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.safecrlf=false'];
const GITIGNORE = `# LaTeX 编译产生的辅助文件
*.aux
*.bbl
*.bcf
*.blg
*.fdb_latexmk
*.fls
*.idx
*.ilg
*.ind
*.lof
*.log
*.lot
*.nav
*.out
*.run.xml
*.snm
*.synctex.gz
*.synctex(busy)
*.toc
*.vrb
*.xdv
build/
`;

// Background calls must never pop up a credential window; explicit sync may.
function run(cwd, args, { interactive = false, timeout = 60000 } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  if (!interactive) env.GCM_INTERACTIVE = 'never';
  return new Promise((resolve) => {
    execFile('git', [...BASE, ...args], { cwd, env, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code, out: stdout || '', err: (stderr || err?.message || '').trim() });
    });
  });
}

function friendly(err) {
  const e = String(err || '');
  if (/ENOENT|not recognized|spawn git/i.test(e)) return '没有找到 git，请先安装 Git for Windows';
  if (/Please tell me who you are|user\.email|user\.name/i.test(e)) return 'IDENTITY';
  if (/Authentication failed|could not read Username|terminal prompts disabled|403/i.test(e)) return 'GitHub 认证失败：请在浏览器登录 GitHub 后重试';
  if (/Could not resolve host|unable to access|timed out|Connection (was )?reset/i.test(e)) return '连不上 GitHub，请检查网络后重试';
  if (/CONFLICT|could not apply|Resolve all conflicts/i.test(e)) return 'GitHub 上的版本和本地改了同一处，无法自动合并';
  if (/rejected|non-fast-forward|fetch first/i.test(e)) return 'GitHub 上有新的提交，请先同步';
  if (/nothing to commit/i.test(e)) return '没有需要提交的修改';
  if (/does not have any commits yet|bad default revision 'HEAD'/i.test(e)) return '还没有任何提交';
  return e.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') || 'git 执行失败';
}
const fail = (r) => ({ ok: false, error: friendly(r.err) });

async function rootOf(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const r = await run(dir, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.normalize(r.out.trim()) : null;
}

// Porcelain v1 with -z: "XY path\0" (renames: "XY new\0old\0"); first entry is the "## branch" line.
async function status(dir) {
  const root = await rootOf(dir);
  if (!root) {
    const probe = await run(dir || process.cwd(), ['--version']);
    return { repo: false, gitMissing: !probe.ok };
  }
  const r = await run(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  if (!r.ok) return { repo: true, root, error: friendly(r.err), files: [] };
  const parts = r.out.split('\0');
  const head = parts.shift() || '';
  const st = { repo: true, root, branch: '', upstream: '', ahead: 0, behind: 0, detached: false, noCommits: false, files: [] };
  const m = /^## (No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(head);
  if (m) {
    st.noCommits = !!m[1];
    st.branch = m[2];
    st.upstream = m[3] || '';
    if (/HEAD \(no branch\)/.test(m[2])) { st.detached = true; st.branch = 'HEAD'; }
    const ab = m[4] || '';
    st.ahead = +(/ahead (\d+)/.exec(ab)?.[1] || 0);
    st.behind = +(/behind (\d+)/.exec(ab)?.[1] || 0);
    st.upstreamGone = /gone/.test(ab);
  }
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const x = e[0], y = e[1], rel = e.slice(3);
    let from;
    if (x === 'R' || x === 'C') from = parts[++i];
    const code = x === '?' ? '?' : x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D') ? 'U' : y !== ' ' ? y : x;
    st.files.push({ rel, from, path: path.join(root, rel), code, staged: x !== ' ' && x !== '?' });
  }
  const [remote, state] = await Promise.all([run(root, ['remote', 'get-url', 'origin']), repoState(root)]);
  st.remoteUrl = remote.ok ? remote.out.trim() : '';
  st.webUrl = webUrl(st.remoteUrl);
  st.state = state;
  return st;
}

async function repoState(root) {
  const g = await run(root, ['rev-parse', '--git-dir']);
  if (!g.ok) return '';
  const gd = path.resolve(root, g.out.trim());
  if (fs.existsSync(path.join(gd, 'rebase-merge')) || fs.existsSync(path.join(gd, 'rebase-apply'))) return 'rebase';
  if (fs.existsSync(path.join(gd, 'MERGE_HEAD'))) return 'merge';
  return '';
}

function webUrl(remote) {
  const m = /github\.com[:/](.+?)(?:\.git)?\/?$/.exec(remote || '');
  return m ? `https://github.com/${m[1]}` : '';
}

const SEP = '\x1f', END = '\x1e';
async function log(dir, limit = 300) {
  const root = await rootOf(dir);
  if (!root) return { commits: [] };
  const r = await run(root, ['log', '--branches', '--remotes', '--tags', 'HEAD', '--date-order', '-n', String(limit), `--format=%H${SEP}%P${SEP}%an${SEP}%at${SEP}%s${SEP}%D${END}`]);
  if (!r.ok) return { commits: [], error: /does not have any commits|bad default revision/.test(r.err) ? '' : friendly(r.err) };
  const commits = r.out.split(END).map((s) => s.replace(/^\s+/, '')).filter(Boolean).map((s) => {
    const [hash, parents, author, at, subject, refs] = s.split(SEP);
    return { hash, parents: parents ? parents.split(' ') : [], author, time: +at * 1000, subject, refs: refs ? refs.split(', ').filter(Boolean) : [] };
  });
  // Commits that only exist locally (not yet on GitHub)
  const u = await run(root, ['rev-list', '@{u}..HEAD']);
  const local = u.ok ? u.out.split(/\s+/).filter(Boolean) : [];
  return { commits, unpushed: local };
}

async function show(dir, hash) {
  const root = await rootOf(dir);
  const r = await run(root, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%B', hash]);
  if (!r.ok) return fail(r);
  const [h, author, email, at, ...body] = r.out.split(SEP);
  return { ok: true, hash: h, author, email, time: +at * 1000, message: body.join(SEP).trim(), files: await changedFiles(root, hash) };
}

async function changedFiles(root, hash) {
  const r = await run(root, ['diff-tree', '--no-commit-id', '--root', '-r', '-z', '--name-status', '-M', hash]);
  const parts = r.out.split('\0').filter((x) => x !== '');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i][0];
    if (code === 'R' || code === 'C') { files.push({ code, from: parts[i + 1], rel: parts[i + 2] }); i += 2; } else { files.push({ code, rel: parts[i + 1] }); i += 1; }
  }
  return files.map((f) => ({ ...f, path: path.join(root, f.rel) }));
}

// Unified diff of one file: working tree vs HEAD (hash empty) or a commit vs its parent.
async function diff(dir, rel, hash) {
  const root = await rootOf(dir);
  if (!root) return { ok: false, error: '不是 git 仓库' };
  let r;
  if (hash) r = await run(root, ['show', '--format=', '-M', '--find-renames', hash, '--', rel]);
  else {
    r = await run(root, ['diff', 'HEAD', '-M', '--', rel]);
    if (r.ok && !r.out.trim()) {
      // Untracked (or no commits yet): show the whole file as added.
      const p = path.join(root, rel);
      try {
        const buf = fs.readFileSync(p);
        if (buf.includes(0)) return { ok: true, binary: true, text: '' };
        const lines = buf.toString('utf8').split(/\r?\n/);
        return { ok: true, text: `@@ 新文件 @@\n` + lines.map((l) => '+' + l).join('\n') };
      } catch { return { ok: true, text: '' }; }
    }
  }
  if (!r.ok) return fail(r);
  const binary = /^Binary files .* differ$/m.test(r.out);
  const body = r.out.split('\n');
  const start = body.findIndex((l) => l.startsWith('@@'));
  return { ok: true, binary, text: start < 0 ? '' : body.slice(start).join('\n') };
}

async function commit(dir, message) {
  const root = await rootOf(dir);
  if (!root) return { ok: false, error: '不是 git 仓库' };
  let r = await run(root, ['add', '-A']);
  if (!r.ok) return fail(r);
  r = await run(root, ['commit', '-m', message]);
  if (!r.ok) return fail(r.out.includes('nothing to commit') ? { err: 'nothing to commit' } : r);
  return { ok: true };
}

async function setIdentity(name, email) {
  const a = await run(process.cwd(), ['config', '--global', 'user.name', name]);
  const b = await run(process.cwd(), ['config', '--global', 'user.email', email]);
  return a.ok && b.ok ? { ok: true } : fail(a.ok ? b : a);
}

// Pull (rebase, keeping uncommitted edits) then push; the first push sets the upstream.
async function sync(dir) {
  const st = await status(dir);
  if (!st.repo) return { ok: false, error: '不是 git 仓库' };
  if (!st.remoteUrl) return { ok: false, error: 'NO_REMOTE' };
  if (st.detached) return { ok: false, error: '当前不在任何分支上，无法同步' };
  const root = st.root;
  const opts = { interactive: true, timeout: 180000 };
  if (st.upstream && !st.upstreamGone) {
    const f = await run(root, ['fetch', 'origin'], opts);
    if (!f.ok) return fail(f);
    const p = await run(root, ['pull', '--rebase', '--autostash', '--no-edit'], opts);
    if (!p.ok) {
      if ((await repoState(root)) === 'rebase') await run(root, ['rebase', '--abort']);
      return { ok: false, error: friendly(p.err || p.out) };
    }
    const after = await status(root);
    // --follow-tags also uploads version tags that are still only local.
    const u = await run(root, ['push', '--follow-tags'], opts);
    return u.ok ? { ok: true, pulled: st.behind, pushed: after.ahead } : fail(u);
  }
  const u = await run(root, ['push', '--follow-tags', '-u', 'origin', st.branch], opts);
  return u.ok ? { ok: true, pulled: 0, pushed: 1, first: true } : fail(u);
}

// Background refresh of ahead/behind counts; silent on failure.
async function fetch(dir) {
  const root = await rootOf(dir);
  if (!root) return { ok: false };
  const r = await run(root, ['fetch', '--quiet', 'origin'], { timeout: 30000 });
  return { ok: r.ok };
}

async function discard(dir, rel, code) {
  const root = await rootOf(dir);
  if (code === '?') { try { require('electron').shell.trashItem(path.join(root, rel)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
  const r = await run(root, ['restore', '--staged', '--worktree', '--source=HEAD', '--', rel]);
  return r.ok ? { ok: true } : fail(r);
}

async function restoreFile(dir, hash, rel) {
  const root = await rootOf(dir);
  const r = await run(root, ['checkout', hash, '--', rel]);
  if (!r.ok) return fail(r);
  await run(root, ['reset', '-q', '--', rel]);
  return { ok: true };
}

// Annotated tag (like `git tag -a v2.6 -m …`), uploaded right away when the repo has a remote.
async function tag(dir, hash, name, message, push = true) {
  const root = await rootOf(dir);
  const r = await run(root, ['tag', '-a', name, '-m', message || name, hash]);
  if (!r.ok) return { ok: false, error: /already exists/.test(r.err) ? `标签 ${name} 已经存在` : /not a valid tag name/.test(r.err) ? `"${name}" 不能用作标签名（不能有空格和 ~^:?*[ 等符号）` : friendly(r.err) };
  if (!push) return { ok: true, pushed: false };
  const has = await run(root, ['remote', 'get-url', 'origin']);
  if (!has.ok) return { ok: true, pushed: false };
  const u = await run(root, ['push', 'origin', 'refs/tags/' + name], { interactive: true, timeout: 120000 });
  return u.ok ? { ok: true, pushed: true } : { ok: true, pushed: false, warning: friendly(u.err) };
}

async function deleteTag(dir, name, remote = true) {
  const root = await rootOf(dir);
  const r = await run(root, ['tag', '-d', name]);
  if (!r.ok) return fail(r);
  if (!remote) return { ok: true };
  const ls = await run(root, ['ls-remote', '--tags', 'origin', 'refs/tags/' + name], { interactive: true });
  if (!ls.ok || !ls.out.trim()) return { ok: true };
  const u = await run(root, ['push', 'origin', ':refs/tags/' + name], { interactive: true, timeout: 120000 });
  return u.ok ? { ok: true } : { ok: true, warning: friendly(u.err) };
}

// Latest version-like tag (v2.5, 1.3.0 …) so the dialog can suggest the next one.
async function tags(dir) {
  const root = await rootOf(dir);
  if (!root) return [];
  const r = await run(root, ['tag', '--sort=-creatordate']);
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

async function init(dir) {
  const r = await run(dir, ['init', '-b', 'main']);
  if (!r.ok) return fail(r);
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE, 'utf8');
  return { ok: true };
}

async function setRemote(dir, url) {
  const root = await rootOf(dir);
  const has = await run(root, ['remote', 'get-url', 'origin']);
  const r = await run(root, has.ok ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  return r.ok ? { ok: true } : fail(r);
}

// Create a GitHub repository with gh and push the current branch to it.
function publish(dir, name, isPrivate) {
  return new Promise(async (resolve) => {
    const root = await rootOf(dir);
    if (!root) return resolve({ ok: false, error: '不是 git 仓库' });
    const st = await status(root);
    if (st.noCommits) return resolve({ ok: false, error: '请先提交一个版本再发布' });
    execFile('gh', ['repo', 'create', name, isPrivate ? '--private' : '--public', '--source', root, '--remote', 'origin', '--push'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 180000 }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, url: (stdout || '').trim().split(/\s+/).find((x) => x.startsWith('https://')) || '' });
      const e = String(stderr || err.message);
      if (/ENOENT|not recognized/i.test(e)) return resolve({ ok: false, error: '没有找到 GitHub CLI（gh）。可以改用"填写仓库地址"，或安装 gh 后重试' });
      if (/auth login|not logged/i.test(e)) return resolve({ ok: false, error: 'gh 还没有登录：请在终端运行 gh auth login' });
      if (/already exists/i.test(e)) return resolve({ ok: false, error: `GitHub 上已经有名为 ${name} 的仓库` });
      resolve({ ok: false, error: e.trim().split(/\r?\n/).slice(-2).join('\n') });
    });
  });
}

module.exports = { status, log, show, diff, commit, sync, fetch, discard, restoreFile, init, setRemote, publish, setIdentity, tag, deleteTag, tags };
