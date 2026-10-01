import {
  listNotebookNotesFn,
  upsertNotebookNoteFn,
  deleteNotebookNoteFn,
  clearNotebookNotesFn,
} from "./notebook.functions";
import type { NoteItem } from "@/components/notebook/noteUtils";

export const notebookService = {
  async list(): Promise<NoteItem[]> {
    return (await listNotebookNotesFn()) as NoteItem[];
  },

  async save(note: NoteItem): Promise<NoteItem | null> {
    return (await upsertNotebookNoteFn({
      data: {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: note.tags || [],
        color: note.color,
        isPinned: note.isPinned,
        images: note.images || [],
        createdAt: note.createdAt,
      },
    })) as NoteItem | null;
  },

  async remove(id: string): Promise<void> {
    await deleteNotebookNoteFn({ data: { id } });
  },

  async clear(): Promise<void> {
    await clearNotebookNotesFn();
  },
};
