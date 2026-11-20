import { randomUUID } from 'node:crypto';
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Header,
  HttpCode, NotFoundException, Param, Post,
} from '@nestjs/common';
import { Database } from './database.js';
import { list, record, requiredText, unique, uuid } from './schedule-input.js';

@Controller('public')
export class PlaceHoldsController {
  constructor(private readonly db: Database) {}

  @Post('trips/:id/holds')
  @Header('Cache-Control', 'no-store')
  async hold(@Param('id') id: string, @Body() body: unknown) {
    const tripId = uuid(id, 'id');
    const input = record(body);
    const from = uuid(input.from, 'from');
    const to = uuid(input.to, 'to');
    if (from === to) throw new BadRequestException('Ga đi và ga đến phải khác nhau.');
    const places = list(input.places, 'places', 1, 6).map((item) => {
      const place = record(item);
      const number = place.coachNumber;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 30) {
        throw new BadRequestException('Số toa không hợp lệ.');
      }
      return { number, label: requiredText(place.label, 'label', 12) };
    });
    unique(places.map(({ number, label }) => number + ':' + label), 'place');

    return this.db.transaction(async (client) => {
      const locked = await client.query('SELECT id FROM trips WHERE id = $1 FOR UPDATE', [tripId]);
      if (!locked.rowCount) throw new NotFoundException('Không tìm thấy chuyến.');
      const { rows: [segment] } = await client.query<{ first: number; last: number; expiresAt: Date; serverNow: Date }>(`
        SELECT a.stop_order AS first, b.stop_order AS last,
          LEAST(a.departure_at, statement_timestamp() + interval '10 minutes') AS "expiresAt",
          statement_timestamp() AS "serverNow"
        FROM trips t
        JOIN trip_stops a ON a.trip_id = t.id AND a.station_id = $2
        JOIN trip_stops b ON b.trip_id = t.id AND b.station_id = $3 AND b.stop_order > a.stop_order
        WHERE t.id = $1 AND t.status = 'ON_SALE' AND a.departure_at > statement_timestamp()
      `, [tripId, from, to]);
      if (!segment) throw new NotFoundException('Chặng này không còn mở bán.');
      const numbers = places.map(({ number }) => number);
      const labels = places.map(({ label }) => label);
      const valid = await client.query(`
        SELECT 1 FROM unnest($2::int[], $3::text[]) AS p(number,label)
        JOIN trip_coaches c ON c.trip_id = $1 AND c.coach_number = p.number
        WHERE c.places @> jsonb_build_array(jsonb_build_object('label', p.label))
      `, [tripId, numbers, labels]);
      if (valid.rowCount !== places.length) throw new BadRequestException('Có chỗ không thuộc chuyến này.');
      await client.query(`
        DELETE FROM trip_place_segments WHERE trip_id = $1 AND state = 'HELD'
          AND expires_at <= statement_timestamp()
      `, [tripId]);

      const holdId = randomUUID();
      const inserted = await client.query(`
        INSERT INTO trip_place_segments
          (trip_id, coach_number, place_label, segment_order, state, expires_at, hold_id)
        SELECT $1, p.number, p.label, s.stop_order, 'HELD', $6, $7
        FROM unnest($2::int[], $3::text[]) AS p(number,label)
        CROSS JOIN trip_stops s
        WHERE s.trip_id = $1 AND s.stop_order >= $4 AND s.stop_order < $5
          AND $6::timestamptz > statement_timestamp()
        ON CONFLICT DO NOTHING
      `, [tripId, numbers, labels, segment.first, segment.last, segment.expiresAt, holdId]);
      if (inserted.rowCount !== places.length * (segment.last - segment.first)) {
        throw new ConflictException('Có chỗ không còn trống. Vui lòng chọn lại.');
      }
      return { holdId, expiresAt: segment.expiresAt, serverNow: segment.serverNow };
    });
  }

  @Delete('holds/:id')
  @HttpCode(204)
  async release(@Param('id') id: string) {
    await this.db.query(
      "DELETE FROM trip_place_segments WHERE hold_id = $1 AND state = 'HELD'",
      [uuid(id, 'id')],
    );
  }
}
