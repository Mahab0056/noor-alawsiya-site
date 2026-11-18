import type { Metadata, Viewport } from 'next';
import { Amiri, Aref_Ruqaa, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import './site.css';
import './portal.css';
import './forms.css';

const ui = IBM_Plex_Sans_Arabic({ variable: '--font-ui', subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'] });
const quran = Amiri({ variable: '--font-quran', subsets: ['arabic'], weight: ['400', '700'] });
const brand = Aref_Ruqaa({ variable: '--font-brand', subsets: ['arabic'], weight: ['700'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://noor-alawsiya.com'),
  title: { default: 'مدرسة نور الأوصياء للدراسات القرآنية | بغداد', template: '%s | مدرسة نور الأوصياء' },
  description: 'مدرسة نور الأوصياء للدراسات القرآنية في بغداد: دورات أحكام التلاوة والتجويد، القراءة التحقيقية والإجازة، والنغم القرآني.',
  icons: { icon: '/img/mark-black.png' },
  openGraph: { type: 'website', locale: 'ar_IQ', siteName: 'مدرسة نور الأوصياء للدراسات القرآنية' },
};

export const viewport: Viewport = { themeColor: '#fffa00' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ar" dir="rtl" className={`${ui.variable} ${quran.variable} ${brand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
