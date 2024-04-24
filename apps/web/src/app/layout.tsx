import type { Metadata } from 'next';

import { DEMO_NOTICE_SHORT } from '@guardianlink/contracts';

import './globals.css';

export const metadata: Metadata = {
  title: 'GuardianLink',
  description:
    'Personal safety and trusted contacts. A portfolio demonstration, not a real emergency service.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* First thing in the tab order, so a keyboard user is not walked through the
            entire navigation before reaching the incident they opened. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {/*
          The demonstration notice is in the header, not a footer, and it is not
          dismissible. Someone landing on an incident screen should not have to scroll
          to find out that nobody is actually monitoring it.
        */}
        <div className="demo-banner" role="note">
          <strong>Demonstration.</strong> {DEMO_NOTICE_SHORT}
        </div>

        <header className="app-header">
          <span className="app-header__brand">GuardianLink</span>
          <nav aria-label="Main">
            <a href="/portal">Portal</a>
            <a href="/console">Operator console</a>
          </nav>
        </header>

        <main id="main">{children}</main>
      </body>
    </html>
  );
}
