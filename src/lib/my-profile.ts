/**
 * The signed-in user's own profile row, shared by everything that needs it on a page load.
 *
 * The app shell, My Day and the morning prompt each read `profiles?id=eq.<me>` with a
 * different column list, so one page load made three requests for the same row. They now
 * share ONE read of the superset of those columns.
 *
 * Sharing is deliberately short-lived: concurrent callers join the in-flight request and a
 * finished result is reused for SHARE_MS only, which is enough to cover a page load but means a
 * renamed profile shows up on the next mount, never minutes later. Failures and "no row" are not
 * remembered, so the next caller simply retries (callers already fall back to the auth metadata).
 */
import { supabase } from "@/integrations/supabase/client";

export type MyProfile = {
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export const PROFILE_SHARE_MS = 3000;

type Entry = { userId: string; at: number; promise: Promise<MyProfile | null> };
let entry: Entry | null = null;

async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  return error || !data ? null : (data as MyProfile);
}

/** The user's profile row, or null when it could not be read / does not exist. */
export function loadMyProfile(userId: string): Promise<MyProfile | null> {
  // Never share state across requests on the server.
  if (typeof window === "undefined") return fetchMyProfile(userId);
  const e = entry;
  if (e && e.userId === userId && Date.now() - e.at < PROFILE_SHARE_MS) return e.promise;
  const mine: Entry = { userId, at: Date.now(), promise: fetchMyProfile(userId) };
  entry = mine;
  const forget = () => {
    if (entry === mine) entry = null;
  };
  mine.promise.then((v) => (v === null ? forget() : undefined), forget);
  return mine.promise;
}

/** Forget the shared result (e.g. after the profile was edited). */
export function invalidateMyProfile() {
  entry = null;
}
