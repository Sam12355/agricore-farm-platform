import type { Metadata } from 'next';

import { DEMO_NOTICE_SHORT } from '@agricore/contracts';

import './globals.css';

export const metadata: Metadata = {
  title: 'AgriCore',
  description:
    'Field operations, alerts and assigned workers. A portfolio demonstration, not a working farm service.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* First thing in the tab order, so a keyboard user is not walked through the
            entire navigation before reaching the alert they opened. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {/*
          The demonstration notice is in the header, not a footer, and it is not
          dismissible. Someone landing on an alert screen should not have to scroll
          to find out that nobody is actually monitoring it.
        */}
        <div className="demo-banner" role="note">
          <strong>Demonstration.</strong> {DEMO_NOTICE_SHORT}
        </div>

        <header className="app-header">
          <span className="app-header__brand">AgriCore</span>
          <nav aria-label="Main">
            <a href="/portal">Portal</a>
            <a href="/console">Manager console</a>
          </nav>
        </header>

        <main id="main">{children}</main>
      </body>
    </html>
  );
}
