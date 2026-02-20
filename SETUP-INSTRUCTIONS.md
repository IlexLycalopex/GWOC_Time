# GWOC Timesheet System — Supabase Setup Instructions

---

## What You Are Deploying

A single-page timesheet application hosted on GitHub Pages, backed by Supabase for:

- Authentication (email/password + invite flow)
- Database (PostgreSQL via Supabase)
- Row-Level Security (users only see what they are allowed to see)
- An Edge Function to handle user invites

**Files provided:**

| File | Purpose |
|---|---|
| `index.html` | The complete web app — host this on GitHub Pages |
| `supabase-setup.sql` | Run once in Supabase SQL Editor to create all tables and policies |
| `invite-user.ts` | Supabase Edge Function — handles user invite emails |
| `SETUP-INSTRUCTIONS.md` | This document |

---

## Role Summary

| Role | Can do |
|---|---|
| **Staff** | Log their own timesheets; view their own records; view dashboard (own data only) |
| **Manager** | Everything Staff can, plus: view all timesheets, amend entries (with reason), manage staff members and locations, invite Staff and Manager users, view audit log |
| **Admin** | Everything Manager can, plus: delete records, invite Admin users, change any user's role, deactivate users |

---

## Part 1 — Supabase Project Setup

### 1.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Choose your organisation, give the project a name (e.g. `gwoc-timesheets`), set a strong database password, and choose a region close to your users (UK = `eu-west-2`).
4. Click **Create new project** and wait for it to provision (about 60 seconds).

---

### 1.2 Run the SQL Setup Script

1. In your Supabase project, go to **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open `supabase-setup.sql` and paste the entire contents into the editor.
4. Click **Run** (or press Cmd/Ctrl + Enter).
5. You should see no errors. If you see a message like `success` or rows affected, it worked.

This creates:
- `profiles`, `staff`, `locations`, `timesheets`, `amendment_log` tables
- All RLS policies
- The `handle_new_user` trigger (auto-creates a profile row on signup)
- Helper functions `get_my_role()` and `get_my_staff_id()`

---

### 1.3 Create Your First Admin User

1. In Supabase, go to **Authentication > Users**.
2. Click **Add user > Create new user**.
3. Enter your email address and a strong password.
4. Click **Create user**.
5. Go back to **SQL Editor** and run the following, replacing the email with yours:

```sql
UPDATE public.profiles
SET role = 'admin', full_name = 'Your Full Name'
WHERE email = 'your-email@example.com';
```

You are now the first admin.

---

### 1.4 Configure Email Settings (for Invite Emails)

By default, Supabase uses a rate-limited shared email service. For production use with real staff invite emails, set up a custom SMTP provider.

1. Go to **Project Settings > Authentication > SMTP Settings**.
2. Enable custom SMTP and enter your provider details (e.g. SendGrid, Resend, Postmark, or your own SMTP server).

> For testing, the default Supabase mailer will work for a small number of invites per hour.

---

### 1.5 Set the Site URL (required for password reset links)

1. Go to **Authentication > URL Configuration**.
2. Set **Site URL** to your GitHub Pages URL, e.g.:
   `https://yourusername.github.io/gwoc-timesheets/`
3. Add the same URL to **Redirect URLs**.

This ensures that password reset and invite links redirect correctly to your hosted page.

---

## Part 2 — Deploy the Edge Function

The Edge Function handles user invites (it uses the Supabase Admin API, which requires the service role key — this must never be in client-side code).

### 2.1 Install the Supabase CLI

If you do not have it:

```bash
# macOS
brew install supabase/tap/supabase

# Windows (via Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Or via npm
npm install -g supabase
```

### 2.2 Link Your Project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is in **Project Settings > General** — it looks like `abcdefghijklmnop`.

### 2.3 Create the Function Files

In your project folder, run:

```bash
supabase functions new invite-user
```

This creates `supabase/functions/invite-user/index.ts`.

Replace the contents of that file with the contents of `invite-user.ts` provided.

### 2.4 Set the Service Role Secret

The Edge Function needs your service role key to create users. **Never put this in your HTML.**

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Find your service role key at: **Project Settings > API > service_role key** (click to reveal).

### 2.5 Deploy the Function

```bash
supabase functions deploy invite-user
```

You should see: `Deployed Function invite-user`

---

## Part 3 — Configure and Deploy the Web App

### 3.1 Add Your Supabase Credentials to index.html

Open `index.html` and find these two lines near the top of the `<script>` section:

```javascript
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace the placeholder strings with your actual values from **Project Settings > API**:

- **Project URL** → `SUPABASE_URL`
- **anon / public** key → `SUPABASE_ANON_KEY`

Example:
```javascript
const SUPABASE_URL      = 'https://abcdefghijklmnop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

> The anon key is safe to include in client-side code. It is public. The service role key is NOT safe and must stay in the Edge Function only.

---

### 3.2 Deploy to GitHub Pages

1. Create a new GitHub repository (can be private or public).
2. Commit `index.html` to the repository root.
3. Go to **Settings > Pages** in the repository.
4. Set Source to `Deploy from a branch`, choose `main`, folder `/` (root).
5. Click **Save**. GitHub Pages will publish the app at:
   `https://yourusername.github.io/repository-name/`

> If you name your repository `gwoc-timesheets`, the URL will be:
> `https://yourusername.github.io/gwoc-timesheets/`

---

## Part 4 — Linking Staff Members to User Accounts

Staff members must be linked to their user account so the app knows which timesheet records belong to them.

### After inviting a staff user and they have accepted:

1. Sign in as admin or manager.
2. Go to the **Staff** tab.
3. Find the staff member and note their name.
4. In Supabase **SQL Editor**, run:

```sql
UPDATE public.staff
SET user_id = (SELECT id FROM auth.users WHERE email = 'staffemail@example.com')
WHERE name = 'Staff Member Name';
```

Replace the email and name with the correct values.

> **Why is this manual?** The staff table represents real-world employees. A staff member may exist before they have a login, and multiple logins could theoretically belong to the same person. The explicit link keeps this clean.

Alternatively, you can add a "Link to user" dropdown in the Staff page — this can be added in a future iteration.

---

## Part 5 — Day-to-Day Usage

### Inviting a New Staff Member

1. Sign in as admin or manager.
2. Go to **Users** tab.
3. Enter their email, full name, and role.
4. Click **Send Invite**.
5. The staff member receives an email with a link to set their password.
6. After they accept, link their account to their staff record (see Part 4).

### Amending a Timesheet

1. Sign in as admin or manager.
2. Go to **Timesheets**.
3. Find the record and click **Edit**.
4. Make changes, then click **Save Changes**.
5. A modal will ask for an amendment reason — this is mandatory.
6. The amendment is saved and recorded in the **Audit Log**.

### Viewing the Audit Log

Go to the **Audit Log** tab. Every amendment is listed with who made it, when, and the reason.

---

## Part 6 — Security Notes

- RLS (Row-Level Security) is enforced at the database level — the app's JavaScript cannot bypass it.
- Staff users genuinely cannot query other users' timesheet data, even with direct API calls using their own token.
- The service role key is only in the Edge Function and is never exposed to the browser.
- The anon key is public but harmless — all it unlocks is the ability to authenticate. RLS controls everything after that.
- Deactivating a user in the Users tab sets `is_active = false` in profiles. For full account suspension, also disable the user in Supabase Dashboard > Authentication > Users (or add a check in your RLS policies for `is_active`).

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Sign-in fails with "Invalid login credentials" | Check email/password. User may not exist yet. |
| "Your account is not linked to a staff member" | Run the SQL link in Part 4 for that user. |
| Invite emails not arriving | Check Supabase SMTP settings. Check spam folder. |
| Edge Function returns 500 | Check that `SUPABASE_SERVICE_ROLE_KEY` secret is set. Run `supabase functions logs invite-user`. |
| RLS errors (permission denied) | Re-run the SQL setup script. Check the user has a profile row with the correct role. |
| Dashboard shows no data | Ensure date filters are not too narrow. Check the logged-in user's role has access. |

---

## Quick Reference — Supabase Dashboard Locations

| What you need | Where to find it |
|---|---|
| Project URL + Anon key | Project Settings > API |
| Service role key | Project Settings > API (reveal) |
| Project ref | Project Settings > General |
| Create users manually | Authentication > Users |
| Run SQL | SQL Editor |
| View table data | Table Editor |
| Edge Function logs | Edge Functions > invite-user > Logs |
