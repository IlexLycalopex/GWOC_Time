-- ============================================================
-- GWOC TIMESHEET SYSTEM — Supabase Schema
-- ============================================================
-- Run this entire script in Supabase Dashboard → SQL Editor
-- Safe to run on a fresh project. Do NOT re-run on an existing
-- project with data — use individual ALTER statements instead.
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- PROFILES
-- Mirrors auth.users. Auto-created by trigger on invite.
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  role        text        NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','manager','admin')),
  is_active   boolean     NOT NULL DEFAULT true,
  phone       text,                              -- Optional contact phone number
  is_archived boolean     NOT NULL DEFAULT false, -- Soft-delete: preserves data, blocks login
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ⚠️  IMPORTANT: profiles policies must NOT self-reference the profiles table.
-- Doing so causes "infinite recursion detected in policy for relation profiles".
-- Instead, use a SECURITY DEFINER function that bypasses RLS when reading the
-- caller's own role.
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- Users can read their own profile; admins/managers can read all profiles
-- Uses my_role() to avoid self-referencing profiles (infinite recursion)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.my_role() IN ('admin', 'manager')
  );

-- Users can update their own profile (e.g. display name)
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Only admins/managers can update other profiles (role changes, deactivation)
-- Uses my_role() to avoid self-referencing profiles (infinite recursion)
CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE TO authenticated
  USING (
    public.my_role() IN ('admin', 'manager')
  );

-- Profiles are inserted by the trigger (runs as SECURITY DEFINER)
-- and by the Edge Function (uses service role key, bypasses RLS)
-- No INSERT policy needed for authenticated users directly


-- ============================================================
-- STAFF
-- Physical employee records. Separate from auth users.
-- A staff member may exist without a login account.
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL,
  role        text,                          -- Job title, optional
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read staff records (needed for shift logging)
CREATE POLICY "staff_select" ON staff
  FOR SELECT TO authenticated USING (true);

-- Only managers and admins can insert/update/delete staff records
CREATE POLICY "staff_write" ON staff
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );


-- ============================================================
-- LOCATIONS
-- Work locations selectable when logging a shift.
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL,
  icon        text        DEFAULT '📍',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read locations
CREATE POLICY "locations_select" ON locations
  FOR SELECT TO authenticated USING (true);

-- Only managers and admins can write locations
CREATE POLICY "locations_write" ON locations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );


-- ============================================================
-- TIMESHEETS
-- One row per shift. Multiple rows per submission are normal.
-- ============================================================
CREATE TABLE IF NOT EXISTS timesheets (
  id                    uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id              uuid          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  location_id           uuid          REFERENCES locations(id) ON DELETE SET NULL,
  date                  date          NOT NULL,
  start_time            time          NOT NULL,
  end_time              time          NOT NULL,
  break_mins            integer       NOT NULL DEFAULT 0,
  required_break_mins   integer       NOT NULL DEFAULT 0,
  net_hours             numeric(5,2),
  break_warning         boolean       NOT NULL DEFAULT false,
  created_by            uuid          NOT NULL REFERENCES auth.users(id),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  amended_by            uuid          REFERENCES auth.users(id),
  amended_at            timestamptz,
  amendment_reason      text,
  deleted_at            timestamptz,                         -- Soft delete timestamp (NULL = active)
  deleted_by            uuid          REFERENCES auth.users(id) -- Who deleted the record
);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

-- Staff can read their own timesheets (via linked staff record)
CREATE POLICY "timesheets_select_own" ON timesheets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      WHERE s.id = timesheets.staff_id
      AND s.user_id = auth.uid()
    )
  );

-- Managers and admins can read all timesheets
CREATE POLICY "timesheets_select_admin" ON timesheets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );

-- Staff can insert timesheets for their own linked staff record only
CREATE POLICY "timesheets_insert_own" ON timesheets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff s
      WHERE s.id = timesheets.staff_id
      AND s.user_id = auth.uid()
    )
  );

-- Managers and admins can insert timesheets for any staff member
CREATE POLICY "timesheets_insert_admin" ON timesheets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );

-- Only managers and admins can update timesheets (amendments)
CREATE POLICY "timesheets_update" ON timesheets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );

-- Only admins can hard-delete timesheets (direct DB access).
-- NOTE: the application uses soft-delete (UPDATE deleted_at) rather than DELETE.
-- This policy is retained for DB-level cleanup by admins only.
CREATE POLICY "timesheets_delete" ON timesheets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'admin'
    )
  );


-- ============================================================
-- AMENDMENT LOG
-- Append-only audit trail for all amendments and soft-deletions.
-- Written on every amendment AND when a record is soft-deleted.
-- timesheet_id is SET NULL if the referenced row is ever hard-deleted.
-- ============================================================
CREATE TABLE IF NOT EXISTS amendment_log (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  timesheet_id  uuid        REFERENCES timesheets(id) ON DELETE SET NULL,
  amended_by    uuid        NOT NULL REFERENCES auth.users(id),
  reason        text        NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE amendment_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read the audit log
CREATE POLICY "amendment_log_select" ON amendment_log
  FOR SELECT TO authenticated USING (true);

-- Managers and admins can insert audit log entries
CREATE POLICY "amendment_log_insert" ON amendment_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin','manager')
    )
  );

-- No updates or deletes on the audit log — it is append-only


-- ============================================================
-- TRIGGER: auto-create profiles row on user invite
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    true
  )
  ON CONFLICT (id) DO NOTHING;   -- Edge Function may have already created the row
  RETURN NEW;
END;
$$;

-- Drop and recreate to ensure the trigger is current
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- INDEXES (performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_timesheets_staff_id     ON timesheets(staff_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date          ON timesheets(date DESC);
CREATE INDEX IF NOT EXISTS idx_timesheets_location_id   ON timesheets(location_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_deleted_at    ON timesheets(deleted_at);  -- Soft-delete filter
CREATE INDEX IF NOT EXISTS idx_amendment_log_timesheet  ON amendment_log(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_amendment_log_changed_at ON amendment_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_user_id            ON staff(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_is_archived     ON profiles(is_archived);


-- ============================================================
-- DONE
-- ============================================================
-- Tables created:
--   profiles, staff, locations, timesheets, amendment_log
-- RLS enabled on all tables with per-role policies
-- Trigger: on_auth_user_created → handle_new_user()
-- Indexes created for common query patterns
--
-- Key design notes:
--   - Timesheets use soft-delete: deleted_at/deleted_by columns;
--     app filters WHERE deleted_at IS NULL. Data is never lost.
--   - Users use soft-archive: is_archived flag + Supabase ban.
--   - profiles SELECT/UPDATE policies use public.my_role() (SECURITY DEFINER)
--     to avoid infinite recursion — never use EXISTS(SELECT FROM profiles)
--     inside a profiles policy.
--   - Edge Function (gwoc-user-admin) requires verify_jwt=false.
-- ============================================================
