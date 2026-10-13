# Bambang HRMIS (first slice: login, roles, travel orders)

Plain HTML/CSS/JavaScript front end, Node.js + Express back end, PostgreSQL database. Runs on localhost.

## Setup (VS Code terminal)
1. Install Node.js 20.6 or newer and PostgreSQL.
2. Create the database: `createdb hrmis`
3. Load the schema: `psql -d hrmis -f db/schema.sql`
4. Copy `.env.example` to `.env` and fill in your database password and a long random SESSION_SECRET.
5. `npm install`
6. `npm run seed` (once, on the empty database; creates SAMPLE data only)
7. `npm start`, then open http://localhost:3000

Sample logins (password `changeme123`): `hrmo`, `mayor`, `vicemayor`, `juan`, `ana`.

## Try the flow
- `juan` files a travel order (version Executive or SB).
- `hrmo` records it (the system assigns the number for that version and year).
- Executive: `mayor` approves. SB: `vicemayor` recommends, then `mayor` approves.
- `hrmo` releases it. Anyone with a number can print it.

## Not built yet
Leave (CS Form No. 6), pass slips, user and employee management screens, the `approval_steps` table (the flow is in `ACT` in server.js), attachments, reports.
Use sample data only. Do not load real employee records without the LGU's written permission.

## Files
`server.js` (API and rules), `db/schema.sql`, `db/seed.js`, `public/` (screens).
