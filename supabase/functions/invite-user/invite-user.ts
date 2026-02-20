// supabase/functions/invite-user/index.ts
//
// DEPLOY VIA SUPABASE DASHBOARD (no CLI needed):
// 1. Go to your Supabase project > Edge Functions
// 2. Click "New Function", name it exactly: invite-user
// 3. Paste this entire file into the editor and click Deploy
//
// The SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are automatically
// available as built-in environment variables in every Edge Function —
// you do NOT need to set them manually. Supabase injects them for you.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify the calling user is authenticated and is admin/manager
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorised' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Client using the calling user's JWT (anon key + user token)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callingUser }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !callingUser) {
      return new Response(JSON.stringify({ error: 'Unauthorised' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check calling user's role
    const { data: callerProfile } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', callingUser.id)
      .single();

    if (!callerProfile || !['admin', 'manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'You do not have permission to invite users.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse request body
    const { email, full_name, role } = await req.json();

    if (!email || !full_name || !role) {
      return new Response(JSON.stringify({ error: 'email, full_name and role are required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Managers cannot create admins
    if (role === 'admin' && callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can create admin accounts.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Use service role client to create the invited user
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name,
          role
        },
        redirectTo: `${req.headers.get('origin') || Deno.env.get('SITE_URL') || ''}`
      }
    );

    if (inviteErr) {
      return new Response(JSON.stringify({ error: inviteErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // The profile row is created by the database trigger (handle_new_user).
    // We just return success.
    return new Response(JSON.stringify({ success: true, user_id: inviteData?.user?.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
