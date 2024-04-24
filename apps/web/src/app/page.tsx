import { DEMO_NOTICE_FULL } from '@guardianlink/contracts';

export default function HomePage() {
  return (
    <div className="page">
      <h1>GuardianLink</h1>
      <p className="lead">
        Personal safety and trusted contacts, across iOS, Android and the web.
      </p>

      <section aria-labelledby="notice-heading" className="card card--notice">
        <h2 id="notice-heading">Read this first</h2>
        <p>{DEMO_NOTICE_FULL}</p>
      </section>

      <section aria-labelledby="surfaces-heading">
        <h2 id="surfaces-heading">Two surfaces</h2>
        <ul className="surface-list">
          <li>
            <a href="/portal">
              <strong>User portal</strong>
            </a>
            <p>Trusted contacts, safety sessions, incident history, privacy and data controls.</p>
          </li>
          <li>
            <a href="/console">
              <strong>Operator console</strong>
            </a>
            <p>
              Live incident queue, map and timeline, claim and resolve. Updates arrive over a socket;
              nothing is polled.
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="demo-heading">
        <h2 id="demo-heading">Trying it</h2>
        <p>
          Demo accounts and a walkthrough are in <code>docs/DEMO.md</code>. All demo data is
          synthetic: no real name, number or place appears anywhere.
        </p>
      </section>
    </div>
  );
}
