// supabase/functions/admin-invite/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://ilexlycalopex.github.io",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

type InviteBody = {
  email: string;
  full_name: string;
  role?: "staff" | "manager" | "admin";
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, 405, { error: "Method not allowed" });
  }

  const supabaseUrl      = Deno.env.get("SUPABASE_URL")!;
  const anonKey          = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller client — tied to the JWT in the request, respects RLS
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Verify the caller is authenticated
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json(req, 401, { error: "Unauthorised" });

  // Check the caller's profile — must be an active admin
  const { data: callerProfile, error: profErr } = await callerClient
    .from("profiles")
    .select("role, active")
    .eq("user_id", caller.id)
    .single();

  if (profErr || !callerProfile?.active) return json(req, 403, { error: "Forbidden" });
  if (callerProfile.role !== "admin")     return json(req, 403, { error: "Admin only" });

  // Parse body
  let body: InviteBody;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Invalid JSON" });
  }

  const email    = (body.email    || "").trim().toLowerCase();
  const fullName = (body.full_name || "").trim();
  const role     = body.role ?? "staff";

  if (!email || !email.includes("@"))             return json(req, 400, { error: "Valid email required" });
  if (!fullName)                                  return json(req, 400, { error: "full_name required" });
  if (!["staff", "manager", "admin"].includes(role)) return json(req, 400, { error: "Invalid role" });

  // Admin client for privileged operations
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Invite user — Supabase sends them a magic link to set their password
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  if (inviteErr || !invited?.user) {
    return json(req, 400, { error: inviteErr?.message ?? "Invite failed" });
  }

  const newUserId = invited.user.id;

  // Upsert the profile row (safe even if a trigger already created it)
  const { error: upsertErr } = await adminClient
    .from("profiles")
    .upsert(
      { user_id: newUserId, full_name: fullName, email, role, active: true },
      { onConflict: "user_id" }
    );

  if (upsertErr) return json(req, 500, { error: upsertErr.message });

  return json(req, 200, { ok: true, user_id: newUserId, email, role });
});
