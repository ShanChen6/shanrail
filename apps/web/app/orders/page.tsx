'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { toQR } from 'toqr';

type Ticket = {
  id: string; tripCode: string; from: string; to: string; departureAt: string; arrivalAt: string;
  passenger: { name: string; coachNumber: number; label: string; amountVnd: number };
};
type Order = { holdId: string; status: string; tickets?: Ticket[] };

const time = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
});
const statuses: Record<string, string> = { PENDING: 'Chờ thanh toán', PAID: 'Đã thanh toán',
  FAILED: 'Thanh toán thất bại', REVIEW: 'Chờ đối soát' };
const path = (holdId: string) => '/rail-api/public/holds/' + holdId;

function TicketCode({ id }: { id: string }) {
  const matrix = toQR(id);
  const size = Math.sqrt(matrix.length);
  const pixels = Array.from(matrix, (filled, index) =>
    filled ? `M${index % size} ${Math.floor(index / size)}h1v1h-1z` : '').join('');
  return <svg role="img" aria-label={'Mã QR vé ' + id} width="160" height="160"
    viewBox={`-4 -4 ${size + 8} ${size + 8}`} shapeRendering="crispEdges">
    <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="white" />
    <path d={pixels} fill="black" />
  </svg>;
}

function TestEmail({ holdId }: { holdId: string }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true);
    try {
      const response = await fetch(path(holdId) + '/ticket-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error();
      setMessage('Đã ghi thư vào hộp thư thử nghiệm.');
    } catch {
      setMessage('Chưa ghi được thư thử nghiệm. Có thể thử lại.');
    } finally { setBusy(false); }
  }
  return <form onSubmit={send}>
    <label>Email thử nghiệm <input type="email" name="email" required /></label>{' '}
    <button disabled={busy}>Ghi thư thử nghiệm</button>
    {message && <p role="status">{message}</p>}
  </form>;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const holdIds = new Set<string>();
    for (const key of Object.keys(sessionStorage).filter((key) => key.startsWith('shanrail:order:') || key.startsWith('shanrail:hold:'))) {
      try {
        const { holdId } = JSON.parse(sessionStorage.getItem(key) ?? '{}');
        if (typeof holdId === 'string' && /^[\da-f-]{36}$/i.test(holdId)) holdIds.add(holdId);
      } catch { continue; }
    }
    const options = { signal: controller.signal, cache: 'no-store' as const };
    Promise.all([...holdIds].reverse().map(async (holdId): Promise<Order | null> => {
      const response = await fetch(path(holdId) + '/checkout', options);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error();
      const { status } = await response.json();
      if (!statuses[status]) return null;
      if (status !== 'PAID') return { holdId, status };
      const tickets = await fetch(path(holdId) + '/tickets', options);
      if (!tickets.ok) throw new Error();
      return { holdId, status, tickets: await tickets.json() };
    })).then((results) => setOrders(results.filter((order) => order !== null))).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [attempt]);

  return <main>
    <Link href="/">Về trang tìm chuyến</Link>
    <h1>Đơn và vé của tôi</h1>
    <p>Hiển thị các đơn lưu trong phiên trình duyệt này.</p>
    {error && <p role="alert">Không tải được lịch sử. <button onClick={() => {
      setError(false);
      setAttempt(attempt + 1);
    }}>Thử lại</button></p>}
    {!orders && !error && <p role="status">Đang tải…</p>}
    {orders?.length === 0 && <p>Chưa có đơn trong phiên này.</p>}
    {orders?.map((order) => <article className="ticket-order" key={order.holdId}>
      <h2>{statuses[order.status]}</h2>
      {order.tickets?.map(({ id, tripCode, from, to, departureAt, arrivalAt, passenger }) => <div key={id}>
        <h3>{tripCode} · {from} → {to}</h3>
        <p>Đi {time.format(new Date(departureAt))} · Đến {time.format(new Date(arrivalAt))}</p>
        <p>{passenger.name} · Toa {passenger.coachNumber} · Chỗ {passenger.label}</p>
        <TicketCode id={id} />
        <p className="ticket-code">Mã vé {id}</p>
      </div>)}
      {order.tickets?.length ? <TestEmail holdId={order.holdId} /> : null}
    </article>)}
  </main>;
}
