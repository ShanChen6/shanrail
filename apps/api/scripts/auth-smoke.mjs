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
    assert.equal((await request('/admin/stations', token)).status, role === 'ADMIN' ? 200 : 403);
    if (role === 'ADMIN') await verifyScheduling(token);
    assert.equal((await request('/access/inspection', token)).status, role === 'INSPECTOR' ? 200 : 403);
    assert.equal((await request('/auth/logout', token, { method: 'POST' })).status, 204);
    assert.equal((await request('/auth/me', token)).status, 401);
  }
} finally {
  api.kill();
  await exited;
}

async function verifyScheduling(token) {
  async function json(path, method, body, expected) {
    const response = await request('/admin/' + path, token, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  const fixture = Date.now().toString(36);
  const stationPayload = { code: 'TEST-' + fixture, name: 'Ga thử', city: 'Hà Nội' };
  const station = await json('stations', 'POST', stationPayload, 201);
  await json('stations/' + station.id, 'PUT', { ...stationPayload, name: 'Ga kiểm thử' }, 200);
  const routes = (await json('routes', 'GET', undefined, 200)).filter((route) => route.code.startsWith('DEMO-'));
  assert.equal(routes.length, 2);
  await json('routes', 'POST', {
    code: 'BAD-' + fixture, name: 'Invalid route', stops: [routes[0].stops[0], routes[0].stops[0]],
  }, 400);
  const customRoute = await json('routes', 'POST', {
    code: 'TEST-' + fixture, name: 'Tuyến thử', stops: [routes[0].stops[0], { stationId: station.id, distanceKm: 50 }],
  }, 201);
  await json('routes/' + customRoute.id, 'PUT', {
    code: 'TEST-' + fixture, name: 'Tuyến cập nhật', stops: [routes[0].stops[0], { stationId: station.id, distanceKm: 60 }],
  }, 200);
  const coachInput = {
    code: 'TEST-' + fixture, name: 'Toa mẫu', places: [
      { label: '01', kind: 'SEAT' }, { label: '02', kind: 'BERTH' },
    ],
  };
  const coach = await json('coach-templates', 'POST', coachInput, 201);
  const futureDay = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const followingDay = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
  for (const [direction, route] of routes.entries()) {
    const stops = route.stops.map(({ stationId }, index) => ({
      stationId,
      arrivalAt: index === 0 ? null : `${followingDay}T0${index}:00+07:00`,
      departureAt: index === 0 ? `${futureDay}T23:30+07:00` :
        index === route.stops.length - 1 ? null : `${followingDay}T0${index}:10+07:00`,
    }));
    const input = { code: `T${direction}-${fixture}`, routeId: route.id, coachTemplateIds: [coach.id, coach.id], stops };
    const swappedIds = stops.map((stop) => stop.stationId);
    [swappedIds[1], swappedIds[2]] = [swappedIds[2], swappedIds[1]];
    await json('trips', 'POST', {
      ...input, stops: stops.map((stop, index) => ({ ...stop, stationId: swappedIds[index] })),
    }, 400);
    await json('trips', 'POST', {
      ...input, stops: [stops[0], { ...stops[1], departureAt: `${followingDay}T00:30+07:00` }, ...stops.slice(2)],
    }, 400);
    const trip = await json('trips', 'POST', input, 201);
    assert.equal((await json('trips/' + trip.id, 'GET', undefined, 200)).status, 'DRAFT');
    await json('trips/' + trip.id + '/publish', 'POST', undefined, 201);
    await json('trips/' + trip.id + '/publish', 'POST', undefined, 201);
    const detail = await json('trips/' + trip.id, 'GET', undefined, 200);
    assert.equal(detail.status, 'ON_SALE');
    assert.equal(detail.stops.length, 5);
    assert.equal(+new Date(detail.stops[1].arrivalAt) - +new Date(detail.departureAt), 90 * 60_000);
    await json('coach-templates/' + coach.id, 'PUT', { ...coachInput, name: 'Toa đã sửa' }, 200);
    const afterEdit = await json('trips/' + trip.id, 'GET', undefined, 200);
    assert.deepEqual(afterEdit.coaches, detail.coaches);
    const search = async (from, to, date) => {
      const query = new URLSearchParams({ from, to, date });
      const response = await request('/public/trips?' + query);
      assert.equal(response.status, 200);
      return response.json();
    };
    const from = route.stops[1].stationId;
    const to = route.stops[2].stationId;
    const matched = (await search(from, to, followingDay)).find((item) => item.id === trip.id);
    assert.ok(matched);
    const km = route.stops[2].distanceKm - route.stops[1].distanceKm;
    assert.equal(matched.distanceKm, km);
    assert.deepEqual(matched.fares, [
      { kind: 'SEAT', amountVnd: km * 900 }, { kind: 'BERTH', amountVnd: km * 1500 },
    ]);
    assert.ok(!(await search(from, to, futureDay)).some((item) => item.id === trip.id));
    assert.ok(!(await search(to, from, followingDay)).some((item) => item.id === trip.id));

  }
}
