-- ============================================================
-- GWOC TIMESHEET SYSTEM — SUPABASE SETUP SCRIPT
-- Run this entire script in: Supabase Dashboard > SQL Editor
-- ============================================================


-- ============================================================
-- STEP 1: PROFILES TABLE
-- Extends Supabase auth.users with role and display name.
-- A row is created automatically when a user is invited.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'staff'
                   CHECK (role IN ('admin', 'manager', 'staff')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

COMMENT ON TABLE public.profiles IS
  'One row per auth user. Stores role (admin/manager/staff) and display name.';


-- ============================================================
-- STEP 2: STAFF TABLE
-- Represents physical staff members (the people whose time is
-- tracked). A staff row may optionally be linked to a user
-- account via user_id, which is how self-service timesheet
-- entry works for the "staff" role.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  role        TEXT,                         -- job title / descriptive role
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_name    ON public.staff(name);
CREATE INDEX IF NOT EXISTS idx_staff_user_id ON public.staff(user_id);

COMMENT ON COLUMN public.staff.user_id IS
  'Link to auth user — allows staff member to log their own timesheets.';


-- ============================================================
-- STEP 3: LOCATIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_name ON public.locations(name);


-- ============================================================
-- STEP 4: TIMESHEETS TABLE
-- Each row = one shift (one date, one start/end, one location).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timesheets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  location_id          UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  date                 DATE NOT NULL,
  start_time           TIME NOT NULL,
  end_time             TIME NOT NULL,
  break_mins           INTEGER NOT NULL DEFAULT 0,
  required_break_mins  INTEGER NOT NULL DEFAULT 0,
  net_hours            NUMERIC(5,2),
  break_warning        BOOLEAN NOT NULL DEFAULT false,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Amendment tracking
  amended_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amended_at           TIMESTAMPTZ,
  amendment_reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_timesheets_staff_id    ON public.timesheets(staff_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date        ON public.timesheets(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_location_id ON public.timesheets(location_id);


-- ============================================================
-- STEP 5: AMENDMENT LOG TABLE
-- Every edit made by a manager or admin is recorded here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.amendment_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  amended_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amendment_log_timesheet_id ON public.amendment_log(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_amendment_log_changed_at   ON public.amendment_log(changed_at);


-- ============================================================
-- STEP 6: HELPER FUNCTION — get current user's role
-- Used in RLS policies below.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Also a helper to get current user's linked staff_id
CREATE OR REPLACE FUNCTION public.get_my_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.staff WHERE user_id = auth.uid() LIMIT 1;
$$;


-- ============================================================
-- STEP 7: ENABLE ROW-LEVEL SECURITY ON ALL TABLES
-- ============================================================

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amendment_log ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- STEP 8: RLS POLICIES — PROFILES
-- ============================================================

-- Users can read their own profile; admins and managers see all
CREATE POLICY "profiles_select"
ON public.profiles FOR SELECT
USING (
  id = auth.uid()
  OR public.get_my_role() IN ('admin', 'manager')
);

-- Users update their own profile; admins can update any
CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE
USING (
  id = auth.uid()
  OR public.get_my_role() = 'admin'
);

-- Only the trigger (service role) inserts profiles — no user INSERT policy needed
-- Admins can insert manually if needed
CREATE POLICY "profiles_insert_admin"
ON public.profiles FOR INSERT
WITH CHECK (public.get_my_role() = 'admin');


-- ============================================================
-- STEP 9: RLS POLICIES — STAFF
-- ============================================================

-- Everyone authenticated can read staff
CREATE POLICY "staff_select_all"
ON public.staff FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Only admins and managers can insert, update, delete
CREATE POLICY "staff_insert_admin_manager"
ON public.staff FOR INSERT
WITH CHECK (public.get_my_role() IN ('admin', 'manager'));

CREATE POLICY "staff_update_admin_manager"
ON public.staff FOR UPDATE
USING (public.get_my_role() IN ('admin', 'manager'));

CREATE POLICY "staff_delete_admin_manager"
ON public.staff FOR DELETE
USING (public.get_my_role() IN ('admin', 'manager'));


-- ============================================================
-- STEP 10: RLS POLICIES — LOCATIONS
-- ============================================================

CREATE POLICY "locations_select_all"
ON public.locations FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "locations_write_admin_manager"
ON public.locations FOR INSERT
WITH CHECK (public.get_my_role() IN ('admin', 'manager'));

CREATE POLICY "locations_update_admin_manager"
ON public.locations FOR UPDATE
USING (public.get_my_role() IN ('admin', 'manager'));

CREATE POLICY "locations_delete_admin_manager"
ON public.locations FOR DELETE
USING (public.get_my_role() IN ('admin', 'manager'));


-- ============================================================
-- STEP 11: RLS POLICIES — TIMESHEETS
-- Key rule: staff can only see their OWN records.
--           admins and managers can see ALL records.
-- ============================================================

-- SELECT: staff see only their own; admins/managers see all
CREATE POLICY "timesheets_select"
ON public.timesheets FOR SELECT
USING (
  public.get_my_role() IN ('admin', 'manager')
  OR staff_id = public.get_my_staff_id()
);

-- INSERT: staff insert only for their own staff_id
CREATE POLICY "timesheets_insert"
ON public.timesheets FOR INSERT
WITH CHECK (
  public.get_my_role() IN ('admin', 'manager')
  OR staff_id = public.get_my_staff_id()
);

-- UPDATE: only admins and managers can amend timesheets
CREATE POLICY "timesheets_update_admin_manager"
ON public.timesheets FOR UPDATE
USING (public.get_my_role() IN ('admin', 'manager'));

-- DELETE: only admins can delete timesheets
CREATE POLICY "timesheets_delete_admin"
ON public.timesheets FOR DELETE
USING (public.get_my_role() = 'admin');


-- ============================================================
-- STEP 12: RLS POLICIES — AMENDMENT LOG
-- ============================================================

-- Admins and managers can read the audit log
CREATE POLICY "amendment_log_select"
ON public.amendment_log FOR SELECT
USING (public.get_my_role() IN ('admin', 'manager'));

-- Admins and managers can insert into the audit log
CREATE POLICY "amendment_log_insert"
ON public.amendment_log FOR INSERT
WITH CHECK (public.get_my_role() IN ('admin', 'manager'));


-- ============================================================
-- STEP 13: TRIGGER — auto-create profile on user signup
-- This fires when Supabase Auth creates a new user.
-- It reads the user's metadata (full_name, role) which is set
-- by the Edge Function invite-user.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- STEP 14: SEED YOUR FIRST ADMIN USER
-- After running this script, go to Supabase Dashboard >
-- Authentication > Users > Add User. Create your first user
-- manually (you will need an email and a password).
-- Then run the following, replacing the values:
-- ============================================================

-- IMPORTANT: Run this AFTER creating your first user in the Auth UI
-- Replace 'your-email@example.com' with the email you used
/*
UPDATE public.profiles
SET role = 'admin', full_name = 'Your Name'
WHERE email = 'your-email@example.com';
*/


-- ============================================================
-- DONE.
-- ============================================================
