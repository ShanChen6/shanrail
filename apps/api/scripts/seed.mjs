import pg from 'pg';
import { hashPassword } from '../dist/password.js';

const { DATABASE_URL, SHANRAIL_SEED_PASSWORD, NODE_ENV } = process.env;
if (NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
if (!DATABASE_URL || !SHANRAIL_SEED_PASSWORD || SHANRAIL_SEED_PASSWORD.length < 12 ||
    SHANRAIL_SEED_PASSWORD.length > 128) {
  throw new Error('Set DATABASE_URL and SHANRAIL_SEED_PASSWORD (12–128 characters)');
}

const stations = [
  ['HAN', 'Hà Nội', 'Hà Nội', 0],
  ['VIN', 'Vinh', 'Nghệ An', 319],
  ['DAN', 'Đà Nẵng', 'Đà Nẵng', 791],
  ['NTR', 'Nha Trang', 'Khánh Hòa', 1315],
  ['SGN', 'Sài Gòn', 'TP. Hồ Chí Minh', 1726],
];
const routes = [
  ['DEMO-NORTH-SOUTH', 'Hà Nội → Sài Gòn', stations],
  ['DEMO-SOUTH-NORTH', 'Sài Gòn → Hà Nội', [...stations].reverse().map(
    ([code, name, city, distance]) => [code, name, city, 1726 - distance],
  )],
];
const users = [
  ['customer@example.test', 'Khách mẫu', 'CUSTOMER'],
  ['admin@example.test', 'Quản trị mẫu', 'ADMIN'],
  ['inspector@example.test', 'Soát vé mẫu', 'INSPECTOR'],
];

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  for (const [code, name, city] of stations) {
    await client.query(`
      INSERT INTO stations (code, name, city) VALUES ($1, $2, $3)
      ON CONFLICT (code) DO NOTHING
    `, [code, name, city]);
  }
  for (const [code, name, stops] of routes) {
    const created = await client.query(`
      INSERT INTO routes (code, name) VALUES ($1, $2)
      ON CONFLICT (code) DO NOTHING RETURNING id
    `, [code, name]);
    const route = created.rows[0];
    if (!route) continue;
    for (const [order, [stationCode, , , distance]] of stops.entries()) {
      await client.query(`
        INSERT INTO route_stops (route_id, station_id, stop_order, distance_km)
        SELECT $1, id, $2, $3 FROM stations WHERE code = $4
      `, [route.id, order, distance, stationCode]);
    }
  }
  for (const [email, name, role] of users) {
    const hash = await hashPassword(SHANRAIL_SEED_PASSWORD);
    await client.query(`
      INSERT INTO users (email, display_name, role, password_hash) VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [email, name, role, hash]);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
