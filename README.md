# GWOC Timesheet System

A lightweight, mobile-first timesheet management system built as a single-page HTML application with a Supabase backend. Designed for small teams that need shift logging, break compliance tracking, manager oversight, and CSV export — with no server infrastructure to maintain.

---

## Features

- **Shift logging** — staff log date, start/end times, location, and break taken
- **Break compliance** — automatic flagging against UK break rules (15 min per 6-hour block)
- **Role-based access** — three roles: Staff, Manager, Admin
- **Dashboard** — KPIs, hours by employee/location/day-of-week, break flag list
- **CSV export** — filtered export of all timesheet records
- **Amendments** — managers can edit records; every amendment requires a reason and is logged
- **Audit log** — full trail of all amendments and deletions
- **User management** — invite new users by email, link to staff records, change roles, deactivate
- **Locations** — configurable work locations with emoji icons
- **Mobile-first** — responsive design with card-based shift entry on mobile

---

## Architecture

```
Browser (GitHub Pages)
  └── index.html          Single-page app — all HTML, CSS, JS in one file
        └── supabase-js   Supabase JS client (CDN)
              └── Supabase project
                    ├── Auth           Email/password + invite flows
                    ├── Database       PostgreSQL (profiles, staff, locations, timesheets, amendment_log)
                    ├── Row Level Security  Per-role data access policies
                    └── Edge Function  gwoc-user-admin (invite/delete via service role key)
```

No build step. No Node.js. No framework. The app is a single HTML file that can be hosted anywhere — GitHub Pages is used by default.

---

## Quick Start

See [`docs/SETUP.md`](docs/SETUP.md) for the full step-by-step setup guide.

The short version:
1. Create a [Supabase](https://supabase.com/) project
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor
3. Deploy [`supabase/functions/gwoc-user-admin/index.ts`](supabase/functions/gwoc-user-admin/index.ts) as an Edge Function
4. Set your Supabase URL and anon key in `index.html` (lines marked `CONFIGURATION`)
5. Update the `redirectTo` URL in the Edge Function to match your deployment URL
6. Push to GitHub and enable GitHub Pages, or host `index.html` anywhere

---

## Roles

| Capability                        | Staff | Manager | Admin |
|-----------------------------------|:-----:|:-------:|:-----:|
| Log own timesheets                |  ✓   |   ✓    |  ✓   |
| View own records                  |  ✓   |   ✓    |  ✓   |
| Log timesheets for any staff      |       |   ✓    |  ✓   |
| View all records                  |       |   ✓    |  ✓   |
| Edit/amend records                |       |   ✓    |  ✓   |
| Dashboard access                  |  ✓   |   ✓    |  ✓   |
| Manage locations                  |       |   ✓    |  ✓   |
| Manage staff records              |       |   ✓    |  ✓   |
| Invite / manage user accounts     |       |   ✓    |  ✓   |
| Delete records                    |             |  ✓   |
| Remove users                      |             |  ✓   |
| Create admin accounts             |             |  ✓   |

---

## File Structure

```
gwoc-timesheet/
├── index.html                          Main application (single file)
├── README.md                           This file
├── docs/
│   ├── SETUP.md                        Step-by-step setup guide
│   └── SPECIFICATION.md                Full solution specification
└── supabase/
    ├── schema.sql                      Database schema + RLS + triggers
    └── functions/
        └── gwoc-user-admin/
            └── index.ts                Edge Function (user admin operations)
```

---

## Technology

- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
- **Fonts:** Google Fonts (Playfair Display, DM Sans)
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Hosting:** GitHub Pages (or any static host)
- **Auth flow:** Implicit (required for hash-based invite/recovery links on static hosts)

---

## Licence

Private — internal use only.
