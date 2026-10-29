import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://hk-stock-sentiment-radar.luis-mok.chatgpt.site'),
  title: '港股情緒雷達｜香港股票市場情緒分析',
  description: '整理近三日港股公開討論、價格變化與熱門議題，提供可解釋的市場情緒研究報告。',
  openGraph: {
    title: '港股情緒雷達',
    description: '看見市場情緒轉向',
    locale: 'zh_HK',
    type: 'website',
    images: [{ url: '/og.png', width: 1728, height: 910, alt: '港股情緒雷達｜看見市場情緒轉向' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '港股情緒雷達',
    description: '看見市場情緒轉向',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-HK" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
