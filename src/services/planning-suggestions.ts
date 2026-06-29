import { fetchOpenSuggestions, resolveSuggestion } from "./planning-suggestions.functions";
import type { PlanningSuggestion } from "@/lib/types";

export const SUGGESTION_KIND_LABEL: Record<string, string> = {
  reassign: "Reassign",
  priority: "Re-prioritize",
  due_date: "Adjust due date",
  reviewer: "Rebalance reviewer",
  rebalance: "Rebalance workload",
};

export const planningSuggestionsService = {
  async listOpen(): Promise<PlanningSuggestion[]> {
    return (await fetchOpenSuggestions()) as unknown as PlanningSuggestion[];
  },

  async resolve(id: string, status: "accepted" | "dismissed", _userId: string) {
    // _userId kept for signature compatibility; server uses authenticated context.
    void _userId;
    await resolveSuggestion({ data: { id, status } });
  },

  async generateNow() {
    const res = await fetch("/api/public/hooks/planning-suggestions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: "{}",
    });
    return res.ok;
  },
};
