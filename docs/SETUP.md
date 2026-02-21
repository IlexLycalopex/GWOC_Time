# GWOC Timesheet System — Setup Guide

This guide takes you from zero to a fully working deployment. Estimated time: 20–30 minutes.

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier is sufficient)
- A [GitHub](https://github.com) account (for GitHub Pages hosting)
- A text editor

---

## Step 1 — Create a Supabase Project

1. Log in to [supabase.com](https://supabase.com) and click **New Project**
2. Choose an organisation, set a project name (e.g. `gwoc-timesheet`), choose a region close to your users, and set a database password (save it somewhere safe)
3. Wait for the project to finish provisioning (1–2 minutes)

---

## Step 2 — Configure Authentication

In the Supabase Dashboard:

1. Go to **Authentication → URL Configuration**
2. Set **Site URL** to your deployment URL, e.g.:
   `https://yourusername.github.io/GWOC_Time/`
3. Under **Redirect URLs**, add the same URL:
   `https://yourusername.github.io/GWOC_Time/`
4. Go to **Authentication → Email Templates** if you want to customise the invite email subject/body (optional)

> **Important:** The trailing slash in the URL is required.

---

## Step 3 — Run the Database Schema

1. In the Supabase Dashboard, go to **SQL Editor**
2. Click **New query**
3. Open `supabase/schema.sql` from this repo and paste the entire contents into the editor
4. Click **Run**

You should see success messages for each statement. This creates:
- `profiles` table (linked to Supabase Auth users)
- `staff` table (physical employee records)
- `locations` table
- `timesheets` table
- `amendment_log` table
- Row Level Security policies for all tables
- A trigger that auto-creates a `profiles` row when a new auth user is invited

---

## Step 4 — Deploy the Edge Function

The Edge Function handles user invitation and deletion using the service role key, keeping it off the browser entirely.

1. In the Supabase Dashboard, go to **Edge Functions**
2. Click **New Function**
3. Name it exactly: `gwoc-user-admin` (the name must match exactly)
4. Replace the default code with the contents of `supabase/functions/gwoc-user-admin/index.ts`
5. **Before deploying**, find this line in the function and update the URL to match your deployment:
   ```typescript
   const redirectTo = 'https://yourusername.github.io/GWOC_Time/';
   ```
6. Click **Deploy**
7. Once deployed, go to the function's **Details** tab and ensure **"Enforce JWT Verification"** is toggled **OFF**
   - The function handles its own auth verification internally — the gateway-level check will reject valid user JWTs in some Supabase configurations

> **Environment variables:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are all auto-injected by Supabase — no manual configuration is needed.

---

## Step 5 — Configure index.html

Open `index.html` and find the `CONFIGURATION` section near the top of the `<script>` block (around line 670):

```javascript
const SUPABASE_URL      = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Replace the placeholder values with your project's credentials. Find these in:

**Supabase Dashboard → Project Settings → API**

- **SUPABASE_URL** — the Project URL (e.g. `https://abcdefghijkl.supabase.co`)
- **SUPABASE_ANON_KEY** — the `anon` / `public` key (the long JWT string)

> Do **not** use the `service_role` key here. The anon key is safe to include in browser code.

---

## Step 6 — Deploy to GitHub Pages

1. Create a new GitHub repository (can be public or private with Pages enabled)
2. Push the repo contents, or at minimum `index.html`, to the `main` branch
3. Go to **Settings → Pages** in your repository
4. Under **Source**, select **Deploy from a branch**, choose `main`, and set the folder to `/ (root)`
5. Click **Save**
6. GitHub will publish the site — the URL will be shown in the Pages settings (typically `https://yourusername.github.io/REPO_NAME/`)

> If your repo name differs from `GWOC_Time`, update the URL in both the Supabase Auth configuration (Step 2) and the Edge Function (Step 4).

---

## Step 7 — Create the First Admin User

The system has no sign-up page — all users are invited. To bootstrap the first admin:

1. Go to **Supabase Dashboard → Authentication → Users**
2. Click **Add user → Create new user**
3. Enter the admin's email and a temporary password
4. The user will be created but will not yet have a `profiles` row

Now run this in the **SQL Editor**, replacing the values:

```sql
INSERT INTO profiles (id, email, full_name, role, is_active)
SELECT id, email, 'Your Name', 'admin', true
FROM auth.users
WHERE email = 'your-admin@example.com';
```

5. The admin can now sign in at your deployment URL and change their password via **Forgotten your password? Reset it**

Alternatively, run the invite flow from the Supabase Dashboard once a first admin exists, or use the SQL approach above for bootstrapping.

---

## Step 8 — Verify the Setup

1. Visit your deployment URL
2. Sign in with the admin credentials
3. You should see the app with all tabs visible (Dashboard, Timesheets, Locations, Users, Audit Log)
4. Go to **Locations** and add at least one location
5. Go to **Users → Staff Records** and add a staff member
6. Go to **Users → User Accounts** and send an invite to a test email
7. Click the invite link from the email — you should see "Welcome — set your password"
8. Set a password — you should be redirected into the app as the invited user

---

## Troubleshooting

**Invite link shows 404**
The `redirectTo` URL in the Edge Function does not match your deployment URL. Update it and redeploy.

**Invite link shows Sign In instead of Set Password**
Ensure `flowType: 'implicit'` is set in the Supabase client config in `index.html`. PKCE flow does not work on static hosts.

**"Invalid JWT" when inviting users**
The Edge Function has JWT verification enabled at the gateway level. Go to Edge Functions → gwoc-user-admin → Details and toggle "Enforce JWT Verification" off.

**App shows "Connecting — please wait" for a long time**
Supabase free-tier projects pause after inactivity and take 5–20 seconds to wake. The app retries automatically for up to 40 seconds. This only affects the first request after a period of inactivity.

**Staff user sees "No staff record linked" warning**
Go to Users → User Accounts and use the "Linked Staff Record" dropdown to link the user's login account to their staff record.

**CSV export is empty**
Ensure at least one timesheet has been saved. Check that the date filters are not excluding your records.

---

## Updating

To update the application, replace `index.html` with the new version and push to GitHub. If the database schema has changed, run only the new/changed SQL statements in the SQL Editor — do not re-run the full schema as it will fail on existing tables.

Edge Function updates are deployed via the Supabase Dashboard (paste the new code and click Deploy).
