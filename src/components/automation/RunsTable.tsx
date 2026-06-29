import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { automationsService, type AutomationRun, type AutomationRule } from "@/services/automations";

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  dead: "bg-destructive/15 text-destructive",
  pending: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  skipped_condition: "bg-muted text-muted-foreground",
  skipped_dedupe: "bg-muted text-muted-foreground",
  skipped_cap: "bg-muted text-muted-foreground",
  skipped_rate: "bg-muted text-muted-foreground",
  skipped_depth: "bg-muted text-muted-foreground",
};

export function RunsTable() {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [status, setStatus] = useState<string>("__all__");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      const [rs, rls] = await Promise.all([
        automationsService.listRuns({ status: status === "__all__" ? undefined : status, limit: 100 }),
        automationsService.list(),
      ]);
      setRuns(rs); setRules(rls);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const replay = async (id: string) => {
    try { await automationsService.replay(id); toast.success("Replayed"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const ruleName = (id: string | null) =>
    rules.find((r) => r.id === id)?.name ?? "(deleted rule)";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Runs</h2>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {["succeeded","failed","dead","skipped_condition","skipped_dedupe","skipped_cap","skipped_rate"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        {runs.map((r) => (
          <div key={r.id} className="border-b border-border/40 py-2 last:border-0 text-sm">
            <div className="flex items-center gap-2">
              <Badge className={`text-[10px] ${STATUS_COLORS[r.status] ?? "bg-muted"}`}>{r.status}</Badge>
              <div className="flex-1 min-w-0">
                <div className="truncate">{ruleName(r.rule_id)}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.started_at).toLocaleString()} · {r.entity_type ?? "—"}
                </div>
              </div>
              {r.status === "dead" && (
                <Button variant="outline" size="sm" onClick={() => replay(r.id)}>Replay</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                {expanded === r.id ? "Hide" : "Details"}
              </Button>
            </div>
            {expanded === r.id && (
              <pre className="text-[10px] mt-2 p-2 bg-muted/30 rounded overflow-auto max-h-48">
                {JSON.stringify({ actions_log: r.actions_log, error: r.error }, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {runs.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No runs yet.</p>}
      </div>
    </Card>
  );
}
