/**
 * The people list (profiles), shared by every page and component that needs names / avatars.
 *
 * About twenty call sites used to read `profiles` on their own, several of them again on every task
 * realtime event. They now share ONE read per variant:
 *
 *  - `loadPeople()`         id, display_name, avatar_url (what the member-facing pages already read)
 *  - `loadPeopleDetailed()` adds email, team_id, manager_id (what the manager pages already read)
 *
 * The two variants are separate on purpose: column-level permissions on `profiles` are unchanged, so
 * a page never requests a column it did not request before. A fresh detailed result also serves the
 * basic variant (it is a superset).
 *
 * Concurrent callers join the in-flight request. A finished result is reused for PEOPLE_TTL_MS; after
 * that the next caller refetches. If a refetch fails the previous list is returned rather than an
 * empty one. Nothing is remembered across users: sign-out or a different user drops the cache. Call
 * `invalidatePeople()` after changing a profile (the admin screen does).
 */
import { supabase } from "@/integrations/supabase/client";
import { auth } from "@/integrations/backend/auth";
import type { Profile } from "@/lib/types";

export const PEOPLE_TTL_MS = 4 * 60_000;

type Variant = "basic" | "detailed";
type Entry = { at: number; promise: Promise<Profile[]>; value?: Profile[] };

const entries: Record<Variant, Entry | null> = { basic: null, detailed: null };
const lastGood: Record<Variant, Profile[] | null> = { basic: null, detailed: null };

export function invalidatePeople() {
  entries.basic = null;
  entries.detailed = null;
  lastGood.basic = null;
  lastGood.detailed = null;
}

let authHooked = false;
let knownUserId: string | null | undefined;
function hookAuth() {
  if (authHooked || typeof window === "undefined") return;
  authHooked = true;
  try {
    auth.onAuthStateChange((event, s) => {
      const id = s?.user?.id ?? null;
      // The auth wrapper fires "signed in" for every new subscriber: only a real change drops the cache.
      if (event === "SIGNED_OUT" || id === null || (knownUserId !== undefined && knownUserId !== id)) invalidatePeople();
      knownUserId = id;
    });
  } catch {
    /* no auth available (e.g. a test); the TTL still bounds staleness */
  }
}

const fresh = (e: Entry | null): e is Entry => !!e && Date.now() - e.at < PEOPLE_TTL_MS;

async function fetchPeople(variant: Variant): Promise<Profile[]> {
  // Literal column lists keep the query result typed.
  const { data, error } =
    variant === "basic"
      ? await supabase.from("profiles").select("id,display_name,avatar_url")
      : await supabase.from("profiles").select("id,display_name,email,avatar_url,team_id,manager_id");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

function load(variant: Variant): Promise<Profile[]> {
  // Never share state across requests on the server.
  if (typeof window === "undefined") return fetchPeople(variant);
  hookAuth();

  // A fresh detailed list already contains the basic columns.
  if (variant === "basic" && fresh(entries.detailed) && entries.detailed.value) {
    return Promise.resolve(entries.detailed.value.map(({ id, display_name, avatar_url }) => ({ id, display_name, avatar_url })));
  }

  const e = entries[variant];
  if (fresh(e)) return e.promise;

  const entry: Entry = {
    at: Date.now(),
    promise: fetchPeople(variant).then(
      (rows) => {
        entry.value = rows;
        lastGood[variant] = rows;
        return rows;
      },
      (err) => {
        if (entries[variant] === entry) entries[variant] = null;
        const prev = lastGood[variant];
        if (prev) return prev; // keep what the user already sees
        throw err;
      },
    ),
  };
  entries[variant] = entry;
  return entry.promise;
}

// Callers get their own array so sorting or filtering it can never change what others see.
const copy = (p: Promise<Profile[]>) => p.then((rows) => rows.slice());

/** id, display_name, avatar_url of everyone the user may see. Rejects only if there is nothing to show. */
export function loadPeople(): Promise<Profile[]> {
  return copy(load("basic"));
}

/** Like `loadPeople()` plus email, team_id and manager_id (for manager pages). */
export function loadPeopleDetailed(): Promise<Profile[]> {
  return copy(load("detailed"));
}

/** Same as `loadPeople()` but resolves to `[]` on failure, like the pages' previous `data ?? []`. */
export const loadPeopleSafe = () => loadPeople().catch(() => [] as Profile[]);
export const loadPeopleDetailedSafe = () => loadPeopleDetailed().catch(() => [] as Profile[]);
