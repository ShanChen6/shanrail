import 'reflect-metadata';
import {
  Controller, Get, Injectable, Module, ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';

@Injectable()
class Database implements OnApplicationShutdown {
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

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Controller('health')
class HealthController {
  constructor(private readonly database: Database) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}

@Module({ controllers: [HealthController], providers: [Database] })
class AppModule {}

async function bootstrap() {
  const port = Number(process.env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
}

void bootstrap();
