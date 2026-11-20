'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

type Order = { id: string; paymentReference: string; status: string; amountVnd: string;
  tripCode: string; passengerCount: number; reviewedAt: string | null; reviewNote: string | null };
type Scan = { status: string; tripCode: string; inspectedAt: string;
  passenger: { name: string; coachNumber: number; label: string } };

export default function StaffPage() {
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [query, setQuery] = useState('');

  async function request(path: string, body?: object, auth = token) {
    const response = await fetch('/rail-api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message ?? 'Yêu cầu thất bại.');
    return result;
  }

  async function run(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await action(new FormData(event.currentTarget)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Yêu cầu thất bại.'); }
    finally { setBusy(false); }
  }

  return <main className="staff">
    <Link href="/">Trang chủ</Link>
    <h1>{role === 'INSPECTOR' ? 'Soát vé' : role === 'ADMIN' ? 'Tra cứu và đối soát đơn' : 'Vận hành Shanrail'}</h1>
    {error && <p role="alert">{error}</p>}
    {!token && <form onSubmit={(event) => void run(event, async (data) => {
      const session = await request('auth/login', { email: data.get('email'), password: data.get('password') });
      if (!['ADMIN', 'INSPECTOR'].includes(session.account.role)) {
        await request('auth/logout', {}, session.token);
        throw new Error('Tài khoản không có quyền vận hành.');
      }
      setRole(session.account.role);
      setToken(session.token);
    })}>
      <label>Email <input name="email" type="email" required autoComplete="username" /></label>
      <label>Mật khẩu <input name="password" type="password" required autoComplete="current-password" /></label>
      <button disabled={busy}>Đăng nhập</button>
    </form>}
    {token && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await request('auth/logout', {}); }
      catch { setError('Không thể xác nhận đăng xuất trên máy chủ.'); }
      finally { setToken(''); setRole(''); setOrders([]); setScan(null); setBusy(false); }
    }}>Đăng xuất</button>}
    {role === 'INSPECTOR' && <>
      <form onSubmit={(event) => {
        const form = event.currentTarget;
        void run(event, async (data) => {
          setScan(null);
          setScan(await request('inspection/tickets', { code: String(data.get('code')).trim() }));
          form.reset();
          form.querySelector('input')?.focus();
        });
      }}>
        <label>Mã QR vé <input name="code" required autoComplete="off" /></label>
        <p>Dùng máy quét QR dạng bàn phím hoặc dán mã vé.</p>
        <button disabled={busy}>Xác nhận soát vé</button>
      </form>
      {scan && <div role="status">
        <strong>{scan.status === 'CHECKED' ? 'Soát vé thành công' : 'Vé đã được soát'}</strong>
        <p>{scan.tripCode} · {scan.passenger.name} · Toa {scan.passenger.coachNumber} · Chỗ {scan.passenger.label}</p>
        <p>{new Date(scan.inspectedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
      </div>}
    </>}
    {role === 'ADMIN' && <>
      <form onSubmit={(event) => void run(event, async (data) => {
        const params = new URLSearchParams();
        const id = String(data.get('id')).trim();
        const status = String(data.get('status'));
        if (id) params.set('id', id);
        if (status) params.set('status', status);
        const nextQuery = params.toString();
        setOrders(await request('admin/orders?' + nextQuery));
        setQuery(nextQuery);
      })}>
        <label>Mã đơn hoặc mã giao dịch <input name="id" /></label>
        <label>Trạng thái <select name="status" defaultValue="REVIEW">
          <option value="">Tất cả</option><option value="REVIEW">Cần đối soát</option>
          <option value="PAID">Đã thanh toán</option><option value="FAILED">Thất bại</option>
          <option value="PENDING">Chờ thanh toán</option>
        </select></label>
        <button disabled={busy}>Tra cứu</button>
      </form>
      {!orders.length && <p>Chưa có đơn hiển thị.</p>}
      {orders.map((order) => <article className="ticket-order" key={order.id}>
        <h2>{order.tripCode} · {order.status}</h2>
        <p>{Number(order.amountVnd).toLocaleString('vi-VN')} ₫ · {order.passengerCount} hành khách</p>
        <p className="ticket-code">Đơn {order.id}<br />Giao dịch {order.paymentReference}</p>
        {order.reviewedAt && <p>Đã ghi nhận đối soát · {order.reviewNote}</p>}
        {order.status === 'REVIEW' && !order.reviewedAt && <form onSubmit={(event) => void run(event, async (data) => {
          await request('admin/orders/' + order.id + '/review', { note: data.get('note') });
          setOrders(await request('admin/orders?' + query));
        })}>
          <label>Ghi chú đối soát <input name="note" required maxLength={500} /></label>
          <button disabled={busy}>Ghi nhận đối soát</button>
        </form>}
      </article>)}
    </>}
  </main>;
}
