import { supabase } from './supabase';

// Permanently deletes the signed-in user's own account, via the
// delete-account Edge Function. The function derives the account to delete
// from the caller's own auth token (functions.invoke automatically sends
// the current session's Authorization header) -- there is no id parameter
// to pass, by design, so this can never target any account but the one
// currently signed in.
export async function deleteMyAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    throw new Error(error.message ?? 'Something went wrong deleting your account.');
  }
  if (data?.error) {
    throw new Error(data.error as string);
  }
}
