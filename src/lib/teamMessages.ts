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
};

export async function listMyTeams(): Promise<MyTeam[]> {
  const { data, error } = await supabase.rpc('list_my_teams');
  if (error) throw error;
  return (data ?? []).map((row: { id: string; name: string; invite_code: string | null; role: TeamRole }) => ({
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    role: row.role,
  }));
}

export type TeamContact = { userId: string; label: string };

// Role-based labels only ("Coach", "Parent of Jayden") — never an email —
// so a DM picker can't be used to harvest another family's contact info.
export async function listTeamContacts(teamId: string): Promise<TeamContact[]> {
  const { data, error } = await supabase.rpc('list_team_contacts', { p_team_id: teamId });
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string; label: string }) => ({ userId: row.user_id, label: row.label }));
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
};

const TEAM_MESSAGE_COLUMNS =
  'id, team_id, author_user_id, recipient_user_id, parent_message_id, body, media_url, pinned, created_at';

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
