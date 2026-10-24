import type { Metadata } from 'next';
import { ONE_LINER } from '@/lib/constants';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReplySlip',
  description: ONE_LINER,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
