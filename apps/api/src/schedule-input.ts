import { BadRequestException } from '@nestjs/common';

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, field: string, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value.trim();
}

export function code(value: unknown) {
  const result = requiredText(value, 'code', 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(result)) throw new BadRequestException('Invalid code');
  return result;
}

export function uuid(value: unknown, field: string) {
  if (typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value.toLowerCase();
}

export function list(value: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new BadRequestException(`${field} must contain ${min}–${max} entries`);
  }
  return value;
}

export function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) throw new BadRequestException(`Duplicate ${field}`);
}

function time(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  const input = requiredText(value, field, 35);
  const parts = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:[0-5]\d)$/.exec(input);
  if (!parts) throw new BadRequestException(`${field} must include date, time and timezone`);
  const day = new Date(`${parts[1]}T00:00:00Z`);
  const timestamp = new Date(input);
  if (!Number.isFinite(+day) || !Number.isFinite(+timestamp) ||
      day.toISOString().slice(0, 10) !== parts[1] || parts[1].startsWith('0000')) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return timestamp;
}

export function parseSchedule(value: unknown) {
  const stops = list(value, 'stops', 2, 100).map((item) => {
    const stop = record(item);
    return {
      stationId: uuid(stop.stationId, 'stationId'),
      arrival: time(stop.arrivalAt, 'arrivalAt'),
      departure: time(stop.departureAt, 'departureAt'),
    };
  });
  let previousDeparture: Date | null = null;
  for (const [index, stop] of stops.entries()) {
    const first = index === 0;
    const last = index === stops.length - 1;
    if ((stop.arrival === null) !== first || (stop.departure === null) !== last ||
        (stop.arrival && stop.departure && stop.departure < stop.arrival) ||
        (stop.arrival && previousDeparture && stop.arrival <= previousDeparture)) {
      throw new BadRequestException(`Invalid arrival or departure at stop ${index + 1}`);
    }
    previousDeparture = stop.departure;
  }
  return stops;
}
