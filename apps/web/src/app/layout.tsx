import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Marble Park | Premium Bath Solutions',
  description: 'Marble Park - Premium Bath Solutions CRM & Inventory Management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-slate-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}