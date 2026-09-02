import type { Task } from "@/lib/types";
import { tasksService } from "./tasks";

type Listener = () => void;

class ActiveTimerStore {
  private currentPrimaryTask: Task | null = null;
  private pendingTargetTask: Task | null = null;
  private pendingStartFn: (() => Promise<void> | void) | null = null;
  private isModalOpen = false;
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((l) => l());
  }

  getState() {
    return {
      currentPrimaryTask: this.currentPrimaryTask,
      pendingTargetTask: this.pendingTargetTask,
      isModalOpen: this.isModalOpen,
    };
  }

  closeModal() {
    this.isModalOpen = false;
    this.currentPrimaryTask = null;
    this.pendingTargetTask = null;
    this.pendingStartFn = null;
    this.notify();
  }

  /**
   * Enforces strictly 1 active task running at a time.
   * If another task is already in progress, opens the confirmation modal.
   * Otherwise executes directStartFn right away.
   */
  requestStartTask(
    targetTask: Task,
    userTasks: Task[],
    userId: string,
    directStartFn: () => Promise<void> | void
  ) {
    const activePrimary = userTasks?.find(
      (t) => t && t.id && t.id !== targetTask.id && t.status === "In Progress"
    );

    if (activePrimary) {
      this.currentPrimaryTask = activePrimary;
      this.pendingTargetTask = targetTask;
      this.pendingStartFn = directStartFn;
      this.isModalOpen = true;
      this.notify();
    } else {
      void directStartFn();
    }
  }

  /**
   * User confirms switching: Pauses current active task and starts the new target task.
   */
  async confirmSwitch(userId: string, onSuccess?: () => void) {
    const primary = this.currentPrimaryTask;
    const target = this.pendingTargetTask;
    const startFn = this.pendingStartFn;

    this.closeModal();

    if (primary) {
      try {
        await tasksService.setStatus(primary, "On Hold", userId, {
          hold_reason: "Paused to switch active task",
        });
      } catch (err) {
        console.error("Failed to pause previous active task:", err);
      }
    }

    if (startFn) {
      try {
        await startFn();
      } catch (err) {
        console.error("Failed executing target task start function:", err);
      }
    } else if (target) {
      try {
        await tasksService.setStatus(target, "In Progress", userId);
      } catch (err) {
        console.error("Failed starting target task:", err);
      }
    }

    if (onSuccess) onSuccess();
    this.notify();
  }
}

export const activeTimerStore = new ActiveTimerStore();


