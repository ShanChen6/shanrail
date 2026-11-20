import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';

const exec = promisify(execFile);

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
  signal: options.signal ?? AbortSignal.timeout(3000),
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
  const inspectorLogin = await login('inspector@example.test', SHANRAIL_SEED_PASSWORD);
  assert.equal(inspectorLogin.status, 200);
  const inspector = (await inspectorLogin.json()).token;
  assert.equal((await request('/admin/orders', inspector)).status, 403);
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
    if (direction === 0 && process.env.CI === 'true') {
      const largeCoach = await json('coach-templates', 'POST', {
        code: 'PERF-' + fixture, name: 'Toa thử tải',
        places: Array.from({ length: 50 }, (_, index) => ({
          label: String(index + 1).padStart(2, '0'), kind: 'SEAT',
        })),
      }, 201);
      const largeTrip = await json('trips', 'POST', {
        ...input, code: 'PERF-' + fixture, coachTemplateIds: Array(10).fill(largeCoach.id),
      }, 201);
      await json('trips/' + largeTrip.id + '/publish', 'POST', undefined, 201);
      const { stdout } = await exec(process.execPath, [
        'scripts/staging-perf.mjs', `http://127.0.0.1:${port}`, largeTrip.id,
        stops[1].stationId, stops[2].stationId, followingDay,
      ], { env: { ...process.env, SHANRAIL_PERF_API_PREFIX: '/public/' }, timeout: 60000 });
      console.log('CI rehearsal (direct API, 500 places):\n%s', stdout.trim());
    }
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
    const mapPath = '/public/trips/' + trip.id + '/coaches?';
    const map = await request(mapPath + new URLSearchParams({ from, to }));
    assert.equal(map.status, 200);
    assert.equal(map.headers.get('cache-control'), 'no-store');
    const coaches = await map.json();
    assert.deepEqual(coaches.map(({ number }) => number), [1, 2]);
    assert.deepEqual(coaches[0].places, coachInput.places.map((place) => ({
      ...place, status: 'AVAILABLE',
    })));
    assert.equal((await request(mapPath + new URLSearchParams({ from: to, to: from }))).status, 404);
    const holdPath = '/public/trips/' + trip.id + '/holds';
    const hold = (places, start = from, end = to) => request(holdPath, undefined, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: start, to: end, places }),
    });
    const place = { coachNumber: 1, label: '01' };
    const eventPath = mapPath.replace('coaches?', 'coaches/events?') + new URLSearchParams({ from, to });
    const streams = new AbortController();
    let contenders;
    try {
      const clients = await Promise.all([0, 1].map(() => openCoachStream(eventPath, streams.signal)));
      await Promise.all(clients.map((next) => next('AVAILABLE')));
      const started = performance.now();
      contenders = await Promise.all(Array.from({ length: 20 }, () => hold([place])));
      await Promise.all(clients.map((next) => next('HELD')));
      console.log('Two independent SSE clients saw HELD in %d ms', Math.round(performance.now() - started));
    } finally {
      streams.abort();
    }
    assert.equal(contenders.filter(({ status }) => status === 201).length, 1);
    assert.equal(contenders.filter(({ status }) => status === 409).length, 19);
    const winner = await contenders.find(({ status }) => status === 201).json();
    const otherPlace = { coachNumber: 1, label: '02' };
    assert.equal((await hold([otherPlace, place])).status, 409);
    const updatedMap = await (await request(mapPath + new URLSearchParams({ from, to }))).json();
    assert.deepEqual(updatedMap[0].places.map(({ status }) => status), ['HELD', 'AVAILABLE']);
    const adjacent = await hold([place], route.stops[0].stationId, from);
    assert.equal(adjacent.status, 201);
    const adjacentHold = await adjacent.json();
    for (const id of [winner.holdId, adjacentHold.holdId]) {
      assert.equal((await request('/public/holds/' + id, undefined, { method: 'DELETE' })).status, 204);
    }
    const releasedMap = await (await request(mapPath + new URLSearchParams({ from, to }))).json();
    assert.ok(releasedMap[0].places.every(({ status }) => status === 'AVAILABLE'));
    const km = route.stops[2].distanceKm - route.stops[1].distanceKm;
    const paymentDb = new pg.Client({ connectionString: DATABASE_URL });
    await paymentDb.connect();
    try {
      for (const [outcome, expired, expected] of [
        ['FAILURE', false, 'FAILED'], ['SUCCESS', true, 'REVIEW'], ['SUCCESS', false, 'PAID'],
      ]) {
        const held = await hold([place]);
        assert.equal(held.status, 201);
        const { holdId } = await held.json();
        const base = '/public/holds/' + holdId;
        const post = (path, body) => request(path, undefined, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const checkout = await post(base + '/checkout', {
          passengers: [{ ...place, name: 'Khách thử', fareGroup: 'CHILD' }],
        });
        assert.equal(checkout.status, 201);
        const quote = await checkout.json();
        assert.equal(quote.amountVnd, km * 720);
        const { rows: [{ payment_reference: reference }] } = await paymentDb.query(
          'SELECT payment_reference FROM checkout_orders WHERE hold_id=$1', [holdId],
        );
        const wrongAmount = quote.amountVnd + 1;
        const callbackBody = { reference, amountVnd: wrongAmount, outcome };
        assert.equal((await post('/public/payments/sandbox/callback', callbackBody)).status, 401);
        const signature = createHmac('sha256', process.env.SHANRAIL_SANDBOX_SECRET)
          .update(`${reference}:${wrongAmount}:${outcome}`).digest('hex');
        assert.equal((await request('/public/payments/sandbox/callback', undefined, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signature },
          body: JSON.stringify(callbackBody),
        })).status, 400);
        if (expired) await paymentDb.query(
          "UPDATE trip_place_segments SET expires_at=now()-interval '1 minute' WHERE hold_id=$1", [holdId],
        );
        for (let attempt = 0; attempt < 2; attempt++) {
          const payment = await post(base + '/sandbox', { outcome });
          assert.equal(payment.status, 200);
          assert.deepEqual(await payment.json(), { status: expected });
        }
        const availability = await (await request(mapPath + new URLSearchParams({ from, to }))).json();
        assert.equal(availability[0].places[0].status, expected === 'PAID' ? 'SOLD' : 'AVAILABLE');
        const issued = await request(base + '/tickets');
        assert.equal(issued.status, expected === 'PAID' ? 200 : 404);
        if (expected === 'REVIEW') {
          const orders = await (await request('/admin/orders?' + new URLSearchParams({ id: reference, status: 'REVIEW' }), token)).json();
          assert.equal(orders.length, 1);
          const review = await request('/admin/orders/' + orders[0].id + '/review', token, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Ghi nhận thử nghiệm' }),
          });
          assert.equal(review.status, 200);
          assert.equal((await review.json()).reviewNote, 'Ghi nhận thử nghiệm');
        }
        if (expected === 'PAID') {
          const tickets = await issued.json();
          assert.equal(tickets.length, 1);
          const scan = (auth) => request('/inspection/tickets', auth, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: tickets[0].id }),
          });
          assert.equal((await scan(token)).status, 403);
          const scans = await Promise.all([scan(inspector), scan(inspector)]);
          assert.ok(scans.every((response) => response.status === 200));
          const results = await Promise.all(scans.map((response) => response.json()));
          assert.deepEqual(results.map(({ status }) => status).sort(), ['ALREADY_CHECKED', 'CHECKED']);
          assert.equal(results[0].inspectedAt, results[1].inspectedAt);

          assert.equal(tickets[0].passenger.name, 'Khách thử');
          assert.equal((await request('/public/holds/' + tickets[0].id + '/tickets')).status, 404);
          assert.deepEqual(await (await request(base + '/tickets')).json(), tickets);
          for (let retry = 0; retry < 2; retry++) {
            const email = await post(base + '/ticket-email', { email: 'customer@example.test' });
            assert.equal(email.status, 200);
            assert.deepEqual(await email.json(), { status: 'CAPTURED' });
          }
          const message = await readFile(join(process.env.SHANRAIL_TEST_MAILBOX, tickets[0].id + '.eml'), 'utf8');
          assert.match(message, /To: customer@example\.test/);
        }

      }
    } finally {
      await paymentDb.end();
    }


    assert.equal(matched.distanceKm, km);
    assert.deepEqual(matched.fares, [
      { kind: 'SEAT', amountVnd: km * 900 }, { kind: 'BERTH', amountVnd: km * 1500 },
    ]);
    assert.ok(!(await search(from, to, futureDay)).some((item) => item.id === trip.id));
    assert.ok(!(await search(to, from, followingDay)).some((item) => item.id === trip.id));

  }
}

async function openCoachStream(path, signal) {
  const response = await request(path, undefined, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  return async (status) => {
    for (;;) {
      const boundary = pending.indexOf('\n\n');
      if (boundary >= 0) {
        const lines = pending.slice(0, boundary).split('\n');
        pending = pending.slice(boundary + 2);
        const data = lines.find((line) => line.startsWith('data:'));
        if (data && lines.some((line) => line.trim() === 'event: coaches') &&
            JSON.parse(data.slice(5))[0].places[0].status === status) return;
      } else {
        const { value, done } = await reader.read();
        assert.ok(!done, 'SSE ended before expected seat state');
        pending += value.replaceAll('\r', '');
      }
    }
  };
}
