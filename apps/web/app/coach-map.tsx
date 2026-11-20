'use client';

import { useState } from 'react';

const labels = { AVAILABLE: 'Trống', HELD: 'Đang giữ', SOLD: 'Đã bán' };
type Place = { label: string; kind: 'SEAT' | 'BERTH'; status: keyof typeof labels };
type Coach = { number: number; name: string; places: Place[] };

export default function CoachMap({ path }: { path: string }) {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [selected, setSelected] = useState<number>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const coach = coaches.find(({ number }) => number === selected) ?? coaches[0];

  async function load() {
    setOpen(true);
    setLoading(true);
    setError(false);
    setCoaches([]);
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error('Coach map unavailable');
      setCoaches(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return <div className="coach-map">
    <button type="button" aria-expanded={open} disabled={loading}
      onClick={() => open ? setOpen(false) : void load()}>
      {open ? 'Ẩn sơ đồ toa' : 'Xem sơ đồ toa'}
    </button>
    {open && <div>
      {loading && <p role="status">Đang tải sơ đồ toa…</p>}
      {error && <p role="alert">Không tải được sơ đồ toa.</p>}
      {!loading && <button type="button" onClick={() => void load()}>Cập nhật trạng thái</button>}
      {coach && <>
        <label>Toa tàu
          <select value={coach.number} onChange={(event) => setSelected(Number(event.target.value))}>
            {coaches.map(({ number, name }) => <option key={number} value={number}>Toa {number} · {name}</option>)}
          </select>
        </label>
        <ul className="coach-places">
          {coach.places.map((place) => <li key={place.label} data-status={place.status}>
            <strong>{place.kind === 'SEAT' ? 'Ghế' : 'Giường'} {place.label}</strong>
            <span>{labels[place.status]}</span>
          </li>)}
        </ul>
      </>}
    </div>}
  </div>;
}
