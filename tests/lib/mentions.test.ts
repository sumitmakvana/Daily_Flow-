import { describe, it, expect } from "vitest";
import {
  filterMentionUsers,
  getMentionQuery,
  insertMention,
  resolveMentionIds,
  splitMentions,
  type MentionUser,
} from "@/lib/mentions";

const users: MentionUser[] = [
  { id: "nirav", display_name: "Nirav Thakkar", email: "nirav@noesisanalytics.co.in" },
  { id: "miraj", display_name: "Miraj Shah", email: "miraj.shah@noesisanalytics.co.in" },
  { id: "krupali", display_name: "Krupali Joshi", email: "krupali.joshi@noesisanalytics.co.in" },
  { id: "milan", display_name: "Milan Patel", email: "milan.patel@noesisanalytics.co.in" },
  { id: "mann", display_name: "Mann Shah", email: "mann.shah@noesisanalytics.co.in" },
];

describe("getMentionQuery", () => {
  it("opens on a bare @ at start or after whitespace", () => {
    expect(getMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(getMentionQuery("hi @mi", 6)).toEqual({ start: 3, query: "mi" });
    expect(getMentionQuery("line one\n@ni", 12)).toEqual({ start: 9, query: "ni" });
  });
  it("ignores emails and a caret before the @", () => {
    expect(getMentionQuery("mail a@b.com", 12)).toBeNull();
    expect(getMentionQuery("@mi here", 0)).toBeNull();
  });
  it("closes when the query spans a line break or is too long", () => {
    expect(getMentionQuery("@mi\nfoo", 7)).toBeNull();
    expect(getMentionQuery("@" + "x".repeat(40), 41)).toBeNull();
  });
  it("uses the @ closest to the caret", () => {
    expect(getMentionQuery("@Nirav Thakkar and @mi", 22)).toEqual({ start: 19, query: "mi" });
  });
});

describe("filterMentionUsers", () => {
  it("returns everyone (capped) for an empty query", () => {
    expect(filterMentionUsers(users, "")).toHaveLength(5);
    expect(filterMentionUsers(users, "", 2)).toHaveLength(2);
  });
  it("filters by name prefix, case-insensitively", () => {
    expect(filterMentionUsers(users, "MI").map((u) => u.id)).toEqual(["milan", "miraj"]);
  });
  it("matches any word of the name and the email", () => {
    expect(filterMentionUsers(users, "shah").map((u) => u.id)).toEqual(["mann", "miraj"]);
    expect(filterMentionUsers(users, "krupali.j").map((u) => u.id)).toEqual(["krupali"]);
  });
  it("ranks prefix matches above substring matches", () => {
    expect(filterMentionUsers(users, "an").map((u) => u.id)).toEqual(["mann", "milan"]);
    // word-prefix ("Shah") before substring ("Joshi")
    expect(filterMentionUsers(users, "sh").map((u) => u.id)).toEqual(["mann", "miraj", "krupali"]);
  });
  it("does not match on the shared email domain", () => {
    expect(filterMentionUsers(users, "noesis")).toEqual([]);
  });
  it("returns nothing when no one matches", () => {
    expect(filterMentionUsers(users, "zzz")).toEqual([]);
  });
});

describe("insertMention", () => {
  it("replaces the typed @query with the full name and a trailing space", () => {
    const text = "hello @mi world";
    const q = getMentionQuery(text, 9)!;
    const out = insertMention(text, q, 9, users[1]);
    expect(out.text).toBe("hello @Miraj Shah  world");
    expect(out.caret).toBe("hello @Miraj Shah ".length);
  });
});

describe("resolveMentionIds", () => {
  it("resolves multiple mentions and de-duplicates", () => {
    expect(resolveMentionIds("@Nirav Thakkar and @Miraj Shah, @Nirav Thakkar again", users).sort()).toEqual([
      "miraj",
      "nirav",
    ]);
  });
  it("is case-insensitive and un-mentions when the text is deleted", () => {
    expect(resolveMentionIds("ping @miraj shah", users)).toEqual(["miraj"]);
    expect(resolveMentionIds("ping Miraj", users)).toEqual([]);
  });
  it("does not match a longer word or a partial name", () => {
    expect(resolveMentionIds("@Miraj Shahzad", users)).toEqual([]);
    expect(resolveMentionIds("@Mir", users)).toEqual([]);
  });
  it("does not match inside an email address", () => {
    expect(resolveMentionIds("mail x@Miraj Shah", users)).toEqual([]);
  });
  it("excludes the author", () => {
    expect(resolveMentionIds("@Miraj Shah @Mann Shah", users, "miraj")).toEqual(["mann"]);
  });
  it("handles names with regex characters", () => {
    const odd = [{ id: "x", display_name: "A.B (Dev)" }];
    expect(resolveMentionIds("hi @A.B (Dev)!", odd)).toEqual(["x"]);
    expect(resolveMentionIds("hi @AxB (Dev)", odd)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("splits a body into text and mention segments", () => {
    expect(splitMentions("hey @Miraj Shah, see @Mann Shah", users)).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", text: "@Miraj Shah" },
      { type: "text", text: ", see " },
      { type: "mention", text: "@Mann Shah" },
    ]);
  });
  it("returns plain text when nobody is mentioned", () => {
    expect(splitMentions("no mentions", users)).toEqual([{ type: "text", text: "no mentions" }]);
    expect(splitMentions("@Someone Else", users)).toEqual([{ type: "text", text: "@Someone Else" }]);
    expect(splitMentions("hi", [])).toEqual([{ type: "text", text: "hi" }]);
  });
  it("highlights a mention at the very start", () => {
    expect(splitMentions("@Miraj Shah hi", users)[0]).toEqual({ type: "mention", text: "@Miraj Shah" });
  });
});
