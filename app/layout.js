import './globals.css';
import Link from 'next/link';
import Signup from '@/components/Signup';

export const metadata = {
  metadataBase: new URL(process.env.URL || 'https://downtrackmedia.com'),
  title: { default: 'Downtrack Media', template: '%s · Downtrack Media' },
  description:
    'NHRA pro, sportsman and bracket racing results with reaction-time, increment and dial-in stats for every class and every racer.',
  openGraph: { siteName: 'Downtrack Media', type: 'website' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#08284c' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600&family=Saira:ital,wght@1,700;1,800&display=swap"
        />
      </head>
      <body>
        <header className="masthead">
          <div className="wrap">
            <Link href="/" className="logo" aria-label="Downtrack Media home">
              <img src="/logo.png" alt="Downtrack Media" width="1000" height="193" />
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/events">Results</Link>
              <Link href="/classes">Classes</Link>
              <Link href="/drivers">Racers</Link>
            </nav>
          </div>
        </header>
        <div className="stripes" aria-hidden="true" />
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            <div style={{ maxWidth: 420 }}>
              <h3>Get the Monday report</h3>
              <p className="small" style={{ margin: '6px 0 0' }}>
                The weekend's NHRA results and the numbers behind them, every Monday.
              </p>
              <Signup />
            </div>
            <div className="small" style={{ maxWidth: 360 }}>
              <p style={{ margin: 0 }}>
                Results from NHRA.com and DragRaceCentral, 2022 to today. Stats refresh nightly.
              </p>
              <p style={{ margin: '10px 0 0' }}>© {new Date().getFullYear()} Downtrack Media</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
