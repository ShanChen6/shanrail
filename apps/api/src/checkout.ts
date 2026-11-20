import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, HttpCode,
  NotFoundException, Param, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { Database } from './database.js';
import { list, record, requiredText, unique, uuid } from './schedule-input.js';

type Order = {
  id: string; trip_id: string; hold_id: string; expires_at: Date; passengers: unknown[];
  amount_vnd: string; status: string; payment_reference: string; segment_count: number;
};

function summary(order: Order) {
  return { status: order.status, amountVnd: Number(order.amount_vnd), expiresAt: order.expires_at,
    passengers: order.passengers };
}

function sandboxSecret() {
  const secret = process.env.SHANRAIL_SANDBOX_SECRET;
  if (!secret || secret.length < 32) throw new NotFoundException('Sandbox chưa được bật.');
  return secret;
}

function signature(secret: string, reference: string, amount: number, outcome: string) {
  return createHmac('sha256', secret).update(`${reference}:${amount}:${outcome}`).digest('hex');
}

@Controller('public')
export class CheckoutController {
  constructor(private readonly db: Database) {}

  @Post('holds/:id/checkout')
  @Header('Cache-Control', 'no-store')
  async checkout(@Param('id') id: string, @Body() body: unknown) {
    sandboxSecret();
    const hold = uuid(id, 'hold');
    const input = list(record(body).passengers, 'passengers', 1, 6).map((entry) => {
      const passenger = record(entry);
      const coachNumber = passenger.coachNumber;
      if (typeof coachNumber !== 'number' || !Number.isInteger(coachNumber) || coachNumber < 1 || coachNumber > 30) {
        throw new BadRequestException('Số toa không hợp lệ.');
      }
      return { coachNumber, label: requiredText(passenger.label, 'label', 12),
        name: requiredText(passenger.name, 'name'), fareGroup: passenger.fareGroup };
    });
    unique(input.map(({ coachNumber, label }) => coachNumber + ':' + label), 'place');

    return this.db.transaction(async (client) => {
      const anchor = await client.query<{ trip_id: string }>(
        'SELECT trip_id FROM trip_place_segments WHERE hold_id=$1 LIMIT 1', [hold],
      );
      const trip = anchor.rows[0]?.trip_id;
      if (!trip) throw new NotFoundException('Không tìm thấy lượt giữ chỗ.');
      await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [trip]);
      const existing = await client.query<Order>('SELECT * FROM checkout_orders WHERE hold_id=$1', [hold]);
      if (existing.rows[0]) return summary(existing.rows[0]);

      const { rows } = await client.query<{
        coachNumber: number; label: string; amount: number; expiresAt: Date; segments: number;
      }>(`
        SELECT s.coach_number AS "coachNumber", s.place_label AS label,
          (max(b.distance_km) - min(a.distance_km)) *
            CASE p.place->>'kind' WHEN 'SEAT' THEN t.seat_vnd_per_km ELSE t.berth_vnd_per_km END AS amount,
          min(s.expires_at) AS "expiresAt", count(*)::int AS segments
        FROM trip_place_segments s
        JOIN trips t ON t.id=s.trip_id
        JOIN trip_coaches c ON c.trip_id=s.trip_id AND c.coach_number=s.coach_number
        CROSS JOIN LATERAL jsonb_array_elements(c.places) p(place)
        JOIN trip_stops a ON a.trip_id=s.trip_id AND a.stop_order=s.segment_order
        JOIN trip_stops b ON b.trip_id=s.trip_id AND b.stop_order=s.segment_order+1
        WHERE s.hold_id=$1 AND s.state='HELD' AND s.expires_at > statement_timestamp()
          AND p.place->>'label'=s.place_label
        GROUP BY s.coach_number, s.place_label, p.place, t.seat_vnd_per_km, t.berth_vnd_per_km
      `, [hold]);
      if (!rows.length) throw new ConflictException('Lượt giữ chỗ đã hết hạn.');
      if (rows.length !== input.length) throw new BadRequestException('Cần thông tin cho mỗi chỗ đã giữ.');
      const childDiscount = Number(process.env.SHANRAIL_CHILD_DISCOUNT_PERCENT ?? '20');
      if (!Number.isInteger(childDiscount) || childDiscount < 0 || childDiscount > 99) {
        throw new Error('Invalid SHANRAIL_CHILD_DISCOUNT_PERCENT');
      }
      const passengers = rows.map((row) => {
        const passenger = input.find(({ coachNumber, label }) => coachNumber === row.coachNumber && label === row.label);
        if (!passenger || (passenger.fareGroup !== 'ADULT' && passenger.fareGroup !== 'CHILD')) {
          throw new BadRequestException('Hành khách hoặc nhóm giá không hợp lệ.');
        }
        const discount = passenger.fareGroup === 'CHILD' ? childDiscount : 0;
        return { ...passenger, baseAmountVnd: row.amount, discountPercent: discount,
          amountVnd: Math.max(1, Math.round(row.amount * (100 - discount) / 100)) };
      });
      const { rows: [order] } = await client.query<Order>(`
        INSERT INTO checkout_orders (hold_id,trip_id,expires_at,passengers,segment_count,amount_vnd)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [hold, trip, rows[0].expiresAt, JSON.stringify(passengers),
        rows.reduce((sum, row) => sum + row.segments, 0), passengers.reduce((sum, p) => sum + p.amountVnd, 0)]);
      return summary(order);
    });
  }

  @Get('holds/:id/checkout')
  @Header('Cache-Control', 'no-store')
  async status(@Param('id') id: string) {
    const hold = uuid(id, 'hold');
    const { rows: [order] } = await this.db.query<Order>('SELECT * FROM checkout_orders WHERE hold_id=$1', [hold]);
    if (order) return summary(order);
    const { rows } = await this.db.query(`
      SELECT DISTINCT coach_number AS "coachNumber", place_label AS label
      FROM trip_place_segments WHERE hold_id=$1 AND state='HELD' AND expires_at>now()
      ORDER BY coach_number, place_label
    `, [hold]);
    if (!rows.length) throw new NotFoundException();
    return { status: 'DETAILS', passengers: rows };
  }

  @Post('holds/:id/sandbox')
  @HttpCode(200)
  async simulate(@Param('id') id: string, @Body() body: unknown) {
    const secret = sandboxSecret();
    const { rows: [order] } = await this.db.query<Order>('SELECT * FROM checkout_orders WHERE hold_id=$1', [uuid(id, 'hold')]);
    if (!order) throw new NotFoundException();
    const outcome = record(body).outcome;
    if (outcome !== 'SUCCESS' && outcome !== 'FAILURE') throw new BadRequestException();
    const amountVnd = Number(order.amount_vnd);
    return this.applyCallback(order.payment_reference, amountVnd, outcome,
      signature(secret, order.payment_reference, amountVnd, outcome));
  }

  @Post('payments/sandbox/callback')
  @HttpCode(200)
  callback(@Body() body: unknown, @Req() request: { headers: Record<string, unknown> }) {
    const payload = record(body);
    if (typeof payload.amountVnd !== 'number' || !Number.isSafeInteger(payload.amountVnd) || payload.amountVnd <= 0 ||
        (payload.outcome !== 'SUCCESS' && payload.outcome !== 'FAILURE')) throw new BadRequestException();
    return this.applyCallback(uuid(payload.reference, 'reference'), payload.amountVnd,
      payload.outcome, request.headers['x-sandbox-signature']);
  }

  private async applyCallback(reference: string, amount: number, outcome: string, supplied: unknown) {
    const expected = signature(sandboxSecret(), reference, amount, outcome);
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) {
      throw new UnauthorizedException();
    }
    return this.db.transaction(async (client) => {
      const anchor = await client.query<Order>('SELECT * FROM checkout_orders WHERE payment_reference=$1', [reference]);
      if (!anchor.rows[0]) throw new NotFoundException();
      await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [anchor.rows[0].trip_id]);
      const { rows: [order] } = await client.query<Order>(
        'SELECT * FROM checkout_orders WHERE payment_reference=$1 FOR UPDATE', [reference]);
      if (Number(order.amount_vnd) !== amount) throw new BadRequestException('Sai số tiền giao dịch.');
      if (order.status === 'PAID' || order.status === 'REVIEW' ||
          (order.status === 'FAILED' && outcome === 'FAILURE')) return { status: order.status };
      const active = await client.query(`
        SELECT 1 FROM trip_place_segments WHERE hold_id=$1 AND state='HELD'
          AND expires_at>statement_timestamp() FOR UPDATE
      `, [order.hold_id]);
      let status = 'FAILED';
      if (outcome === 'SUCCESS') {
        status = 'REVIEW';
        if (order.status === 'PENDING' && active.rowCount === order.segment_count) {
          const changed = await client.query(`
            UPDATE trip_place_segments SET state='SOLD', expires_at=NULL
            WHERE hold_id=$1 AND state='HELD' AND expires_at>statement_timestamp()
          `, [order.hold_id]);
          if (changed.rowCount === order.segment_count) status = 'PAID';
          else if (changed.rowCount) throw new ConflictException('Lượt giữ thay đổi, hãy gửi lại callback.');
        }
      }
      if (status !== 'PAID') {
        await client.query("DELETE FROM trip_place_segments WHERE hold_id=$1 AND state='HELD'", [order.hold_id]);
      }
      await client.query('UPDATE checkout_orders SET status=$2 WHERE id=$1', [order.id, status]);
      if (status === 'PAID') {
        await client.query(`
          INSERT INTO tickets (order_id, passenger_index)
          SELECT id, p.position::integer FROM checkout_orders
          CROSS JOIN LATERAL jsonb_array_elements(passengers) WITH ORDINALITY p(passenger, position)
          WHERE id=$1 ON CONFLICT (order_id, passenger_index) DO NOTHING
        `, [order.id]);
      }
      return { status };
    });
  }
}
