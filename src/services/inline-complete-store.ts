type Listener = () => void;

let activeTaskId: string | null = null;
const listeners = new Set<Listener>();

export const inlineCompleteStore = {
  get: () => activeTaskId,
  open: (taskId: string) => {
    activeTaskId = taskId;
    listeners.forEach((l) => l());
  },
  close: () => {
    activeTaskId = null;
    listeners.forEach((l) => l());
  },
  toggle: (taskId: string) => {
    if (activeTaskId === taskId) {
      activeTaskId = null;
    } else {
      activeTaskId = taskId;
    }
    listeners.forEach((l) => l());
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
