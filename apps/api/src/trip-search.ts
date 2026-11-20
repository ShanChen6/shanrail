import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Database } from './database.js';
import { uuid } from './schedule-input.js';

@Controller('public')
export class TripSearchController {
  constructor(private readonly db: Database) {}

  @Get('stations')
  async stations() {
    return (await this.db.query('SELECT id, code, name, city FROM stations ORDER BY name, code')).rows;
  }

  @Get('trips')
  async search(@Query('from') from: unknown, @Query('to') to: unknown, @Query('date') date: unknown) {
    const origin = uuid(from, 'from');
    const destination = uuid(to, 'to');
    if (origin === destination) throw new BadRequestException('Ga đi và ga đến phải khác nhau.');
    if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Ngày lên tàu không hợp lệ.');
    }
    const day = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Ngày lên tàu không hợp lệ.');
    }
    return (await this.db.query(`
      SELECT t.id, t.code, origin.departure_at AS "departureAt", destination.arrival_at AS "arrivalAt",
             destination.distance_km - origin.distance_km AS "distanceKm", fares.items AS fares
      FROM trip_stops origin
      JOIN trip_stops destination ON destination.trip_id = origin.trip_id
        AND destination.stop_order > origin.stop_order
      JOIN trips t ON t.id = origin.trip_id
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('kind', kind, 'amountVnd',
          (destination.distance_km - origin.distance_km) *
          CASE kind WHEN 'SEAT' THEN t.seat_vnd_per_km ELSE t.berth_vnd_per_km END
        ) ORDER BY kind DESC) AS items
        FROM (
          SELECT DISTINCT place->>'kind' AS kind
          FROM trip_coaches c CROSS JOIN LATERAL jsonb_array_elements(c.places) AS layout(place)
          WHERE c.trip_id = t.id AND place->>'kind' IN ('SEAT', 'BERTH')
        ) kinds
      ) fares
      WHERE origin.station_id = $1 AND destination.station_id = $2
        AND t.status = 'ON_SALE'
        AND origin.departure_at > now()
        AND origin.departure_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND origin.departure_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND fares.items IS NOT NULL
      ORDER BY origin.departure_at, t.id
    `, [origin, destination, date])).rows;
  }
}
