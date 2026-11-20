import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly pool: pg.Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const { protocol, hostname, pathname } = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(protocol) || !hostname || pathname.length < 2) {
      throw new Error('DATABASE_URL must be a PostgreSQL connection URL with a database name');
    }
    this.pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1500, query_timeout: 1500 });
    this.pool.on('error', () => console.error('Idle PostgreSQL connection closed unexpectedly'));
  }

  query<Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.pool.query<Row>(sql, values);
  }

  async transaction<Result>(work: (client: pg.PoolClient) => Promise<Result>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
