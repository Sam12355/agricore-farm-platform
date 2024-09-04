/**
 * One place for the demonstration notice.
 *
 * It is defined here, in the contracts package, so the API returns exactly the same
 * wording that the web app and both mobile apps display. If someone changes it, it
 * changes everywhere, and there is no chance of a screen quietly dropping it.
 */

export const DEMO_NOTICE_SHORT =
  'AgriCore is a portfolio demonstration. It is not connected to any real farm.';

export const DEMO_NOTICE_FULL =
  'AgriCore is a portfolio demonstration built to show engineering work. It is not a ' +
  'working farm operations service, no real sensor, machine or field is connected to it, ' +
  'and nobody is monitoring the alerts it raises. Do not use it to run an actual farm.';

export const DEMO_NOTICE_ACKNOWLEDGEMENT =
  'I understand this is a demonstration and not a working farm operations service.';
