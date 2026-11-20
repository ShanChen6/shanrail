import 'reflect-metadata';
import {
  Controller, Get, Module, ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database.js';
import { AuthController, RoleGuard, SessionGuard, AuthorizationController } from './auth.js';

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

@Module({ controllers: [HealthController, AuthController, AuthorizationController], providers: [Database, SessionGuard, RoleGuard] })
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
