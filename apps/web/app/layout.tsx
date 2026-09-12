import type { Metadata } from 'next';
import { Barlow_Semi_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { ConsoleProvider } from '@/components/console/ConsoleProvider';
import { Shell } from '@/components/console/Shell';

import './globals.css';

const display = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-barlow-semi',
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Faregate console',
  description: 'Agents buy onchain data by the query. Humans decide what they are allowed to buy.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <ConsoleProvider>
          <Shell>{children}</Shell>
        </ConsoleProvider>
      </body>
    </html>
  );
}
