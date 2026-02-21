// supabase/functions/gwoc-user-admin/index.ts
//
// Handles all admin user operations that require the service role key,
// keeping that key off the browser entirely.
//
// Actions (passed as JSON body field "action"):
//   invite       — send initial invite email to a new user
//   resend       — resend invite email to an existing pending user
//   delete_user  — permanently remove a user from Auth + profiles
//
// DEPLOY:
//   1. Supabase Dashboard > Edge Functions > New Function
//   2. Name it exactly:  gwoc-user-admin
//   3. Paste this file and click Deploy
//
// ENV VARS (all auto-injected by Supabase — no manual setup needed):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {

  // ── CORS preflight ────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Version stamp — confirms this deployment is live
  if (req.method === 'GET') {
    return json({ version: 'gwoc-user-admin-v3', ok: true });
  }

  try {
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    console.log('[v3] env — URL:', !!supabaseUrl, 'SRK:', !!serviceRoleKey, 'ANON:', !!anonKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace(/^Bearer\s+/i, '').trim();

    console.log('[v3] token length:', token.length, 'prefix:', token.slice(0, 20));

    if (!token) return json({ error: 'Unauthorised — no token provided' }, 401);

    // Admin client for privileged operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's JWT.
    // Try three methods in order — Supabase version differences mean one
    // approach may work where another fails.
    let caller = null;
    let verifyErr = '';

    // Method 1: admin.getUser with explicit token
    try {
      const r = await adminClient.auth.admin.getUser(token);
      if (r.data?.user) { caller = r.data.user; console.log('[v3] verified via method 1'); }
      else verifyErr = r.error?.message ?? 'method 1 null user';
    } catch(e) { verifyErr = String(e); }

    // Method 2: user-scoped client with anon key
    if (!caller && anonKey) {
      try {
        const uc = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
          auth:   { autoRefreshToken: false, persistSession: false },
        });
        const r = await uc.auth.getUser();
        if (r.data?.user) { caller = r.data.user; console.log('[v3] verified via method 2'); }
        else verifyErr = r.error?.message ?? 'method 2 null user';
      } catch(e) { verifyErr = String(e); }
    }

    // Method 3: user-scoped client with service role key carrying user header
    if (!caller) {
      try {
        const uc = createClient(supabaseUrl, serviceRoleKey, {
          global: { headers: { Authorization: authHeader } },
          auth:   { autoRefreshToken: false, persistSession: false },
        });
        const r = await uc.auth.getUser();
        if (r.data?.user) { caller = r.data.user; console.log('[v3] verified via method 3'); }
        else verifyErr = r.error?.message ?? 'method 3 null user';
      } catch(e) { verifyErr = String(e); }
    }

    console.log('[v3] caller:', caller?.id ?? 'none', 'lastErr:', verifyErr);

    if (!caller) {
      return json({ error: 'Unauthorised — could not verify token', detail: verifyErr }, 401);
    }

    // ── Check caller role ─────────────────────────────────────────────
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', caller.id)
      .single();

    if (profileErr || !callerProfile) {
      return json({ error: 'Could not verify your role' }, 403);
    }

    const callerRole = callerProfile.role as string;
    const isAdmin    = callerRole === 'admin';
    const isMgr      = callerRole === 'manager';

    if (!isAdmin && !isMgr) {
      return json({ error: 'You do not have permission to manage users' }, 403);
    }

    // ── Parse request body ────────────────────────────────────────────
    let body: Record<string, string> = {};
    try { body = await req.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400); }

    const { action } = body;
    if (!action) return json({ error: 'Missing required field: action' }, 400);

    // Hardcode the full app path — origin alone gives https://ilexlycalopex.github.io
    // which 404s because the app lives at /GWOC_Time/
    const redirectTo = 'https://ilexlycalopex.github.io/GWOC_Time/';

    // ── INVITE ────────────────────────────────────────────────────────
    if (action === 'invite' || action === 'resend') {
      const { email, full_name, role } = body;

      if (!email || !full_name || !role) {
        return json({ error: 'email, full_name and role are all required' }, 400);
      }

      const validRoles = ['staff', 'manager', 'admin'];
      if (!validRoles.includes(role)) {
        return json({ error: `role must be one of: ${validRoles.join(', ')}` }, 400);
      }

      if (role === 'admin' && !isAdmin) {
        return json({ error: 'Only admins can create admin accounts' }, 403);
      }

      const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        { data: { full_name, role }, redirectTo }
      );

      if (inviteErr) return json({ error: inviteErr.message }, 400);

      // Belt-and-braces: ensure profiles row exists (trigger should create it,
      // but creates it manually if the trigger isn't installed)
      const userId = inviteData?.user?.id;
      if (userId) {
        const { error: profileCheckErr } = await adminClient
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .single();

        if (profileCheckErr?.code === 'PGRST116') {
          await adminClient.from('profiles').insert({
            id: userId, email, full_name, role, is_active: true,
          });
        }
      }

      return json({ success: true, user_id: userId });
    }

    // ── DELETE USER ───────────────────────────────────────────────────
    if (action === 'delete_user') {
      const { user_id } = body;
      if (!user_id) return json({ error: 'user_id is required' }, 400);

      // Only admins can delete users
      if (!isAdmin) return json({ error: 'Only admins can remove users' }, 403);

      // Prevent self-deletion
      if (user_id === caller.id) return json({ error: 'You cannot remove your own account' }, 400);

      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteErr) return json({ error: deleteErr.message }, 400);

      // Explicit profile cleanup (cascade should handle it, this is a fallback)
      await adminClient.from('profiles').delete().eq('id', user_id);

      return json({ success: true });
    }

    // ── Unknown action ────────────────────────────────────────────────
    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error('gwoc-user-admin error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
