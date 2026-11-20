'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type Passenger = { coachNumber: number; label: string; name?: string; amountVnd?: number };
type CheckoutData = { status: string; amountVnd?: number; passengers: Passenger[] };
const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

export default function Checkout({ holdId, expired, onPayment }: {
  holdId: string; expired: boolean; onPayment: (status: string) => void;
}) {
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = '/rail-api/public/holds/' + holdId;

  useEffect(() => {
    const controller = new AbortController();
    fetch(base + '/checkout', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setError('Không tìm thấy thông tin thanh toán hoặc sandbox chưa được bật.');
      });
    return () => controller.abort();
  }, [base]);

  async function post(path: string, body: unknown) {
    const response = await fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Yêu cầu chưa hoàn tất. Vui lòng thử lại.');
    return response.json();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const result = await post('/checkout', { passengers: data.passengers.map((place, index) => ({
        ...place, name: fields.get('name-' + index), fareGroup: fields.get('fare-' + index),
      })) });
      setData(result);
      sessionStorage.setItem('shanrail:order:' + holdId, JSON.stringify({ holdId }));
    } catch {
      setError('Không thể chốt thông tin hành khách. Kiểm tra lượt giữ rồi thử lại.');
    } finally { setBusy(false); }
  }

  async function pay(outcome: 'SUCCESS' | 'FAILURE') {
    setBusy(true);
    setError('');
    try {
      const result = await post('/sandbox', { outcome });
      setData((current) => current && { ...current, status: result.status });
      onPayment(result.status);
    } catch {
      setError('Chưa xác nhận được kết quả thanh toán. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }

  return <div>
    {error && <p role="alert">{error}</p>}
    {!error && !data && <p role="status">Đang tải thông tin thanh toán…</p>}
    {data?.status === 'DETAILS' && !expired && <form onSubmit={submit}>
      {data.passengers.map((place, index) => <div key={place.coachNumber + ':' + place.label}>
        <label>Họ tên · Toa {place.coachNumber}, chỗ {place.label}
          <input name={'name-' + index} required maxLength={100} autoComplete="off" />
        </label>
        <label>Nhóm giá · Toa {place.coachNumber}, chỗ {place.label}
          <select name={'fare-' + index}><option value="ADULT">Người lớn</option>
            <option value="CHILD">Trẻ em</option></select>
        </label>
      </div>)}
      <button type="submit" disabled={busy}>Tính tổng tiền</button>
    </form>}
    {data?.amountVnd !== undefined && <>
      <ul>{data.passengers.map((person) => <li key={person.coachNumber + ':' + person.label}>
        {person.name} · Toa {person.coachNumber}, chỗ {person.label} · {vnd.format(person.amountVnd ?? 0)}
      </li>)}</ul>
      <p><strong>Tổng tiền {vnd.format(data.amountVnd)}</strong></p>
    </>}
    {data?.status === 'PENDING' && !expired && <>
      <button type="button" disabled={busy} onClick={() => void pay('SUCCESS')}>Mô phỏng thanh toán thành công</button>
      {' '}<button type="button" disabled={busy} onClick={() => void pay('FAILURE')}>Mô phỏng thanh toán thất bại</button>
    </>}
    {data?.status === 'PAID' && <p role="status">Đã xác nhận thanh toán sandbox. <Link href="/orders">Xem vé</Link></p>}
    {data?.status === 'FAILED' && <p role="status">Thanh toán thất bại. Chỗ đã được trả lại.</p>}
    {data?.status === 'REVIEW' && <p role="status">Khoản thanh toán đang chờ đối soát.</p>}
  </div>;
}
