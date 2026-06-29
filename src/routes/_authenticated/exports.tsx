import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportsService, EXPORT_LABELS, type ExportFilters, type ExportFormat, type ExportKind } from "@/services/exports";
import type { Profile } from "@/lib/types";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/exports")({
  component: ExportsPage,
});

const KINDS = Object.keys(EXPORT_LABELS) as ExportKind[];

function ExportsPage() {
  const { user, isManager } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filters, setFilters] = useState<ExportFilters>({});
  const [busy, setBusy] = useState<ExportKind | null>(null);

  useEffect(() => {
    supabase.from("profiles").select("id,display_name,avatar_url").then(({ data }) => setProfiles((data ?? []) as Profile[]));
  }, []);

  if (!user) return null;
  if (!isManager) {
    return <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">Exports are available to managers.</div>;
  }

  const run = async (kind: ExportKind, format: ExportFormat) => {
    setBusy(kind);
    try {
      const n = await exportsService.run(kind, filters, format, user.id);
      toast.success(`Exported ${n} rows`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <FileDown className="h-5 w-5 text-primary" /> Audit & exports
      </h1>

      <Card className="p-3 space-y-3">
        <h2 className="text-sm font-semibold">Filters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} className="h-8 text-xs" />
          <Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} className="h-8 text-xs" />
          <Select value={filters.userId ?? ""} onValueChange={(v) => setFilters({ ...filters, userId: v || undefined })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All users" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All users</SelectItem>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10px] text-muted-foreground">Date filters apply to event/snapshot tables. User filter applies where relevant.</p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {KINDS.map((kind) => (
          <Card key={kind} className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{EXPORT_LABELS[kind]}</div>
              <div className="text-xs text-muted-foreground">CSV or Excel (.xls)</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === kind} onClick={() => run(kind, "csv")}>
                <Download className="h-3 w-3 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={busy === kind} onClick={() => run(kind, "xls")}>
                <Download className="h-3 w-3 mr-1" /> Excel
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
