import 'reflect-metadata';
import {
  Controller, Get, Module, ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database.js';
import { TripSearchController } from './trip-search.js';
import { PlaceHoldsController } from './place-holds.js';
import { CheckoutController } from './checkout.js';
import { TicketsController } from './tickets.js';
import { InspectionController, OrderOperationsController } from './operations.js';
import { AdminSchedule, AdminScheduleController } from './admin-schedule.js';
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

@Module({
  controllers: [HealthController, AuthController, AuthorizationController, AdminScheduleController, TripSearchController, PlaceHoldsController, CheckoutController, TicketsController, InspectionController, OrderOperationsController],
  providers: [Database, SessionGuard, RoleGuard, AdminSchedule],
})
class AppModule {}

async function bootstrap() {
  const port = Number(process.env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  const app = await NestFactory.create(AppModule);
  if (process.env.SHANRAIL_REQUEST_LOG === '1') {
    app.use((req: { method: string; route?: { path: string } }, res: {
      statusCode: number; once(event: string, listener: () => void): void;
    }, next: () => void) => {
      const started = performance.now();
      res.once('finish', () => console.log(JSON.stringify({
        method: req.method, route: req.route?.path ?? 'unmatched', status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      })));
      next();
    });
  }
  app.enableShutdownHooks();
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
}

void bootstrap();
