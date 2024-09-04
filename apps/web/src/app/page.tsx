import { DEMO_NOTICE_FULL } from '@agricore/contracts';

export default function HomePage() {
  return (
    <div className="page">
      <h1>AgriCore</h1>
      <p className="lead">
        Field operations, alerts and the people working them, across iOS, Android and the web.
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
              <strong>Farm portal</strong>
            </a>
            <p>Assigned workers, field operations, alert history, privacy and data controls.</p>
          </li>
          <li>
            <a href="/console">
              <strong>Manager console</strong>
            </a>
            <p>
              Live alert queue, map and timeline, claim and resolve. Updates arrive over a socket;
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
