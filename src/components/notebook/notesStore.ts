import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { notebookService } from "@/services/notebook";
import { NoteItem } from "./noteUtils";

/**
 * Notebook store — the database is the single source of truth.
 * Local state is an optimistic cache of the DB rows; every change is
 * debounced per note and upserted through notebookService.
 */

const SAVE_DEBOUNCE_MS = 700;
const LEGACY_STORAGE_KEY = "daily_flow_notebook_notes_v1";

type Status = "idle" | "loading" | "ready" | "error";
interface State {
  notes: NoteItem[];
  status: Status;
}

let state: State = { notes: [], status: "idle" };
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();
const dirtyAgain = new Set<string>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const newId = () => crypto.randomUUID();
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function pushNote(id: string) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  if (inflight.has(id)) {
    dirtyAgain.add(id);
    return;
  }
  inflight.add(id);
  try {
    await notebookService.save(note);
  } catch (e) {
    console.warn("[notebook] save failed:", e);
    toast.error("Could not save note to the database. Your latest change will retry on the next edit.");
  } finally {
    inflight.delete(id);
    if (dirtyAgain.delete(id)) void pushNote(id);
  }
}

function scheduleSave(id: string, immediate = false) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  if (immediate) {
    timers.delete(id);
    void pushNote(id);
    return;
  }
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void pushNote(id);
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Send every pending (debounced) change right now. */
export function flushNotes() {
  for (const [id, t] of Array.from(timers)) {
    clearTimeout(t);
    timers.delete(id);
    void pushNote(id);
  }
}

/** One-time import of notes that older versions kept only in this browser. */
async function importLegacyNotes(): Promise<NoteItem[]> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return [];
    }
    const imported: NoteItem[] = parsed.map((n: NoteItem) => ({
      ...n,
      id: isUuid(n.id) ? n.id : newId(),
      tags: n.tags || [],
      images: n.images || [],
    }));
    await Promise.all(imported.map((n) => notebookService.save(n)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return imported;
  } catch (e) {
    console.warn("[notebook] legacy import failed:", e);
    return [];
  }
}

export async function loadNotes(force = false) {
  if (!force && (state.status === "loading" || state.status === "ready")) return;
  setState({ status: "loading" });
  try {
    // Import old browser-only notes before the first list, so a brand-new user's
    // first-login default note is only seeded when they have nothing else.
    await importLegacyNotes();
    const notes = await notebookService.list();
    setState({ notes, status: "ready" });
  } catch (e) {
    console.warn("[notebook] load failed:", e);
    setState({ status: "error" });
    toast.error("Could not load notes from the database");
  }
}

export function createNote(init: Partial<NoteItem> = {}): NoteItem {
  const now = new Date().toISOString();
  const note: NoteItem = {
    id: newId(),
    title: "",
    content: "",
    tags: [],
    color: "slate",
    isPinned: false,
    images: [],
    createdAt: now,
    updatedAt: now,
    ...init,
  };
  setState({ notes: [note, ...state.notes] });
  scheduleSave(note.id);
  return note;
}

export function updateNote(
  id: string,
  patch: Partial<Omit<NoteItem, "id">>,
  opts: { immediate?: boolean } = {}
) {
  const now = new Date().toISOString();
  setState({
    notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n)),
  });
  scheduleSave(id, opts.immediate);
}

export function deleteNote(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  dirtyAgain.delete(id);
  setState({ notes: state.notes.filter((n) => n.id !== id) });
  notebookService.remove(id).catch((e) => {
    console.warn("[notebook] delete failed:", e);
    toast.error("Could not delete note from the database");
    void loadNotes(true);
  });
}

export async function clearAllNotes() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  dirtyAgain.clear();
  setState({ notes: [] });
  try {
    await notebookService.clear();
  } catch (e) {
    console.warn("[notebook] clear failed:", e);
    toast.error("Could not clear notes in the database");
    void loadNotes(true);
  }
}

let flushHooked = false;
function hookFlushOnLeave() {
  if (flushHooked || typeof window === "undefined") return;
  flushHooked = true;
  window.addEventListener("pagehide", flushNotes);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNotes();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Subscribe to the notebook store; triggers the initial DB load. */
export function useNotes() {
  const snap = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    hookFlushOnLeave();
    void loadNotes();
  }, []);
  return { notes: snap.notes, status: snap.status };
}
