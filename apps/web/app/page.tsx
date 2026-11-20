import Image from 'next/image';

export default function HomePage() {
  return (
    <main>
      <header className="brand">
        <Image src="/icon.svg" alt="" width={36} height={36} />
        <span>Shanrail</span>
      </header>
      <section aria-labelledby="page-title">
        <div className="route" aria-hidden="true"><span /><span /><span /></div>
        <h1 id="page-title">Vé tàu hỏa</h1>
        <p>Shanrail đang chuẩn bị tính năng tìm chuyến và đặt vé.</p>
      </section>
    </main>
  );
}
