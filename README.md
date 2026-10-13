# PM Service Log

A phone-friendly app for logging equipment PM services, with an office page
for looking up records and downloading the PDF service sheet. It reads and
writes the **Equipment PM Services** base in Airtable and runs on Netlify.
It is a separate site from the timecard app.

- Mechanics: `https://<your-site>/`, the shared shop PIN (the `MECH_PIN` setting in Netlify)
- Office: `https://<your-site>/office.html`, the office PIN (the `OFFICE_PIN` setting; upper or lower case both work)

Each submission becomes a new row in that machine's own table, just like the
old forms, and a PDF sheet is attached to the row's **PM SHEET** field.

---

## 1. Create an Airtable access token

1. Go to <https://airtable.com/create/tokens> and click **Create new token**.
2. Name it `PM Service app`.
3. **Scopes:** add `data.records:read`, `data.records:write` and `schema.bases:read`.
   The last one lets the app see the list of machines, so a new machine table
   shows up in the app automatically.
4. **Access:** add only the **Equipment PM Services** base.
5. Click **Create token** and copy it. You'll paste it into Netlify in step 3.
   Don't email it or paste it anywhere else.

## 2. Put the code on Netlify

Same as the timecard app: Netlify needs the code from a GitHub repository.

1. At <https://github.com>, click **New repository**. Name it `pm-service-app`
   and make it **Private**.
2. On the new repository's page, click **uploading an existing file** and drag
   in **everything inside** the `pm-service-app` folder (`public`, `lib`,
   `netlify`, `test`, `netlify.toml`, `package.json`, `package-lock.json`
   and the rest). Click **Commit changes**.
3. In Netlify, choose **Add new site → Import an existing project → GitHub** and
   pick `pm-service-app`. Leave the build settings as they are and click **Deploy**.

## 3. Add the four settings in Netlify

In the new site, go to **Site configuration → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `AIRTABLE_TOKEN` | the token from step 1 |
| `SESSION_SECRET` | any long random text, at least 24 characters (use a password generator) |
| `MECH_PIN` | the shop PIN for mechanics (4 digits) |
| `OFFICE_PIN` | the office PIN |

The PINs are kept only here, never in the code: Netlify refuses to deploy if a setting's value appears in the files.

Then go to **Deploys → Trigger deploy → Deploy site** so the app picks them up.

To **change a PIN** later, edit `MECH_PIN` or `OFFICE_PIN` here and redeploy.
Everyone signed in with the old PIN is signed out and enters the new one once.

## 4. Your own web address (optional)

In Netlify, go to **Domain management → Add a domain** and enter something like
`pm.yourcompany.com`. Netlify shows you a **CNAME** record. In Squarespace,
go to **Settings → Domains → your domain → DNS → Add record**, choose **CNAME**,
set host `pm` and data to the Netlify address (for example `your-site.netlify.app`).

## 5. Test before rolling out

1. On your phone, open the site, enter the shop PIN, log a test service on a
   machine, and submit.
2. In Airtable, open that machine's table. The new row should be there with
   SERVICE LEVEL filled in and the PDF in **PM SHEET**.
3. Open `/office.html`, enter the office PIN, and find the record. The first time,
   the office page takes about half a minute to read all 99 machines; after
   that it's quick. Open the record and click **Download PDF**.
4. Delete the test row in Airtable when you're done.

On a phone, use **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home
screen** (Android) so the app opens like any other app.

---

## How it works

- **Machines** are every table in the base with an `EQUIPMENT ID` field. The
  serial number comes from the table's `SERIAL #` option, and the filter list
  from its `FILTERS CHANGED` options. To add a machine, duplicate a table in
  Airtable, rename it to the equipment ID, and change those two fields' options.
  It appears in the app within 5 minutes.
- **Mechanic names** are listed in `lib/config.mjs` (`MECHANICS`). Someone who leaves moves to `PAST_MECHANICS`, so the office can still filter their old records. Rushane
  Davis Morgan is added to a table's EMPLOYEE options automatically the first
  time he submits on that machine.
- **Older records** that have "SERVICE 1/2/3" typed in the notes show that as
  their service level in the app. Nothing in Airtable is changed.
- **Hours check:** the app warns a mechanic when the hours are lower than the
  last service, and the office list flags those records with "Check hours".
- **No signal:** the form is kept on the phone until it's sent, so a mechanic
  can close the app and come back. Tapping Submit twice never saves twice.
- **PDF missing:** if the PDF can't be attached when a mechanic submits, the
  service is still saved, and the office can use **Attach PDF to Airtable** on
  that record. Older records can get a sheet attached the same way.
- **Wrong PINs:** after 5 wrong tries, that device has to wait 15 minutes.

## For a developer

- `public/`: the pages (`index.html` + `app.js` for mechanics, `office.html` + `office.js` for the office).
- `netlify/functions/api.mjs`: the `/api/*` entry point. The logic is in `lib/`
  (`app.mjs` routes, `records.mjs` field mapping, `pdf.mjs` the sheet, `auth.mjs` PINs).
- `npm test` runs the API tests against a fake Airtable built from the real 99 machine tables.
- `npm run dev` starts a local preview at <http://localhost:8888> with sample data (shop PIN 4321, office PIN OFFICETEST9).
