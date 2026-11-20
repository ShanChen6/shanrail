import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException, Body, Controller, Get, Header, HttpCode, NotFoundException,
  Param, Post, ServiceUnavailableException,
} from '@nestjs/common';
import { Database } from './database.js';
import { record, requiredText, uuid } from './schedule-input.js';

type Ticket = {
  id: string; tripCode: string; from: string; to: string; departureAt: Date; arrivalAt: Date;
  passenger: { name: string; coachNumber: number; label: string; amountVnd: number };
};

@Controller('public/holds/:id')
export class TicketsController {
  constructor(private readonly db: Database) {}

  @Get('tickets')
  @Header('Cache-Control', 'no-store')
  async tickets(@Param('id') id: string) {
    const { rows } = await this.db.query<Ticket>(`
      SELECT k.id, t.code AS "tripCode", origin.name AS "from", destination.name AS "to",
        a.departure_at AS "departureAt", b.arrival_at AS "arrivalAt",
        o.passengers->(k.passenger_index-1) AS passenger
      FROM checkout_orders o
      JOIN tickets k ON k.order_id=o.id
      JOIN trips t ON t.id=o.trip_id
      JOIN LATERAL (
        SELECT min(segment_order) AS first, max(segment_order)+1 AS last
        FROM trip_place_segments WHERE hold_id=o.hold_id AND state='SOLD'
      ) segment ON true
      JOIN trip_stops a ON a.trip_id=t.id AND a.stop_order=segment.first
      JOIN trip_stops b ON b.trip_id=t.id AND b.stop_order=segment.last
      JOIN stations origin ON origin.id=a.station_id
      JOIN stations destination ON destination.id=b.station_id
      WHERE o.hold_id=$1 AND o.status='PAID' ORDER BY k.passenger_index
    `, [uuid(id, 'hold')]);
    if (!rows.length) throw new NotFoundException('Không tìm thấy vé.');
    return rows;
  }

  @Post('ticket-email')
  @HttpCode(200)
  async email(@Param('id') id: string, @Body() body: unknown) {
    const directory = process.env.SHANRAIL_TEST_MAILBOX;
    if (!directory) throw new ServiceUnavailableException('Hộp thư thử nghiệm chưa được bật.');
    const email = requiredText(record(body).email, 'email', 254);
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      throw new BadRequestException('Email không hợp lệ.');
    }
    const tickets = await this.tickets(id);
    const lines = tickets.map(({ id, tripCode, from, to, departureAt, passenger }) =>
      `${tripCode} | ${from} - ${to} | ${departureAt.toISOString()} | ${passenger.name} | Toa ${passenger.coachNumber}, chỗ ${passenger.label} | Mã vé ${id}`);
    const message = [
      'From: Shanrail Sandbox <tickets@shanrail.test>', 'To: ' + email, 'Subject: Shanrail sandbox tickets',
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
      '', Buffer.from(lines.join('\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '', '',
    ].join('\r\n');
    const finalPath = join(directory, tickets[0].id + '.eml');
    const temporary = finalPath + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, message, { flag: 'wx', mode: 0o600 });
      await rename(temporary, finalPath);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new ServiceUnavailableException('Ghi thư thử nghiệm thất bại. Có thể gửi lại.');
    }
    return { status: 'CAPTURED' };
  }
}
