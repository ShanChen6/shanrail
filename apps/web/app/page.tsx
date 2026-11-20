import Image from 'next/image';
import Link from 'next/link';
import TripSearch from './trip-search';

export default function HomePage() {
  return (
    <main>
      <header className="brand">
        <Image src="/icon.svg" alt="" width={36} height={36} />
        <span>Shanrail</span>
        <Link className="admin-link" href="/orders">Đơn và vé</Link>
        <Link className="admin-link" href="/admin">Quản trị</Link>
        <Link className="admin-link" href="/staff">Vận hành</Link>
      </header>
      <section aria-labelledby="page-title">
        <div className="route" aria-hidden="true"><span /><span /><span /></div>
        <h1 id="page-title">Vé tàu hỏa</h1>
        <p>Tìm chuyến và xem giá vé theo chặng.</p>
      </section>
      <TripSearch />
    </main>
  );
}
