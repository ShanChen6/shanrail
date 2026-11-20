import { exhaustMap, distinctUntilChanged, map, merge, timer } from 'rxjs';
import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Query, Sse } from '@nestjs/common';
import { Database } from './database.js';
import { uuid } from './schedule-input.js';

@Controller('public')
export class TripSearchController {
  constructor(private readonly db: Database) {}

  @Get('stations')
  async stations() {
    return (await this.db.query('SELECT id, code, name, city FROM stations ORDER BY name, code')).rows;
  }

  @Get('trips/:id/coaches')
  @Header('Cache-Control', 'no-store')
  async coaches(@Param('id') id: string, @Query('from') from: unknown, @Query('to') to: unknown) {
    const tripId = uuid(id, 'id');
    const origin = uuid(from, 'from');
    const destination = uuid(to, 'to');
    if (origin === destination) throw new BadRequestException('Ga đi và ga đến phải khác nhau.');
    const { rows } = await this.db.query(`
      SELECT c.coach_number AS number, c.name, jsonb_agg(
        layout.place || jsonb_build_object('status', COALESCE(occupied.state, 'AVAILABLE'))
        ORDER BY layout.position
      ) AS places
      FROM trips t
      JOIN trip_stops a ON a.trip_id = t.id AND a.station_id = $2
      JOIN trip_stops b ON b.trip_id = t.id AND b.station_id = $3 AND b.stop_order > a.stop_order
      JOIN trip_coaches c ON c.trip_id = t.id
      CROSS JOIN LATERAL jsonb_array_elements(c.places) WITH ORDINALITY AS layout(place, position)
      LEFT JOIN LATERAL (
        SELECT s.state
        FROM trip_place_segments s
        WHERE s.trip_id = c.trip_id AND s.coach_number = c.coach_number
          AND s.place_label = layout.place->>'label'
          AND s.segment_order >= a.stop_order AND s.segment_order < b.stop_order
          AND (s.state = 'SOLD' OR s.expires_at > now())
        ORDER BY (s.state = 'SOLD') DESC
        LIMIT 1
      ) occupied ON true
      WHERE t.id = $1 AND t.status = 'ON_SALE' AND a.departure_at > now()
      GROUP BY c.coach_number, c.name
      ORDER BY c.coach_number
    `, [tripId, origin, destination]);
    if (!rows.length) throw new NotFoundException('Không tìm thấy sơ đồ toa cho chặng này.');
    return rows;
  }

  @Sse('trips/:id/coaches/events')
  @Header('X-Accel-Buffering', 'no')
  async coachEvents(@Param('id') id: string, @Query('from') from: unknown, @Query('to') to: unknown) {
    const initial = await this.coaches(id, from, to);
    const changes = timer(0, 1000).pipe(
      exhaustMap((tick) => tick === 0 ? Promise.resolve(initial) : this.coaches(id, from, to)),
      map((coaches) => JSON.stringify(coaches)),
      distinctUntilChanged(),
      map((payload) => ({ type: 'coaches', data: payload })),
    );
    const heartbeat = timer(15000, 15000).pipe(map(() => ({ type: 'heartbeat', data: 'ok' })));
    return merge(changes, heartbeat);
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
