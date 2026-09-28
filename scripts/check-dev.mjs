// `pnpm dev` で web（Vite）と server（Hono）が起動することを確かめ、起動したプロセスだけを止める。
// 終わらないコマンドを残さないための確認用（RUNBOOK 4.）。
import { spawn, spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const child = spawn(isWin ? 'pnpm.cmd' : 'pnpm', ['dev'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWin,
  detached: !isWin,
});
let output = '';
child.stdout.on('data', (d) => {
  output += d;
});
child.stderr.on('data', (d) => {
  output += d;
});

function killTree() {
  if (child.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-child.pid, 'SIGTERM');
}

async function waitFor(url, init, check, timeoutMs = 60_000) {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    try {
      const res = await fetch(url, init);
      if (await check(res)) return res;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout: ${url}`);
}

let ok = false;
try {
  await waitFor('http://127.0.0.1:8787/healthz', {}, (r) => r.ok);
  process.stdout.write('server: /healthz 200\n');
  const page = await waitFor('http://localhost:5173/', {}, (r) => r.ok);
  process.stdout.write(`web: / ${page.status}\n`);
  // /api の GET も X-Ito-Client が要る（SPEC §14 の 4.。アプリの fetch と同じく付ける）
  const me = await waitFor(
    'http://localhost:5173/api/me',
    { headers: { 'X-Ito-Client': '1' } },
    (r) => r.status < 500,
  );
  process.stdout.write(`web → server（proxy）: /api/me ${me.status}\n`);
  ok = page.ok && me.ok;
} catch (e) {
  process.stdout.write(`${e}\n${output.slice(-3000)}\n`);
} finally {
  killTree();
}
process.exit(ok ? 0 : 1);
