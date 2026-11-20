'use client';

import { useEffect, useState } from 'react';

const labels = { AVAILABLE: 'Trống', HELD: 'Đang giữ', SOLD: 'Đã bán' };
type Place = { label: string; kind: 'SEAT' | 'BERTH'; status: keyof typeof labels };
type Pick = { coachNumber: number; label: string };
type Hold = { holdId: string; deadline: number };
type Coach = { number: number; name: string; places: Place[] };

export default function CoachMap({ path }: { path: string }) {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [selected, setSelected] = useState<number>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const storageKey = 'shanrail:hold:' + path;
  const [pathname, query] = path.split('?');

  useEffect(() => {
    if (!hold) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((hold.deadline - Date.now()) / 1000));
      setRemaining(seconds);
    }, 250);
    return () => window.clearInterval(timer);
  }, [hold]);

  function clearHold() {
    sessionStorage.removeItem(storageKey);
    setHold(null);
    setPicks([]);
  }

  async function reserve() {
    setBusy(true);
    setNotice('');
    try {
      const params = new URLSearchParams(query);
      const response = await fetch(pathname.replace(/coaches$/, 'holds'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: params.get('from'), to: params.get('to'), places: picks }),
      });
      if (response.status === 409) {
        setPicks([]);
        await load();
        setNotice('Có chỗ vừa được giữ. Vui lòng chọn lại.');
        return;
      }
      if (!response.ok) throw new Error('Hold failed');
      const result = await response.json();
      const duration = Date.parse(result.expiresAt) - Date.parse(result.serverNow);
      const current = { holdId: result.holdId, deadline: Date.now() + duration };
      setRemaining(Math.ceil(duration / 1000));
      setHold(current);
      sessionStorage.setItem(storageKey, JSON.stringify(current));
      await load();
    } catch {
      setNotice('Không thể giữ chỗ. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!hold) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/rail-api/public/holds/' + hold.holdId, { method: 'DELETE' });
      if (!response.ok) throw new Error('Release failed');
      clearHold();
      await load();
    } catch {
      setNotice('Không thể hủy giữ chỗ. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  function openMap() {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const current = JSON.parse(saved) as Hold;
      setHold(current);
      setRemaining(Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)));
    }
    void load();
  }

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
    <button type="button" aria-expanded={open} disabled={loading || busy}
      onClick={() => open ? setOpen(false) : openMap()}>
      {open ? 'Ẩn sơ đồ toa' : 'Xem sơ đồ toa'}
    </button>
    {open && <div>
      {loading && <p role="status">Đang tải sơ đồ toa…</p>}
      {error && <p role="alert">Không tải được sơ đồ toa.</p>}
      {notice && <p role="alert">{notice}</p>}
      {hold && <div>
        <p>{remaining > 0 ? `Giữ chỗ còn ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Đã hết thời gian giữ chỗ.'}</p>
        <button type="button" disabled={busy} onClick={() => void release()}>
          {remaining > 0 ? 'Hủy giữ chỗ' : 'Chọn lại chỗ'}
        </button>
      </div>}
      {!loading && !busy && <button type="button" onClick={() => {
        setPicks([]);
        void load();
      }}>Cập nhật trạng thái</button>}
      {coach && <>
        <label>Toa tàu
          <select value={coach.number} onChange={(event) => setSelected(Number(event.target.value))}>
            {coaches.map(({ number, name }) => <option key={number} value={number}>Toa {number} · {name}</option>)}
          </select>
        </label>
        <ul className="coach-places">
          {coach.places.map((place) => {
            const chosen = picks.some((pick) => pick.coachNumber === coach.number && pick.label === place.label);
            return <li key={place.label} data-status={place.status}>
              <button type="button" aria-pressed={chosen}
                disabled={busy || !!hold || place.status !== 'AVAILABLE' || (!chosen && picks.length >= 6)}
                onClick={() => setPicks((current) => chosen
                  ? current.filter((pick) => pick.coachNumber !== coach.number || pick.label !== place.label)
                  : [...current, { coachNumber: coach.number, label: place.label }])}>
                <strong>{place.kind === 'SEAT' ? 'Ghế' : 'Giường'} {place.label}</strong>
                <span>{labels[place.status]}</span>
              </button>
            </li>;
          })}
        </ul>
        {!hold && <button type="button" disabled={busy || !picks.length} onClick={() => void reserve()}>
          Giữ {picks.length} chỗ
        </button>}
      </>}
    </div>}
  </div>;
}
