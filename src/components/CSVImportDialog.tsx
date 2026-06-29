import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCSV } from "@/lib/csv";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile } from "@/lib/types";

const COLS = [
  "task_code", "task_name", "client", "project_name", "priority", "status",
  "assigned_to_email", "reviewer_email", "due_date", "planned_hours", "sprint_week", "remarks",
];

export function CSVImportDialog({
  open, onOpenChange, profiles, userId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profiles: Profile[];
  userId: string;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const onFile = async (f: File) => {
    setFileName(f.name);
    const text = await f.text();
    setRows(parseCSV(text));
  };

  const emailToId = async (email: string): Promise<string | null> => {
    // Lookup via profile_emails (security_invoker view) so only managers/admins
    // can resolve other users; ICs only resolve their own email.
    const { data } = await supabase
      .from("profile_emails" as never)
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  const doImport = async () => {
    if (!rows.length) return;
    setBusy(true);
    try {
      const payload = await Promise.all(rows.map(async (r) => ({
        task_code: r.task_code || undefined,
        task_name: r.task_name || "(untitled)",
        client: r.client || null,
        project_name: r.project_name || null,
        priority: (TASK_PRIORITIES.includes(r.priority as never) ? r.priority : "Medium"),
        status: (TASK_STATUSES.includes(r.status as never) ? r.status : "To Do"),
        assigned_to: r.assigned_to_email ? await emailToId(r.assigned_to_email) : null,
        reviewer: r.reviewer_email ? await emailToId(r.reviewer_email) : null,
        due_date: r.due_date || null,
        planned_hours: r.planned_hours ? Number(r.planned_hours) : 0,
        sprint_week: r.sprint_week || null,
        remarks: r.remarks || null,
        created_by: userId,
        updated_by: userId,
      })));
      // chunk in 100s; trigger rejects member-impersonation rows individually
      let inserted = 0;
      let rejected = 0;
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        const { error, data } = await supabase.from("tasks").insert(chunk as never).select("id");
        if (error) {
          rejected += chunk.length;
          continue;
        }
        inserted += data?.length ?? chunk.length;
      }
      if (rejected > 0) {
        toast.warning(`Imported ${inserted}, rejected ${rejected} (permission denied — manager role required for cross-assignment)`);
      } else {
        toast.success(`Imported ${inserted} task${inserted === 1 ? "" : "s"}`);
      }
      onOpenChange(false);
      setRows([]);
      setFileName("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import tasks from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Expected columns (header row required):
          </p>
          <code className="block text-[11px] bg-muted/40 rounded p-2 break-all">
            {COLS.join(", ")}
          </code>
          <p className="text-xs text-muted-foreground">
            <code>assigned_to_email</code> and <code>reviewer_email</code> must match existing team member emails. Unknown values become unassigned.
          </p>
          <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {fileName && (
            <div className="text-xs text-muted-foreground">
              {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} parsed
            </div>
          )}
          {rows.length > 0 && (
            <div className="max-h-40 overflow-auto rounded border border-border text-[11px]">
              <table className="w-full">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Name</th>
                    <th className="text-left px-2 py-1">Status</th>
                    <th className="text-left px-2 py-1">Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 truncate">{r.task_name}</td>
                      <td className="px-2 py-1">{r.status || "To Do"}</td>
                      <td className="px-2 py-1">{r.assigned_to_email || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doImport} disabled={!rows.length || busy}>
            {busy ? "Importing…" : `Import ${rows.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
