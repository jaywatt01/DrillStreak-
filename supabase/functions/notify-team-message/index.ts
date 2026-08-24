// notify-team-message: fans a new team_messages or team_events row out to
// the right devices via Expo's push API. NOT deployed by pushing this repo
// — Supabase Edge Functions are their own deploy target. See DRILLSTREAK.md
// for the manual steps: deploy this function (`supabase functions deploy
// notify-team-message`, or paste it into the Dashboard's Edge Functions
// editor), then wire a Database Webhook (Dashboard -> Database -> Webhooks)
// on INSERT for both team_messages and team_events, pointed at this
// function's URL. Also requires an Apple Push key in Jay's Apple Developer
// account before iOS delivery actually works — see DRILLSTREAK.md.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function's environment by Supabase — nothing to configure for
// those two. A service-role client bypasses RLS by design here: this
// function needs to read every recipient's push token and every team's
// full roster, which is exactly what RLS exists to restrict for a normal
// client. It never returns any of that data to the caller — a webhook has
// no caller to return it to — it only uses it to decide who to notify.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type WebhookPayload = {
  type: 'INSERT';
  table: 'team_messages' | 'team_events';
  record: Record<string, any>;
};

// Every user connected to a team — the coach, plus every distinct guardian/
// creator of a rostered player. Same membership definition as is_on_team()
// in schema.sql, just expressed as a direct query since this runs with the
// service role, not as an authenticated user (a security-definer RPC would
// evaluate auth.uid() as null here and reject everything).
async function getTeamUserIds(teamId: string): Promise<string[]> {
  const { data: team } = await supabase.from('teams').select('coach_user_id').eq('id', teamId).single();
  const userIds = new Set<string>();
  if (team?.coach_user_id) userIds.add(team.coach_user_id);

  const { data: memberships } = await supabase
    .from('team_memberships')
    .select('players(created_by_user_id, guardianships(guardian_user_id))')
    .eq('team_id', teamId);

  for (const m of memberships ?? []) {
    const player = Array.isArray(m.players) ? m.players[0] : m.players;
    if (!player) continue;
    if (player.created_by_user_id) userIds.add(player.created_by_user_id);
    for (const g of player.guardianships ?? []) {
      if (g.guardian_user_id) userIds.add(g.guardian_user_id);
    }
  }

  return Array.from(userIds);
}

async function getPushTokens(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await supabase.from('push_tokens').select('expo_push_token').in('user_id', userIds);
  return (data ?? []).map((row) => row.expo_push_token as string);
}

// `data` rides along on the push and is what App.tsx's notification-tap
// handler reads to land on the actual conversation/calendar instead of
// just reopening the app on whatever screen was last showing.
async function sendExpoPush(tokens: string[], title: string, body: string, data: Record<string, string>) {
  if (tokens.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default', data }))),
  });
}

Deno.serve(async (req) => {
  const payload = (await req.json()) as WebhookPayload;

  if (payload.table === 'team_messages') {
    const message = payload.record;
    // A pinned-toggle or other UPDATE never reaches here (webhook is
    // INSERT-only), so every call is a genuinely new message.
    const isDirectMessage = message.recipient_user_id != null;
    const recipientIds = isDirectMessage
      ? [message.recipient_user_id as string]
      : (await getTeamUserIds(message.team_id as string)).filter((id) => id !== message.author_user_id);

    const tokens = await getPushTokens(recipientIds);
    const title = isDirectMessage ? 'New private message' : 'New team message';
    // For a DM, the recipient opening this needs the thread with whoever
    // SENT it (the author) — not with themselves, which is what
    // recipient_user_id actually holds from the sender's side of the row.
    const data: Record<string, string> = { teamId: message.team_id as string, view: 'messages' };
    if (isDirectMessage) data.threadUserId = message.author_user_id as string;
    await sendExpoPush(tokens, title, (message.body as string).slice(0, 120), data);
  }

  if (payload.table === 'team_events') {
    const event = payload.record;
    const recipientIds = (await getTeamUserIds(event.team_id as string)).filter(
      (id) => id !== event.created_by_user_id
    );
    const tokens = await getPushTokens(recipientIds);
    await sendExpoPush(tokens, 'New team event', event.title as string, {
      teamId: event.team_id as string,
      view: 'calendar',
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
