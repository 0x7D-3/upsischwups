import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://0x7d-3.github.io/upsischwups/'),
  title: 'Schultag — auch ohne WLAN',
  description: 'Lokale Nachrichten, Aufgaben und Notizen für den Schulalltag — auch wenn das WLAN ausfällt.',
  applicationName: 'Schultag',
  manifest: './manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Schultag',
  },
  icons: {
    icon: './icon.svg',
    apple: './icon.svg',
  },
  openGraph: {
    title: 'Schultag — auch ohne WLAN',
    description: 'Lokale Nachrichten, Aufgaben und Notizen für den Schulalltag.',
    type: 'website',
    locale: 'de_DE',
    url: 'https://0x7d-3.github.io/upsischwups/',
    images: [{ url: './schultag-social.png', width: 1736, height: 907, alt: 'Schultag — Alles im Blick. Auch ohne WLAN.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Schultag — auch ohne WLAN',
    description: 'Lokale Nachrichten, Aufgaben und Notizen für den Schulalltag.',
    images: ['./schultag-social.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#122238',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
