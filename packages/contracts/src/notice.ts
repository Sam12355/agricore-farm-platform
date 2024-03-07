/**
 * One place for the demonstration notice.
 *
 * It is defined here, in the contracts package, so the API returns exactly the same
 * wording that the web app and both mobile apps display. If someone changes it, it
 * changes everywhere, and there is no chance of a screen quietly dropping it.
 */

export const DEMO_NOTICE_SHORT =
  'GuardianLink is a portfolio demonstration. It does not contact emergency services.';

export const DEMO_NOTICE_FULL =
  'GuardianLink is a portfolio demonstration built to show engineering work. It is not a real ' +
  'safety service, it does not contact emergency services, and no real person is monitoring it. ' +
  'In a genuine emergency, contact your local emergency number.';

export const DEMO_NOTICE_ACKNOWLEDGEMENT =
  'I understand this is a demonstration and not an emergency service.';
