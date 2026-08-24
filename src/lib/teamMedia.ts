import { supabase } from './supabase';
import { TEAM_MEDIA_ENABLED } from './teamMessages';

export { TEAM_MEDIA_ENABLED };

// Uploads a local file (a picked photo/video URI) into the team-media
// bucket at {teamId}/{messageId}/{filename} — the storage RLS in
// schema.sql reads teamId straight out of that path, so the path shape
// here isn't cosmetic, it's load-bearing. Returns the storage path to save
// as team_messages.media_url. Callers must check TEAM_MEDIA_ENABLED before
// ever reaching this — it exists now so nothing needs rebuilding once the
// media-release gate (DRILLSTREAK.md) is switched on, but isn't wired into
// any screen yet.
export async function uploadTeamMedia(
  teamId: string,
  messageId: string,
  fileUri: string,
  fileName: string
): Promise<string> {
  if (!TEAM_MEDIA_ENABLED) {
    throw new Error('Team media is not enabled yet.');
  }

  const path = `${teamId}/${messageId}/${fileName}`;
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from('team-media').upload(path, blob, { upsert: false });
  if (error) throw error;
  return path;
}

// Signed URL, not a public one — the bucket is private (public: false in
// schema.sql), so every render needs a fresh short-lived URL rather than a
// stored permanent one.
export async function getTeamMediaUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from('team-media').createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
