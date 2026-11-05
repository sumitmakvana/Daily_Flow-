import { beforeEach, describe, expect, it, vi } from "vitest";

// Profile, roles and people are session caches. They must be dropped together on sign-out or a user
// switch (no cross-user leakage), and must survive token refreshes and the wrapper's replayed "signed in".

type Cb = (event: string, s: { user?: { id: string } } | null) => void;
const subs: Cb[] = [];
vi.mock("@/integrations/backend/auth", () => ({
  auth: { onAuthStateChange: (cb: Cb) => { subs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; } },
}));

let profileName = "Alice";
let profileGate: Promise<void> | null = null;
const profileReads: string[] = [];
const peopleReads: number[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        if (cols.includes("email, avatar_url") || cols === "display_name, email, avatar_url") {
          return { eq: (_c: string, id: string) => ({ maybeSingle: async () => {
            profileReads.push(id);
            const name = profileName;
            if (profileGate) await profileGate;
            return { data: { display_name: name, email: null, avatar_url: null }, error: null };
          } }) };
        }
        peopleReads.push(1);
        return Promise.resolve({ data: [{ id: "p1", display_name: "P", avatar_url: null }], error: null });
      },
    }),
  },
}));

import { invalidateMyProfile, loadMyProfile } from "@/lib/my-profile";
import { invalidatePeople, loadPeople } from "@/lib/people";

const emit = (event: string, id: string | null) => subs.forEach((cb) => cb(event, id ? { user: { id } } : null));

beforeEach(() => {
  invalidateMyProfile();
  invalidatePeople();
  profileReads.length = 0;
  peopleReads.length = 0;
  profileName = "Alice";
  profileGate = null;
});

describe("session caches", () => {
  it("serve repeated reads from cache for the session", async () => {
    await loadMyProfile("u1");
    await loadMyProfile("u1");
    await loadPeople();
    await loadPeople();
    expect(profileReads).toHaveLength(1);
    expect(peopleReads).toHaveLength(1);
  });

  it("survive a token refresh and a replayed SIGNED_IN for the same user", async () => {
    emit("SIGNED_IN", "u1");
    await loadMyProfile("u1");
    await loadPeople();
    emit("TOKEN_REFRESHED", "u1");
    emit("SIGNED_IN", "u1");
    await loadMyProfile("u1");
    await loadPeople();
    expect(profileReads).toHaveLength(1);
    expect(peopleReads).toHaveLength(1);
  });

  it("are all dropped on sign-out", async () => {
    emit("SIGNED_IN", "u1");
    await loadMyProfile("u1");
    await loadPeople();
    emit("SIGNED_OUT", null);
    await loadMyProfile("u1");
    await loadPeople();
    expect(profileReads).toHaveLength(2);
    expect(peopleReads).toHaveLength(2);
  });

  it("are all dropped when a different user signs in", async () => {
    emit("SIGNED_IN", "u1");
    await loadMyProfile("u1");
    await loadPeople();
    profileName = "Bob";
    emit("SIGNED_IN", "u2");
    expect((await loadMyProfile("u2"))?.display_name).toBe("Bob");
    await loadPeople();
    expect(peopleReads).toHaveLength(2);
  });

  it("an invalidated profile edit is re-read once, then cached again", async () => {
    await loadMyProfile("u1");
    profileName = "Renamed";
    invalidateMyProfile();
    expect((await loadMyProfile("u1"))?.display_name).toBe("Renamed");
    await loadMyProfile("u1");
    expect(profileReads).toHaveLength(2);
  });

  it("a read that finishes after sign-out does not repopulate the cache for the next user", async () => {
    emit("SIGNED_IN", "u1");
    let release!: () => void;
    profileGate = new Promise<void>((r) => (release = r));
    const slow = loadMyProfile("u1"); // Alice's read, still in flight
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", "u2");
    profileGate = null;
    profileName = "Bob";
    expect((await loadMyProfile("u2"))?.display_name).toBe("Bob");
    release();
    await slow;
    expect((await loadMyProfile("u2"))?.display_name).toBe("Bob");
    expect(profileReads).toEqual(["u1", "u2"]);
  });
});
