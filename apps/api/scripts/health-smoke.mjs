import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to a running PostgreSQL database');
const cases = [
  { port: 3101, databaseUrl: process.env.DATABASE_URL, readyStatus: 200 },
  { port: 3102, databaseUrl: 'postgresql://unused@127.0.0.1:1/unavailable', readyStatus: 503 },
];

for (const { port, databaseUrl, readyStatus } of cases) {
  const api = spawn(process.execPath, ['dist/main.js'], {
    stdio: 'inherit',
    env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port), DATABASE_URL: databaseUrl },
  });
  const exited = once(api, 'exit');
  const liveUrl = `http://127.0.0.1:${port}/health/live`;
  try {
    let live;
    for (let attempt = 0; attempt < 40 && api.exitCode === null; attempt++) {
      live = await fetch(liveUrl, { signal: AbortSignal.timeout(500) }).catch(() => undefined);
      if (live) break;
      await delay(150);
    }
    assert.equal(live?.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    const ready = await fetch(new URL('ready', liveUrl), { signal: AbortSignal.timeout(4000) });
    assert.equal(ready.status, readyStatus);
    assert.equal((await ready.json()).status, readyStatus === 200 ? 'ok' : 'unavailable');
  } finally {
    api.kill();
    await exited;
  }
}
