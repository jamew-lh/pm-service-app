// Netlify entry point for /api/*.
import { handle } from '../../lib/app.mjs';
import { makeAirtable } from '../../lib/airtable.mjs';
import { openStore } from '../../lib/store.mjs';
import { BASE_ID } from '../../lib/config.mjs';

export default async (req, context) => {
  const env = {
    AIRTABLE_TOKEN: Netlify.env.get('AIRTABLE_TOKEN'),
    SESSION_SECRET: Netlify.env.get('SESSION_SECRET'),
    MECH_PIN: Netlify.env.get('MECH_PIN'),
    OFFICE_PIN: Netlify.env.get('OFFICE_PIN'),
  };
  return handle(req, {
    env,
    airtable: makeAirtable({ token: env.AIRTABLE_TOKEN, baseId: BASE_ID }),
    store: openStore(),
    now: () => Date.now(),
    ip: context.ip,
    log: (m) => console.log(m),
  });
};

export const config = { path: '/api/*' };
