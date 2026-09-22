// delete-account: permanently deletes the calling user's own account and
// every row that's genuinely theirs. Callable only by the account being
// deleted -- the user id is derived from their own JWT (Authorization
// header, verified via Supabase Auth), never taken from anything the
// client sends in the request body, so there is no way to pass someone
// else's id and delete their account instead. Built 2026-09-22 for Apple's
// guideline 5.1.1(v) rejection (DRILLSTREAK.md) -- account creation existed
// with no in-app deletion path at all before this.
//
// Does the actual cleanup by relying on the ON DELETE CASCADE / SET NULL
// fixes already applied to every FK referencing auth.users(id) -- see the
// 2026-09-22 migration block at the end of supabase/schema.sql for exactly
// what each column does and why (CASCADE for the caller's own private
// data, SET NULL for rows shared with other people, e.g. a custom drill
// other players still have completions logged against, or team chat
// history the rest of the team still relies on). One
// auth.admin.deleteUser() call is all this needs -- Postgres does the rest,
// correctly, at the database level. Forced-scenario tested (two temp
// accounts, a team, a roster player, a private note, a custom drill with a
// logged completion, a team-wide message, and a private DM, inside
// begin/rollback) before this function was written.
//
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are
// auto-injected into every Edge Function's environment by Supabase --
// nothing to configure for those three.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // A client scoped to the caller's own token -- getUser() verifies the JWT
  // and returns exactly the account it belongs to. This is the ONLY source
  // of the user id this function ever acts on; the request body is never
  // trusted for identity.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
