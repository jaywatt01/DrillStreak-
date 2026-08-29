import { supabase } from './supabase';

// Off by default. Two separate reasons it has to stay off, not one:
// (1) legal — a coach uploading their school's official mascot or a
// sponsor's logo they don't own the rights to is DrillStreak hosting
// someone else's IP, which needs a ToS uploader-warranty clause and a
// DMCA agent registered with the U.S. Copyright Office before this can
// go live (see DRILLSTREAK.md); (2) technical — the actual "pick a
// photo" UI needs expo-image-picker, a new native dependency not yet
// installed, so flipping this on is also a native-rebuild decision, not
// just a flag flip. The schema/storage/RLS/this file are already fully
// live-ready regardless — same "build once, flip later" shape already
// used for TEAM_MEDIA_ENABLED (teamMessages.ts/teamMedia.ts). Nothing
// calls into this file from any screen yet.
export const TEAM_LOGO_ENABLED = false;

// Uploads a local file (a picked image URI) into the team-logos bucket at
// {teamId}/logo.{ext} — one logo per team, upsert:true so a re-upload
// replaces the old file instead of accumulating copies. The storage RLS
// in schema.sql reads teamId straight out of that path. Updates
// teams.logo_url to the resulting path (not a public URL — see
// getTeamLogoUrl below) and returns it.
export async function uploadTeamLogo(teamId: string, fileUri: string, fileExtension: string): Promise<string> {
  if (!TEAM_LOGO_ENABLED) {
    throw new Error('Team logos are not enabled yet.');
  }

  const path = `${teamId}/logo.${fileExtension}`;
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage.from('team-logos').upload(path, blob, { upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase.from('teams').update({ logo_url: path }).eq('id', teamId);
  if (updateError) throw updateError;

  return path;
}

// Signed URL, not a public one — the bucket is private, so every render
// needs a fresh short-lived URL rather than a stored permanent one, same
// pattern as getTeamMediaUrl in teamMedia.ts.
export async function getTeamLogoUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  if (!TEAM_LOGO_ENABLED) {
    throw new Error('Team logos are not enabled yet.');
  }
  const { data, error } = await supabase.storage.from('team-logos').createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteTeamLogo(teamId: string, path: string): Promise<void> {
  if (!TEAM_LOGO_ENABLED) {
    throw new Error('Team logos are not enabled yet.');
  }
  const { error: storageError } = await supabase.storage.from('team-logos').remove([path]);
  if (storageError) throw storageError;

  const { error: updateError } = await supabase.from('teams').update({ logo_url: null }).eq('id', teamId);
  if (updateError) throw updateError;
}
