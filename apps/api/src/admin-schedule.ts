import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable,
  NotFoundException, Param, Post, Put, UseGuards,
} from '@nestjs/common';
import { RoleGuard, Roles, SessionGuard } from './auth.js';
import { Database } from './database.js';
import { code, list, parseSchedule, record, requiredText, unique, uuid } from './schedule-input.js';

type IdRow = { id: string };
type RouteStop = { stationId: string; distanceKm: number };
type Coach = { id: string; name: string; places: unknown[] };

async function catalogWrite<Result>(operation: Promise<Result>) {
  try {
    return await operation;
  } catch (error) {
    const sqlState = (error as { code?: string }).code;
    if (sqlState === '23505') throw new ConflictException('Code already exists');
    if (sqlState === '23503') throw new BadRequestException('Referenced catalog entry does not exist');
    throw error;
  }
}

@Injectable()
export class AdminSchedule {
  constructor(private readonly db: Database) {}

  async stations() {
    return (await this.db.query('SELECT id, code, name, city FROM stations ORDER BY code')).rows;
  }

  async routes() {
    return (await this.db.query(`
      SELECT r.id, r.code, r.name, COALESCE((
        SELECT jsonb_agg(jsonb_build_object('stationId', s.station_id, 'distanceKm', s.distance_km)
                         ORDER BY s.stop_order)
        FROM route_stops s WHERE s.route_id = r.id
      ), '[]'::jsonb) AS stops
      FROM routes r ORDER BY r.code
    `)).rows;
  }

  async coaches() {
    return (await this.db.query('SELECT id, code, name, places FROM coach_templates ORDER BY code')).rows;
  }

  async saveStation(value: unknown, id?: string) {
    const input = record(value);
    const fields = [code(input.code), requiredText(input.name, 'name'), requiredText(input.city, 'city')];
    const result = await catalogWrite(id
      ? this.db.query<IdRow>('UPDATE stations SET code=$1, name=$2, city=$3 WHERE id=$4 RETURNING id', [...fields, id])
      : this.db.query<IdRow>('INSERT INTO stations (code,name,city) VALUES ($1,$2,$3) RETURNING id', fields));
    if (!result.rows[0]) throw new NotFoundException('Station does not exist');
    return result.rows[0];
  }

  async saveRoute(value: unknown, id?: string) {
    const input = record(value);
    const fields = [code(input.code), requiredText(input.name, 'name')];
    const stops = list(input.stops, 'stops', 2, 100).map((item, index) => {
      const stop = record(item);
      const km = stop.distanceKm;
      if (typeof km !== 'number' || !Number.isInteger(km) || km < 0 || km > 100_000 ||
          (index === 0 && km !== 0)) throw new BadRequestException('Invalid distanceKm');
      return { stationId: uuid(stop.stationId, 'stationId'), km };
    });
    unique(stops.map((stop) => stop.stationId), 'station');
    if (stops.some((stop, index) => index > 0 && stop.km <= stops[index - 1].km)) {
      throw new BadRequestException('Distances must increase along the route');
    }
    return catalogWrite(this.db.transaction(async (client) => {
      const result = id
        ? await client.query<IdRow>('UPDATE routes SET code=$1, name=$2 WHERE id=$3 RETURNING id', [...fields, id])
        : await client.query<IdRow>('INSERT INTO routes (code,name) VALUES ($1,$2) RETURNING id', fields);
      const route = result.rows[0];
      if (!route) throw new NotFoundException('Route does not exist');
      if (id) await client.query('DELETE FROM route_stops WHERE route_id=$1', [id]);
      await client.query(`
        INSERT INTO route_stops (route_id, station_id, stop_order, distance_km)
        SELECT $1, station_id, (ordinality - 1)::integer, distance_km
        FROM unnest($2::uuid[], $3::int[]) WITH ORDINALITY AS s(station_id, distance_km, ordinality)
      `, [route.id, stops.map((stop) => stop.stationId), stops.map((stop) => stop.km)]);
      return route;
    }));
  }

  async saveCoach(value: unknown, id?: string) {
    const input = record(value);
    const places = list(input.places, 'places', 1, 150).map((item) => {
      const place = record(item);
      if (place.kind !== 'SEAT' && place.kind !== 'BERTH') throw new BadRequestException('Invalid place kind');
      return { label: requiredText(place.label, 'label', 12).toUpperCase(), kind: place.kind };
    });
    unique(places.map((place) => place.label), 'place label');
    const fields = [code(input.code), requiredText(input.name, 'name'), JSON.stringify(places)];
    const result = await catalogWrite(id
      ? this.db.query<IdRow>('UPDATE coach_templates SET code=$1, name=$2, places=$3 WHERE id=$4 RETURNING id',
        [...fields, id])
      : this.db.query<IdRow>('INSERT INTO coach_templates (code,name,places) VALUES ($1,$2,$3) RETURNING id', fields));
    if (!result.rows[0]) throw new NotFoundException('Coach template does not exist');
    return result.rows[0];
  }

  async trips() {
    return (await this.db.query(`
      SELECT id, code, route_id AS "routeId", departure_at AS "departureAt",
             status, published_at AS "publishedAt"
      FROM trips ORDER BY departure_at DESC, id LIMIT 100
    `)).rows;
  }

  async trip(id: string) {
    const { rows } = await this.db.query(`
      SELECT t.id, t.code, t.route_id AS "routeId", t.departure_at AS "departureAt",
             t.status, t.published_at AS "publishedAt",
             (SELECT jsonb_agg(jsonb_build_object('stationId', s.station_id, 'distanceKm', s.distance_km,
                   'arrivalAt', s.arrival_at, 'departureAt', s.departure_at) ORDER BY s.stop_order)
              FROM trip_stops s WHERE s.trip_id=t.id) AS stops,
             (SELECT jsonb_agg(jsonb_build_object('number', c.coach_number, 'templateId', c.template_id,
                   'name', c.name, 'places', c.places) ORDER BY c.coach_number)
              FROM trip_coaches c WHERE c.trip_id=t.id) AS coaches
      FROM trips t WHERE t.id=$1
    `, [id]);
    if (!rows[0]) throw new NotFoundException('Trip does not exist');
    return rows[0];
  }

  async createTrip(value: unknown) {
    const input = record(value);
    const tripCode = code(input.code);
    const routeId = uuid(input.routeId, 'routeId');
    const schedule = parseSchedule(input.stops);
    const templateIds = list(input.coachTemplateIds, 'coachTemplateIds', 1, 30)
      .map((item) => uuid(item, 'coachTemplateId'));
    return catalogWrite(this.db.transaction(async (client) => {
      const route = await client.query<IdRow>('SELECT id FROM routes WHERE id=$1 FOR SHARE', [routeId]);
      if (!route.rows[0]) throw new BadRequestException('Route does not exist');
      const { rows: routeStops } = await client.query<RouteStop>(`
        SELECT station_id AS "stationId", distance_km AS "distanceKm"
        FROM route_stops WHERE route_id=$1 ORDER BY stop_order
      `, [routeId]);
      if (schedule.length !== routeStops.length ||
          schedule.some((stop, index) => stop.stationId !== routeStops[index].stationId)) {
        throw new BadRequestException('Schedule must match the ordered stations of the route');
      }
      const { rows: coaches } = await client.query<Coach>(
        'SELECT id, name, places FROM coach_templates WHERE id=ANY($1::uuid[])', [templateIds],
      );
      const coachesById = new Map(coaches.map((coach) => [coach.id, coach]));
      if (templateIds.some((id) => !coachesById.has(id))) {
        throw new BadRequestException('Coach template does not exist');
      }
      const { rows: [trip] } = await client.query<IdRow>(
        'INSERT INTO trips (code,route_id,departure_at) VALUES ($1,$2,$3) RETURNING id',
        [tripCode, routeId, schedule[0].departure],
      );
      await client.query(`
        INSERT INTO trip_stops (trip_id, station_id, stop_order, distance_km, arrival_at, departure_at)
        SELECT $1, station_id, (ordinality - 1)::integer, distance_km, arrival_at, departure_at
        FROM unnest($2::uuid[], $3::int[], $4::timestamptz[], $5::timestamptz[]) WITH ORDINALITY
          AS s(station_id, distance_km, arrival_at, departure_at, ordinality)
      `, [trip.id, schedule.map((stop) => stop.stationId), routeStops.map((stop) => stop.distanceKm),
        schedule.map((stop) => stop.arrival), schedule.map((stop) => stop.departure)]);
      await client.query(`
        INSERT INTO trip_coaches (trip_id, coach_number, template_id, name, places)
        SELECT $1, ordinality::integer, template_id, name, places
        FROM unnest($2::uuid[], $3::text[], $4::jsonb[]) WITH ORDINALITY
          AS c(template_id, name, places, ordinality)
      `, [trip.id, templateIds, templateIds.map((id) => coachesById.get(id)!.name),
        templateIds.map((id) => JSON.stringify(coachesById.get(id)!.places))]);
      return trip;
    }));
  }

  async publish(id: string) {
    return this.db.transaction(async (client) => {
      const { rows: [trip] } = await client.query<{ status: string }>(
        'SELECT status FROM trips WHERE id=$1 FOR UPDATE', [id],
      );
      if (!trip) throw new NotFoundException('Trip does not exist');
      if (trip.status === 'DRAFT') {
        const updated = await client.query(`
          UPDATE trips SET status='ON_SALE', published_at=clock_timestamp()
          WHERE id=$1 AND departure_at > clock_timestamp()
        `, [id]);
        if (!updated.rowCount) throw new ConflictException('Trip has already departed');
      }
      return { id, status: 'ON_SALE' };
    });
  }
}

@Controller('admin')
@UseGuards(SessionGuard, RoleGuard)
@Roles('ADMIN')
export class AdminScheduleController {
  constructor(private readonly schedule: AdminSchedule) {}

  @Get('stations') stations() { return this.schedule.stations(); }
  @Post('stations') createStation(@Body() body: unknown) { return this.schedule.saveStation(body); }
  @Put('stations/:id') updateStation(@Param('id') id: string, @Body() body: unknown) {
    return this.schedule.saveStation(body, uuid(id, 'id'));
  }

  @Get('routes') routes() { return this.schedule.routes(); }
  @Post('routes') createRoute(@Body() body: unknown) { return this.schedule.saveRoute(body); }
  @Put('routes/:id') updateRoute(@Param('id') id: string, @Body() body: unknown) {
    return this.schedule.saveRoute(body, uuid(id, 'id'));
  }

  @Get('coach-templates') coaches() { return this.schedule.coaches(); }
  @Post('coach-templates') createCoach(@Body() body: unknown) { return this.schedule.saveCoach(body); }
  @Put('coach-templates/:id') updateCoach(@Param('id') id: string, @Body() body: unknown) {
    return this.schedule.saveCoach(body, uuid(id, 'id'));
  }

  @Get('trips') trips() { return this.schedule.trips(); }
  @Get('trips/:id') trip(@Param('id') id: string) { return this.schedule.trip(uuid(id, 'id')); }
  @Post('trips') createTrip(@Body() body: unknown) { return this.schedule.createTrip(body); }
  @Post('trips/:id/publish') publish(@Param('id') id: string) {
    return this.schedule.publish(uuid(id, 'id'));
  }
}
