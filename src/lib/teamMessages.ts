import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Set true only once the app's upload/display UI actually exists AND the
// media-release gate in DRILLSTREAK.md has been switched on (Brandon's
// legal review, or Jay's explicit override) — the schema/storage-bucket
// side is already live regardless of this flag. See schema.sql's
// team_messages/team-media comments for the full reasoning.
export const TEAM_MEDIA_ENABLED = false;

export type TeamRole = 'coach' | 'guardian';

export type MyTeam = {
  id: string;
  name: string;
  inviteCode: string | null; // null for a guardian-role row — coach-only, matches teams RLS
  role: TeamRole;
  // True for a self-signed-up player (is_player_restricted in schema.sql)
  // — can read the team-wide feed, but can only ever message the coach
  // directly, never post to the group or DM another family.
  restricted: boolean;
};

export async function listMyTeams(): Promise<MyTeam[]> {
  const { data, error } = await supabase.rpc('list_my_teams');
  if (error) throw error;
  return (
    data ?? []
  ).map((row: { id: string; name: string; invite_code: string | null; role: TeamRole; restricted: boolean }) => ({
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    role: row.role,
    restricted: row.restricted,
  }));
}

export type TeamContact = { userId: string; label: string; role: TeamRole };

// Role-based labels only ("Coach", "Parent of Jayden") — never an email —
// so a DM picker can't be used to harvest another family's contact info.
// `role` lets a caller reliably find "the coach" entry without matching
// the label string, which breaks once a coach sets their own display_name.
export async function listTeamContacts(teamId: string): Promise<TeamContact[]> {
  const { data, error } = await supabase.rpc('list_team_contacts', { p_team_id: teamId });
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string; label: string; role: TeamRole }) => ({
    userId: row.user_id,
    label: row.label,
    role: row.role,
  }));
}

export type TeamMessage = {
  id: string;
  teamId: string;
  authorUserId: string;
  recipientUserId: string | null; // null = team-wide, set = a private 1:1
  parentMessageId: string | null;
  body: string;
  mediaUrl: string | null;
  pinned: boolean;
  createdAt: string;
  // Set together, always both or neither (see shareBadgeToTeam below) —
  // when set, TeamBoardScreen renders this row as a badge card instead of
  // plain body text. expiresAt isn't exposed here: team_messages_select
  // RLS already stops returning an expired row to anyone, so by the time
  // a badge message reaches the client it's always still valid — nothing
  // downstream needs to re-check it.
  badgeType: string | null;
  badgeLabel: string | null;
  // Which linked player this badge share is for — set only alongside
  // badgeType/badgeLabel. Added 2026-08-25 alongside the share-once-per-
  // season lock: without it, a parent with two players on the same team
  // would have both kids' badge shares look identical (same author,
  // team, badge_type), and sharing kid A's 30-day badge would wrongly
  // lock out sharing kid B's.
  playerId: string | null;
};

const TEAM_MESSAGE_COLUMNS =
  'id, team_id, author_user_id, recipient_user_id, parent_message_id, body, media_url, pinned, created_at, badge_type, badge_label, player_id';

function mapMessageRow(row: {
  id: string;
  team_id: string;
  author_user_id: string;
  recipient_user_id: string | null;
  parent_message_id: string | null;
  body: string;
  media_url: string | null;
  pinned: boolean;
  created_at: string;
  badge_type: string | null;
  badge_label: string | null;
  player_id: string | null;
}): TeamMessage {
  return {
    id: row.id,
    teamId: row.team_id,
    authorUserId: row.author_user_id,
    recipientUserId: row.recipient_user_id,
    parentMessageId: row.parent_message_id,
    body: row.body,
    mediaUrl: row.media_url,
    pinned: row.pinned,
    createdAt: row.created_at,
    badgeType: row.badge_type,
    badgeLabel: row.badge_label,
    playerId: row.player_id,
  };
}

// Everything this account is allowed to see for a team, in one fetch: the
// team-wide feed plus every DM thread they're part of on it (RLS already
// scopes this to exactly what team_messages_select permits — no separate
// "which DMs am I in" query needed). Oldest first, so a chat-style view can
// render top-to-bottom without re-sorting.
export async function getTeamMessages(teamId: string): Promise<TeamMessage[]> {
  const { data, error } = await supabase
    .from('team_messages')
    .select(TEAM_MESSAGE_COLUMNS)
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapMessageRow);
}

export async function sendTeamMessage(
  teamId: string,
  body: string,
  options?: { recipientUserId?: string; parentMessageId?: string }
): Promise<TeamMessage> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('team_messages')
    .insert({
      team_id: teamId,
      author_user_id: userId,
      recipient_user_id: options?.recipientUserId ?? null,
      parent_message_id: options?.parentMessageId ?? null,
      body,
    })
    .select(TEAM_MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return mapMessageRow(data);
}

// Posts a badge as a team-wide card (recipient_user_id null — a badge
// brag is for the whole team, never a DM) that stops showing up 24h from
// now. Reuses the exact same insert path/RLS as a normal team-wide post —
// a restricted account (self-signed-up player) that can't post to the
// group feed can't share a badge to it either, same adults-only-group
// boundary as everything else, not a special case carved out for this.
export async function shareBadgeToTeam(
  teamId: string,
  playerId: string,
  badgeType: string,
  badgeLabel: string
): Promise<TeamMessage> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('team_messages')
    .insert({
      team_id: teamId,
      author_user_id: userId,
      body: badgeLabel,
      badge_type: badgeType,
      badge_label: badgeLabel,
      expires_at: expiresAt,
      player_id: playerId,
    })
    .select(TEAM_MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return mapMessageRow(data);
}

// The share-once-per-season lock Jay asked for (2026-08-25): a badge can
// only be shared to a given team once per season, then it's locked until
// a new season starts. Can't just query team_messages directly for this —
// team_messages_select RLS stops returning a share once its 24h
// expires_at passes, which is exactly the window this needs to see PAST
// (a share from 3 days ago has to still count as "already shared," even
// though it's no longer visible on the board). So this goes through a
// security-definer function (see schema.sql) that does its own explicit
// check, scoped server-side to the caller's own author_user_id so it can
// only ever answer "did I already share this," never anyone else's.
// `since` is the active season's startedAt when one exists, or the epoch
// (effectively "ever") when it doesn't — no season concept yet means no
// boundary to unlock it, so it stays locked after the first share.
export async function hasSharedBadgeSince(
  playerId: string,
  teamId: string,
  badgeType: string,
  since: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_shared_badge_since', {
    p_player_id: playerId,
    p_team_id: teamId,
    p_badge_type: badgeType,
    p_since: since,
  });
  if (error) throw error;
  return data === true;
}

export async function deleteTeamMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from('team_messages').delete().eq('id', messageId);
  if (error) throw error;
}

// Coach-only per team_messages_update RLS — pins/unpins a team-wide
// announcement so it can be surfaced above the regular feed.
export async function setTeamMessagePinned(messageId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('team_messages').update({ pinned }).eq('id', messageId);
  if (error) throw error;
}

// Live delivery for the board — Supabase Realtime respects team_messages_
// select RLS on its own, so this only ever streams rows the caller could
// already read via a normal fetch; no separate authorization here. Returns
// the channel so the caller can unsubscribe on unmount.
export function subscribeToTeamMessages(teamId: string, onInsert: (message: TeamMessage) => void): RealtimeChannel {
  return supabase
    .channel(`team_messages:${teamId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` },
      (payload) => onInsert(mapMessageRow(payload.new as Parameters<typeof mapMessageRow>[0]))
    )
    .subscribe();
}
