'use client';

import CoachMap from './coach-map';
import { useEffect, useState, type FormEvent } from 'react';

type Station = { id: string; code: string; name: string; city: string };
type Trip = {
  id: string;
  code: string;
  departureAt: string;
  arrivalAt: string;
  distanceKm: number;
  fares: { kind: 'SEAT' | 'BERTH'; amountVnd: number }[];
};

const time = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
});
const price = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/rail-api/public/' + path, { signal });
  if (!response.ok) throw new Error('Không tải được dữ liệu.');
  return response.json();
}

export default function TripSearch() {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [segment, setSegment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stationAttempt, setStationAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    get<Station[]>('stations', controller.signal).then(setStations).catch(() => {
      if (!controller.signal.aborted) setError('Không tải được danh sách ga.');
    });
    return () => controller.abort();
  }, [stationAttempt]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const from = String(fields.get('from'));
    const to = String(fields.get('to'));
    setTrips(null);
    if (from === to) {
      setError('Ga đi và ga đến phải khác nhau.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const query = new URLSearchParams({ from, to, date: String(fields.get('date')) });
      setTrips(await get<Trip[]>('trips?' + query));
      setSegment(new URLSearchParams({ from, to }).toString());
    } catch {
      setError('Không tải được chuyến tàu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="trip-search">
    <form onSubmit={search}>
      <fieldset disabled={loading || !stations?.length}>
        {(['from', 'to'] as const).map((field) => <label key={field}>
          {field === 'from' ? 'Ga đi' : 'Ga đến'}
          <select name={field} defaultValue="" required>
            <option value="" disabled>Chọn ga</option>
            {stations?.map((station) => <option key={station.id} value={station.id}>
              {station.name} ({station.code})
            </option>)}
          </select>
        </label>)}
        <label>Ngày lên tàu<input name="date" type="date" required /></label>
        <button type="submit">Tìm chuyến</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    {error && !stations && <button type="button" onClick={() => {
      setError('');
      setStationAttempt(stationAttempt + 1);
    }}>Tải lại danh sách ga</button>}
    {!stations && !error && <p role="status">Đang tải danh sách ga…</p>}
    {stations?.length === 0 && <p>Chưa có ga trong hệ thống.</p>}
    {loading && <p role="status">Đang tìm chuyến…</p>}
    {trips && <div aria-live="polite">
      <h2>Chuyến phù hợp</h2>
      {trips.length === 0 ? <p>Không có chuyến mở bán cho chặng và ngày đã chọn.</p> :
        <ul className="trip-results">{trips.map((trip) => <li key={trip.id}>
          <div><strong>{trip.code}</strong> · {trip.distanceKm} km
            <p>Đi {time.format(new Date(trip.departureAt))}<br />Đến {time.format(new Date(trip.arrivalAt))}</p>
          </div>
          <dl>{trip.fares.map((fare) => <div key={fare.kind}>
            <dt>{fare.kind === 'SEAT' ? 'Ghế ngồi' : 'Giường nằm'}</dt>
            <dd>{price.format(fare.amountVnd)}</dd>
          </div>)}</dl>
          <CoachMap path={`/rail-api/public/trips/${trip.id}/coaches?${segment}`} />
        </li>)}</ul>}
    </div>}
  </div>;
}
