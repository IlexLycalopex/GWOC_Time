# GWOC Timesheet System — Solution Specification

## 1. Overview

The GWOC Timesheet System is a browser-based timesheet management application for small to medium-sized teams. It is built as a single HTML file with no server-side code required beyond Supabase's managed backend. The application is hosted as a static site (GitHub Pages) and communicates directly with Supabase via its JavaScript client library.

The system is designed for organisations that need to track staff shift times and locations, enforce UK statutory break compliance rules, and provide managers with oversight, amendment capability, and reporting — without the cost or complexity of a full SaaS solution.

---

## 2. System Architecture

### 2.1 Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | HTML/CSS/JS (single file) | Application UI and logic |
| Auth | Supabase Auth | Email-based authentication with invite flow |
| Database | Supabase PostgreSQL | All application data |
| Row Level Security | Supabase RLS | Per-role data access enforcement |
| Edge Function | Supabase Deno runtime | User admin operations requiring service role key |
| Hosting | GitHub Pages (or any static host) | Serves index.html |

### 2.2 Data Flow

```
User browser
  → Loads index.html from GitHub Pages (static, no server)
  → Authenticates via Supabase Auth (email + password or invite link)
  → Reads/writes data via Supabase JS client (PostgREST API)
  → RLS policies enforce what each user can access
  → Admin operations (invite/delete) call Edge Function via fetch()
  → Edge Function uses service role key (never exposed to browser)
```

### 2.3 Security Model

- The `anon` key is embedded in `index.html` — this is safe; it is the intended usage pattern. RLS policies enforce all data access
- The `service_role` key lives only in Supabase's Edge Function environment. It is never sent to the browser
- JWT verification on the Edge Function is handled internally (gateway-level verification is disabled because static hosts cannot complete PKCE flows; the function verifies the caller's role from the profiles table)
- Auth uses the implicit flow (hash-based tokens) because GitHub Pages cannot participate in PKCE code exchange

---

## 3. Database Schema

### 3.1 Tables

#### `profiles`
Mirrors `auth.users`. Auto-created by trigger on invite.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | FK → auth.users.id (PK) |
| email | text | |
| full_name | text | |
| role | text | 'staff', 'manager', or 'admin' |
| is_active | boolean | Default true |
| created_at | timestamptz | |

#### `staff`
Physical employee records. Separate from auth users — one person can have a staff record without a login account.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | Full display name |
| role | text | Job title (optional) |
| user_id | uuid | FK → auth.users.id (nullable, for self-submission) |
| created_at | timestamptz | |

#### `locations`
Work locations selectable when logging a shift.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | Display name |
| icon | text | Single emoji character, default '📍' |
| created_at | timestamptz | |

#### `timesheets`
One row per shift. Multiple rows can be saved in one submission.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| staff_id | uuid | FK → staff.id |
| location_id | uuid | FK → locations.id (nullable) |
| date | date | |
| start_time | time | |
| end_time | time | |
| break_mins | integer | Break taken in minutes |
| required_break_mins | integer | Calculated at save time |
| net_hours | numeric(5,2) | gross − break_taken |
| break_warning | boolean | True if break taken < required |
| created_by | uuid | FK → auth.users.id |
| created_at | timestamptz | |
| amended_by | uuid | FK → auth.users.id (nullable) |
| amended_at | timestamptz | |
| amendment_reason | text | |

#### `amendment_log`
Append-only audit trail. Written before every amendment and deletion.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| timesheet_id | uuid | FK → timesheets.id |
| amended_by | uuid | FK → auth.users.id |
| reason | text | Required — manager must provide |
| changed_at | timestamptz | |

### 3.2 Row Level Security

| Table | Staff can | Manager/Admin can |
|-------|-----------|-------------------|
| profiles | Read own | Read all |
| staff | Read all | Read + write all |
| locations | Read all | Read + write all |
| timesheets | Read own; insert own | Read all; insert/update all |
| amendment_log | Read all | Read + insert all |

Staff users can only insert timesheets where `staff_id` matches their linked staff record (enforced by RLS checking `staff.user_id = auth.uid()`).

### 3.3 Trigger

`handle_new_user()` fires `AFTER INSERT ON auth.users`. It creates a `profiles` row using metadata (`full_name`, `role`) set at invite time. The Edge Function also creates the `profiles` row manually as a fallback if the trigger has not fired by the time the function responds.

---

## 4. Authentication & User Flows

### 4.1 Sign In
Standard email + password via `supabase.auth.signInWithPassword()`. On success, `INITIAL_SESSION` fires with a session and `bootApp()` runs.

### 4.2 Invite Flow
1. Admin fills in email, name, role in the Users tab and clicks Send Invite
2. Frontend calls the `gwoc-user-admin` Edge Function with `action: 'invite'`
3. Edge Function calls `adminClient.auth.admin.inviteUserByEmail()` and creates a `profiles` row
4. Supabase sends an email containing a magic link pointing to `redirectTo` (the app URL) with an `access_token` hash
5. New user clicks the link. The app detects `type=invite` in the URL hash (read synchronously before `DOMContentLoaded`) and shows "Welcome — set your password"
6. User sets password via `db.auth.updateUser({ password })`. URL hash is cleared. Page reloads after 2.5 seconds
7. On reload, session is already stored in localStorage. `INITIAL_SESSION` fires with a full session. `bootApp()` runs

### 4.3 Password Reset Flow
1. User clicks "Forgotten your password?" and enters their email
2. `db.auth.resetPasswordForEmail()` sends an email with a recovery link
3. Recovery link contains `type=recovery` in the URL hash — detected same way as invite
4. User sees "Set New Password" and sets a new password
5. Page reloads and boots normally

### 4.4 Auth State Machine

```
INITIAL_SESSION (no session, no special link) → showSignIn()
INITIAL_SESSION (no session, invite/recovery link) → wait for SIGNED_IN
SIGNED_IN + _isInviteLink → showNewPw('invite')
SIGNED_IN + _isRecoveryLink → showNewPw('reset')
PASSWORD_RECOVERY → showNewPw('reset')
SIGNED_IN / INITIAL_SESSION (with session, no special link) → bootApp()
USER_UPDATED → bootApp() (after password set, page reloads instead)
SIGNED_OUT → showSignIn()
TOKEN_REFRESHED → silent (update currentUser only)
```

---

## 5. Break Rules

Break compliance is calculated per-shift using UK statutory guidelines:

| Shift length (gross) | Break required |
|---------------------|----------------|
| Under 6 hours | 0 minutes |
| 6 hours to 11h 59m | 15 minutes |
| 12 hours to 17h 59m | 30 minutes |
| Formula | `floor(grossMins / 360) × 15` |

**Net hours** = gross hours − break taken (not break required). The system flags non-compliance but does not auto-adjust. Non-compliant shifts require manager review.

Flag states:
- **✓ OK** — break taken ≥ required, or shift under 6 hours
- **⚠ Need Xm** — break taken is less than required (amber)
- **⚠ Xm req.** — no break logged but one is required (red)

---

## 6. User Interface

### 6.1 Pages

| Page | Visible to | Purpose |
|------|-----------|---------|
| Dashboard | All | KPIs, charts, staff summary, break flags |
| Timesheets | All | Log shifts; view, filter, export records |
| Locations | Manager/Admin | Add, edit, delete work locations |
| Users | Manager/Admin | Manage staff records and user accounts |
| Audit Log | Manager/Admin | View amendment and deletion history |

### 6.2 Responsive Design

The UI uses two layouts:
- **Desktop (>700px):** Standard table-based shift entry; horizontal navigation
- **Mobile (≤700px):** Card-based shift entry with large touch targets; hamburger navigation; records table collapses to grid cards

### 6.3 Navigation

Navigation tabs are shown/hidden based on role at boot time via `classList.add/remove('hidden')`. The hamburger menu on mobile inherits the same visibility — hidden tabs are not rendered.

---

## 7. Edge Function: gwoc-user-admin

### 7.1 Purpose
Handles all Auth Admin API operations that require the service role key. The key never leaves Supabase's server environment.

### 7.2 Actions

| Action | Required fields | Who can call |
|--------|----------------|--------------|
| `invite` | email, full_name, role | Admin + Manager |
| `resend` | email, full_name, role | Admin + Manager |
| `delete_user` | user_id | Admin only |

### 7.3 Authentication
The function verifies the caller's JWT using three methods in sequence (fallback chain due to Supabase version differences). It then reads the caller's role from the `profiles` table and enforces permissions before executing any action.

### 7.4 Configuration
- JWT verification at the gateway level must be **disabled** (toggle in Dashboard → Edge Functions → Details)
- `redirectTo` URL must be updated to match the deployment URL before deploying
- All environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are auto-injected

---

## 8. Known Limitations

- **Supabase free tier cold starts:** Projects on the free tier pause after 7 days of inactivity. The first request after waking can take 5–20 seconds. The app retries for up to 40 seconds with a "Connecting..." message
- **500-record display limit:** The records table displays a maximum of 500 entries. Date filters should be used for large datasets. CSV export supports up to 5,000 records
- **No offline support:** The app requires an active internet connection
- **Single-file constraint:** All logic is in one HTML file. This simplifies deployment but makes the codebase harder to navigate at scale
- **Implicit auth flow:** Required for static hosting but less secure than PKCE. Acceptable for an internal tool; not recommended for public-facing apps with sensitive data
- **No multi-tenancy:** The system is designed for a single organisation per Supabase project

---

## 9. Future Enhancements (Backlog)

- Magic link / passwordless login for staff users (reduces password friction; requires email deliverability review for Supabase free tier limits)
- Staff self-submission approval workflow (manager approves submitted timesheets)
- Weekly/fortnightly timesheet periods with total hours summary
- Notifications for break flag violations
- Bulk CSV import
- Manager dashboard with exportable PDF summary
- Push to payroll system integration
