import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'Shanrail — Đặt vé tàu',
  description: 'Tìm chuyến và đặt vé tàu hỏa tại Việt Nam.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi"><body>{children}</body></html>;
}
