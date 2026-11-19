import type { Metadata, Viewport } from 'next';
import { Amiri, Aref_Ruqaa, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import './site.css';
import './portal.css';
import './forms.css';

// Mobile speed: preload only what the first screen draws. `subsets` only picks which files are preloaded;
// the latin files are still in the @font-face rules, so Latin text keeps this font (loaded when the page needs it).
// Weight 500 is dropped: its 4 uses (nav, logo subtitle, 2 admin labels) now use 400. Amiri draws only the ayah far down the
// home page, in 700, so it is not preloaded and its unused 400 is gone.
const ui = IBM_Plex_Sans_Arabic({ variable: '--font-ui', subsets: ['arabic'], weight: ['400', '600', '700'] });
const quran = Amiri({ variable: '--font-quran', subsets: ['arabic'], weight: ['700'], preload: false });
const brand = Aref_Ruqaa({ variable: '--font-brand', subsets: ['arabic'], weight: ['700'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://noor-alawsiya.com'),
  title: { default: 'مدرسة نور الأوصياء للدراسات القرآنية | بغداد', template: '%s | مدرسة نور الأوصياء' },
  description: 'مدرسة نور الأوصياء للدراسات القرآنية في بغداد: دورات أحكام التلاوة والتجويد، القراءة التحقيقية والإجازة، والنغم القرآني.',
  alternates: { canonical: './' },
  icons: {
    icon: [{ url: '/favicon.ico', sizes: '48x48' }, { url: '/img/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/img/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'ar_IQ',
    siteName: 'مدرسة نور الأوصياء للدراسات القرآنية',
    images: [{ url: '/img/og.png', width: 1200, height: 630, alt: 'مدرسة نور الأوصياء للدراسات القرآنية، بغداد' }],
  },
  twitter: { card: 'summary_large_image', images: ['/img/og.png'] },
};

export const viewport: Viewport = { themeColor: '#fffa00' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ar" dir="rtl" className={`${ui.variable} ${quran.variable} ${brand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
