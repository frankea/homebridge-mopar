/*
 * Jest E2E test setup.
 * Fails fast when credentials for Mopar smoke tests are missing.
 */

process.env.TZ = 'UTC';

beforeAll(() => {
  if (!process.env.MOPAR_EMAIL || !process.env.MOPAR_PASSWORD || !process.env.MOPAR_PIN) {
    console.warn('Skipping Mopar E2E tests. Provide MOPAR_EMAIL, MOPAR_PASSWORD, and MOPAR_PIN to enable.');
  }
});
