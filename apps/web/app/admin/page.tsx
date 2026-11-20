'use client';

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from 'react';
import './panel.css';

type Item = { id: string; code: string; name: string };
type Station = Item & { city: string };
type Route = Item & { stops: { stationId: string; distanceKm: number }[] };
type Coach = Item & { places: { label: string; kind: 'SEAT' | 'BERTH' }[] };
type Trip = { id: string; code: string; departureAt: string; status: 'DRAFT' | 'ON_SALE' };
type Data = { stations: Station[]; routes: Route[]; coaches: Coach[]; trips: Trip[] };
type Login = { token: string; account: { role: string } };
type Tab = 'trips' | 'stations' | 'routes' | 'coach-templates';

const tabs: { id: Tab; label: string }[] = [
  { id: 'trips', label: 'Chuyến tàu' },
  { id: 'stations', label: 'Ga' },
  { id: 'routes', label: 'Tuyến' },
  { id: 'coach-templates', label: 'Mẫu toa' },
];
const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
});

async function request<T>(path: string, token = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/rail-api' + path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `Yêu cầu thất bại (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

async function load(token: string): Promise<Data> {
  const [stations, routes, coaches, trips] = await Promise.all([
    request<Station[]>('/admin/stations', token), request<Route[]>('/admin/routes', token),
    request<Coach[]>('/admin/coach-templates', token), request<Trip[]>('/admin/trips', token),
  ]);
  return { stations, routes, coaches, trips };
}

const get = (form: FormData, name: string) => String(form.get(name) ?? '');
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>;
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('trips');
  const [editing, setEditing] = useState<Item | null>(null);
  const [routeId, setRouteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const route = data?.routes.find((item) => item.id === routeId);
  const stationCode = (id: string) => data?.stations.find((station) => station.id === id)?.code ?? id;
  const stationName = (id: string) => data?.stations.find((station) => station.id === id)?.name ?? id;
  const entries = tab === 'stations' ? data?.stations : tab === 'routes' ? data?.routes :
    tab === 'coach-templates' ? data?.coaches : undefined;
  const station = data?.stations.find((item) => item.id === editing?.id);
  const editedRoute = data?.routes.find((item) => item.id === editing?.id);
  const coach = data?.coaches.find((item) => item.id === editing?.id);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await action(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Yêu cầu thất bại', error: true }); }
    finally { setBusy(false); }
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const signedIn = await request<Login>('/auth/login', '', 'POST',
        { email: get(form, 'email'), password: get(form, 'password') });
      if (signedIn.account.role !== 'ADMIN') {
        await request('/auth/logout', signedIn.token, 'POST');
        throw new Error('Tài khoản cần quyền quản trị.');
      }
      const loaded = await load(signedIn.token);
      setData(loaded);
      setToken(signedIn.token);
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    void run(async () => {
      const fields = { code: get(form, 'code'), name: get(form, 'name') };
      let body: unknown;
      if (tab === 'stations') body = { ...fields, city: get(form, 'city') };
      if (tab === 'routes') {
        const stops = lines(get(form, 'stops')).map((line) => {
          const [code, km, extra] = line.split(/\s+/);
          const item = data?.stations.find((station) => station.code === code.toUpperCase());
          if (!item || !km || extra || !/^\d+$/.test(km)) throw new Error(`Điểm dừng không hợp lệ — ${line}`);
          return { stationId: item.id, distanceKm: Number(km) };
        });
        body = { ...fields, stops };
      }
      if (tab === 'coach-templates') {
        const places = lines(get(form, 'places')).map((line) => {
          const [label, kind, extra] = line.split(/\s+/);
          if (extra || !['SEAT', 'BERTH'].includes(kind)) throw new Error(`Vị trí không hợp lệ — ${line}`);
          return { label, kind };
        });
        body = { ...fields, places };
      }
      if (tab === 'trips' && route) {
        const coachTemplateIds = get(form, 'coaches').trim().split(/\s+/).map((code) => {
          const template = data?.coaches.find((item) => item.code === code.toUpperCase());
          if (!template) throw new Error(`Không tìm thấy mẫu toa — ${code}`);
          return template.id;
        });
        const localTime = (key: string) => {
          const value = get(form, key);
          return value ? value + '+07:00' : null;
        };
        body = { code: fields.code, routeId, coachTemplateIds, stops: route.stops.map((stop, index) => ({
          stationId: stop.stationId, arrivalAt: localTime(`arrival-${index}`), departureAt: localTime(`departure-${index}`),
        })) };
      }
      if (!body) throw new Error('Chọn tuyến trước khi lập chuyến.');
      await request(`/admin/${tab}${editing ? '/' + editing.id : ''}`, token, editing ? 'PUT' : 'POST', body);
      element.reset();
      setEditing(null);
      setRouteId('');
      setData(await load(token));
      setMessage({ text: 'Đã lưu.', error: false });
    });
  }

  return <main className="admin">
    <header><Link href="/">Shanrail</Link><h1>Quản trị chuyến tàu</h1></header>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : ''}>{message.text}</p>}
    {!data ? <form onSubmit={signIn} className="admin-form">
      <Field label="Email"><input name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Mật khẩu"><input name="password" type="password" autoComplete="current-password" required /></Field>
      <button disabled={busy}>Đăng nhập</button>
    </form> : <>
      <nav aria-label="Khu vực quản trị">
        {tabs.map(({ id, label }) => <button type="button" key={id} disabled={busy} aria-pressed={tab === id}
          onClick={() => { setTab(id); setEditing(null); setRouteId(''); setMessage(null); }}>{label}</button>)}
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          try { await request('/auth/logout', token, 'POST'); }
          finally { setData(null); setToken(''); setEditing(null); setRouteId(''); }
        })}>Đăng xuất</button>
      </nav>
      <div className="admin-grid">
        <div>
          <h2>{editing ? 'Chỉnh sửa' : 'Tạo mới'}</h2>
          <form className="admin-form" key={tab + (editing?.id ?? '')} onSubmit={save}>
            <fieldset disabled={busy}>
              <Field label="Mã"><input name="code" defaultValue={editing?.code} required maxLength={40} /></Field>
              {tab !== 'trips' && <Field label="Tên"><input name="name" defaultValue={editing?.name} required /></Field>}
              {tab === 'stations' && <Field label="Tỉnh / thành phố"><input name="city" defaultValue={station?.city} required /></Field>}
              {tab === 'routes' && <Field label="Điểm dừng theo thứ tự, mỗi dòng gồm mã ga và số km">
                <textarea name="stops" rows={6} required placeholder={'HAN 0\nVIN 319'}
                  defaultValue={editedRoute?.stops.map((stop) => `${stationCode(stop.stationId)} ${stop.distanceKm}`).join('\n')} />
              </Field>}
              {tab === 'coach-templates' && <Field label="Số chỗ và loại, dùng SEAT cho ghế hoặc BERTH cho giường">
                <textarea name="places" rows={6} required placeholder={'01 SEAT\n02 SEAT'}
                  defaultValue={coach?.places.map((place) => `${place.label} ${place.kind}`).join('\n')} />
              </Field>}
              {tab === 'trips' && <>
                <Field label="Tuyến"><select value={routeId} onChange={(event) => setRouteId(event.target.value)} required>
                  <option value="">Chọn tuyến</option>{data.routes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></Field>
                <Field label="Mã mẫu toa theo thứ tự, cách nhau bằng khoảng trắng">
                  <input name="coaches" required list="coach-codes" />
                  <datalist id="coach-codes">{data.coaches.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</datalist>
                </Field>
                {route && <p>Giờ địa phương Việt Nam (UTC+7)</p>}
                {route?.stops.map((stop, index) => <div className="admin-stop" key={route.id + stop.stationId}>
                  <strong>{stationName(stop.stationId)}</strong>
                  {index !== 0 && <Field label="Giờ đến"><input type="datetime-local" name={`arrival-${index}`} required /></Field>}
                  {index !== route.stops.length - 1 && <Field label="Giờ đi"><input type="datetime-local" name={`departure-${index}`} required /></Field>}
                </div>)}
              </>}
              <div className="admin-actions">
                <button>Lưu</button>
                {editing && <button type="button" onClick={() => setEditing(null)}>Hủy chỉnh sửa</button>}
              </div>
            </fieldset>
          </form>
        </div>
        <div>
          <h2>{tabs.find((item) => item.id === tab)?.label}</h2>
          <ul className="admin-items">
            {entries?.map((item) => <li key={item.id}>
              <span><strong>{item.code}</strong><br />{item.name}</span>
              <button type="button" disabled={busy} onClick={() => setEditing(item)}>Sửa</button>
            </li>)}
            {tab === 'trips' && data.trips.map((trip) => <li key={trip.id}>
              <span><strong>{trip.code}</strong><br />{timeFormat.format(new Date(trip.departureAt))}
                {' · '}{trip.status === 'DRAFT' ? 'Bản nháp' : 'Đã mở bán'}</span>
              {trip.status === 'DRAFT' && <button type="button" disabled={busy} onClick={() => void run(async () => {
                await request(`/admin/trips/${trip.id}/publish`, token, 'POST');
                setData(await load(token));
                setMessage({ text: 'Đã mở bán chuyến.', error: false });
              })}>Mở bán</button>}
            </li>)}
          </ul>
          {(entries ? entries.length === 0 : data.trips.length === 0) && <p>Chưa có dữ liệu.</p>}
        </div>
      </div>
    </>}
  </main>;
}
