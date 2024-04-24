import { RetentionBounds, defaultPrivacySettings } from '@guardianlink/contracts';

/**
 * User portal.
 *
 * A server component: it renders the current settings and links to the interactive
 * surfaces. The defaults shown here come from the contracts package, which is also what
 * the API applies at registration, so the page cannot describe a default the server does
 * not actually use.
 */
export default function PortalPage() {
  const defaults = defaultPrivacySettings(new Date().toISOString());

  return (
    <div className="page">
      <h1>Your account</h1>
      <p className="lead">Trusted contacts, safety sessions, and what GuardianLink keeps.</p>

      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Privacy defaults</h2>
        <p>
          These apply from the moment an account is created, so there is never a window
          where retention is undefined.
        </p>

        <table className="settings-table">
          <caption className="visually-hidden">
            Default privacy settings and the range each one may be set to
          </caption>
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Default</th>
              <th scope="col">Allowed range</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Share location with trusted contacts</th>
              <td>{defaults.shareLocationWithContacts ? 'On' : 'Off'}</td>
              <td>On or off</td>
            </tr>
            <tr>
              <th scope="row">Share location with operators</th>
              <td>{defaults.shareLocationWithOperators ? 'On' : 'Off'}</td>
              <td>On or off</td>
            </tr>
            <tr>
              <th scope="row">Keep precise location history</th>
              <td>{defaults.storePreciseLocationHistory ? 'On' : 'Off'}</td>
              <td>
                Off by default. With it off, only a district-level position is kept.
              </td>
            </tr>
            <tr>
              <th scope="row">Keep incidents for</th>
              <td>{defaults.incidentRetentionDays} days</td>
              <td>
                {RetentionBounds.incidentDays.min} to {RetentionBounds.incidentDays.max} days
              </td>
            </tr>
            <tr>
              <th scope="row">Keep location points for</th>
              <td>{defaults.locationRetentionDays} days</td>
              <td>
                {RetentionBounds.locationDays.min} to {RetentionBounds.locationDays.max} days
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="data-heading">
        <h2 id="data-heading">Your data</h2>
        <ul>
          <li>
            <strong>Export.</strong> Everything held about your account, as JSON. Nothing
            summarised, nothing left out.
          </li>
          <li>
            <strong>Deletion.</strong> Two steps, with a fourteen-day grace period you can
            cancel. Every session ends immediately when you request it.
          </li>
        </ul>
        <p>
          Audit records of privileged access survive deletion, with your identity reduced to
          an identifier. That is deliberate, and the reasoning is in <code>PRIVACY.md</code>.
        </p>
      </section>
    </div>
  );
}
