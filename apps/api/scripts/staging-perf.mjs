import assert from 'node:assert/strict';

const [base, trip, from, to, date] = process.argv.slice(2);
assert.ok(base && trip && from && to && date, 'Usage: node staging-perf.mjs BASE TRIP FROM TO YYYY-MM-DD');
const root = new URL('/rail-api/public/', base);
const segment = new URLSearchParams({ from, to });
const searchUrl = new URL('trips?' + new URLSearchParams({ from, to, date }), root);
const coachesUrl = new URL('trips/' + trip + '/coaches?' + segment, root);
const concurrency = 10;
const count = 100;

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, url.pathname + ' returned ' + response.status);
  return response.json();
}
assert.ok((await read(searchUrl)).some(({ id }) => id === trip), 'Trip must match the search');
const places = (await read(coachesUrl)).reduce((total, coach) => total + coach.places.length, 0);
assert.equal(places, 500, 'Create a fixture with precisely 500 seats or berths');
const report = {};
for (const [key, url] of Object.entries({ search: searchUrl, coaches: coachesUrl })) {
  const samples = [];
  for (let i = 0; i < count; i += concurrency) {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      const start = performance.now();
      await read(url);
      samples.push(performance.now() - start);
    }));
  }
  samples.sort((a, b) => a - b);
  report[key] = { p95Ms: Number(samples[Math.ceil(count * .95) - 1].toFixed(1)) };
}
console.log(JSON.stringify({ places, concurrency, requestsPerEndpoint: count, ...report }, null, 2));
assert.ok(Object.values(report).every(({ p95Ms }) => p95Ms < 500), 'One or more endpoints missed the p95 target');
