// supabase/functions/gwoc-user-admin/index.ts
//
// Handles all admin user operations that require the service role key.
//
// Actions:
//   invite        — send initial invite email to a new user (auto-creates staff record)
//   resend        — resend invite email to an existing pending user
//   archive_user  — disable login + mark archived (soft delete, data preserved)
//   unarchive_user — restore login + mark active
//   delete_user   — PERMANENT removal from Auth + profiles (admin only, nuclear option)
//
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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return json({ version: 'gwoc-user-admin-v4', ok: true });
  }

  try {
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) return json({ error: 'Unauthorised — no token provided' }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's JWT
    let caller = null;
    let verifyErr = '';

    try {
      const r = await adminClient.auth.admin.getUser(token);
      if (r.data?.user) { caller = r.data.user; }
      else verifyErr = r.error?.message ?? 'method 1 null user';
    } catch(e) { verifyErr = String(e); }

    if (!caller && anonKey) {
      try {
        const uc = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
          auth:   { autoRefreshToken: false, persistSession: false },
        });
        const r = await uc.auth.getUser();
        if (r.data?.user) { caller = r.data.user; }
        else verifyErr = r.error?.message ?? 'method 2 null user';
      } catch(e) { verifyErr = String(e); }
    }

    if (!caller) {
      try {
        const uc = createClient(supabaseUrl, serviceRoleKey, {
          global: { headers: { Authorization: authHeader } },
          auth:   { autoRefreshToken: false, persistSession: false },
        });
        const r = await uc.auth.getUser();
        if (r.data?.user) { caller = r.data.user; }
        else verifyErr = r.error?.message ?? 'method 3 null user';
      } catch(e) { verifyErr = String(e); }
    }

    if (!caller) {
      return json({ error: 'Unauthorised — could not verify token', detail: verifyErr }, 401);
    }

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

    let body: Record<string, string> = {};
    try { body = await req.json(); } catch (_) { return json({ error: 'Invalid JSON body' }, 400); }

    const { action } = body;
    if (!action) return json({ error: 'Missing required field: action' }, 400);

    const redirectTo = 'https://ilexlycalopex.github.io/GWOC_Time/';

    // ── INVITE / RESEND ───────────────────────────────────────────────
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

      const userId = inviteData?.user?.id;

      // Ensure profiles row exists
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

        // Auto-create a linked staff record if one doesn't exist for this user
        if (action === 'invite') {
          const { data: existingStaff } = await adminClient
            .from('staff')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();

          if (!existingStaff) {
            await adminClient.from('staff').insert({ name: full_name, user_id: userId });
          }
        }
      }

      return json({ success: true, user_id: userId });
    }

    // ── ARCHIVE USER ─────────────────────────────────────────────────
    if (action === 'archive_user') {
      const { user_id } = body;
      if (!user_id) return json({ error: 'user_id is required' }, 400);
      if (!isAdmin) return json({ error: 'Only admins can archive users' }, 403);
      if (user_id === caller.id) return json({ error: 'You cannot archive your own account' }, 400);

      // Disable their auth login (ban for ~100 years)
      const { error: banErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: '876000h'
      });
      if (banErr) return json({ error: banErr.message }, 400);

      // Mark as archived + inactive in profiles
      await adminClient.from('profiles').update({ is_archived: true, is_active: false }).eq('id', user_id);

      return json({ success: true });
    }

    // ── UNARCHIVE USER ───────────────────────────────────────────────
    if (action === 'unarchive_user') {
      const { user_id } = body;
      if (!user_id) return json({ error: 'user_id is required' }, 400);
      if (!isAdmin) return json({ error: 'Only admins can unarchive users' }, 403);

      // Remove the ban
      const { error: unbanErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: 'none'
      });
      if (unbanErr) return json({ error: unbanErr.message }, 400);

      // Mark as active in profiles
      await adminClient.from('profiles').update({ is_archived: false, is_active: true }).eq('id', user_id);

      return json({ success: true });
    }

    // ── DELETE USER (permanent — admin nuclear option) ────────────────
    if (action === 'delete_user') {
      const { user_id } = body;
      if (!user_id) return json({ error: 'user_id is required' }, 400);
      if (!isAdmin) return json({ error: 'Only admins can remove users' }, 403);
      if (user_id === caller.id) return json({ error: 'You cannot remove your own account' }, 400);

      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteErr) return json({ error: deleteErr.message }, 400);

      await adminClient.from('profiles').delete().eq('id', user_id);

      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error('gwoc-user-admin error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
