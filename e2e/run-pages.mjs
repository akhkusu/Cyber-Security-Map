import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'security-map-pages-'));
const env = { ...process.env, APP_BASE_PATH: '/Cyber-Security-Map/', PAGES_TEST_DIRECTORY: root };
let status = 1;
try {
  const build = spawnSync('npm', ['run', 'build'], { env, stdio: 'inherit' });
  if (build.status === 0) {
    const site = join(root, 'Cyber-Security-Map'); await mkdir(site); await cp('dist', site, { recursive: true });
    status = spawnSync('npx', ['--no-install', 'playwright', 'test'], { env, stdio: 'inherit' }).status ?? 1;
  }
} finally { await rm(root, { recursive: true, force: true }); }
process.exitCode = status;
