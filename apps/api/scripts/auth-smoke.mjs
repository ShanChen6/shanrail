import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const { DATABASE_URL, SHANRAIL_SEED_PASSWORD } = process.env;
assert.ok(DATABASE_URL && SHANRAIL_SEED_PASSWORD, 'Run migrations and demo seed first');
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(`
    SELECT r.code, array_agg(s.code ORDER BY rs.stop_order) AS stops
    FROM routes r JOIN route_stops rs ON rs.route_id = r.id
    JOIN stations s ON s.id = rs.station_id
    WHERE r.code LIKE 'DEMO-%' GROUP BY r.code ORDER BY r.code
  `);
  assert.deepEqual(rows, [
    { code: 'DEMO-NORTH-SOUTH', stops: ['HAN', 'VIN', 'DAN', 'NTR', 'SGN'] },
    { code: 'DEMO-SOUTH-NORTH', stops: ['SGN', 'NTR', 'DAN', 'VIN', 'HAN'] },
  ]);
} finally {
  await db.end();
}

const port = 3103;
const api = spawn(process.execPath, ['dist/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, API_PORT: String(port), API_HOST: '127.0.0.1' },
});
const exited = once(api, 'exit');
const request = (path, token, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
  ...options,
  headers: { ...options.headers, ...(token && { Authorization: `Bearer ${token}` }) },
  signal: AbortSignal.timeout(3000),
});
const login = (email, password) => request('/auth/login', undefined, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

try {
  let live;
  for (let attempt = 0; attempt < 40 && api.exitCode === null; attempt++) {
    live = await request('/health/live').catch(() => undefined);
    if (live) break;
    await delay(150);
  }
  assert.equal(live?.status, 200);
  assert.equal((await request('/access/admin')).status, 401);
  assert.equal((await login('customer@example.test', 'incorrect')).status, 401);

  for (const role of ['CUSTOMER', 'ADMIN', 'INSPECTOR']) {
    const response = await login(` ${role}@example.test `, SHANRAIL_SEED_PASSWORD);
    assert.equal(response.status, 200);
    const { token, account } = await response.json();
    assert.equal(account.role, role);
    const profile = await request('/auth/me', token);
    assert.equal(profile.status, 200);
    assert.deepEqual(await profile.json(), account);
    assert.equal((await request('/access/admin', token)).status, role === 'ADMIN' ? 200 : 403);
    assert.equal((await request('/access/inspection', token)).status, role === 'INSPECTOR' ? 200 : 403);
    assert.equal((await request('/auth/logout', token, { method: 'POST' })).status, 204);
    assert.equal((await request('/auth/me', token)).status, 401);
  }
} finally {
  api.kill();
  await exited;
}
