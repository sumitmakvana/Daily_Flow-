import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppRole, Profile } from "@/lib/types";
import { toast } from "sonner";
import { seedQaAccounts } from "@/lib/qa-seed.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin");
    if (!data?.length) throw redirect({ to: "/today" });
  },
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, AppRole>>({});
  const [seeding, setSeeding] = useState(false);
  const seedFn = useServerFn(seedQaAccounts);

  const load = async () => {
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,avatar_url"),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    setProfiles((p ?? []) as Profile[]);
    const m: Record<string, AppRole> = {};
    (r ?? []).forEach((row: { user_id: string; role: AppRole }) => {
      // Prefer highest privilege if multiple
      const cur = m[row.user_id];
      const priority = { admin: 3, manager: 2, member: 1 } as const;
      if (!cur || priority[row.role] > priority[cur]) m[row.user_id] = row.role;
    });
    setRolesMap(m);
  };
  useEffect(() => { load(); }, []);

  const changeRole = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole } as never);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    load();
  };

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold">Admin · Users & Roles</h1>
      <Card className="p-3">
        <div className="space-y-2">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 border-b border-border/40 pb-2 last:border-0">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{p.display_name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.email}</div>
              </div>
              <Select value={rolesMap[p.id] ?? "member"} onValueChange={(v) => changeRole(p.id, v as AppRole)} disabled={p.id === user?.id}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">Tip: new users self-signup from the login page. The first user automatically becomes admin.</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
        <Button
          variant="outline"
          size="sm"
          disabled={seeding}
          onClick={async () => {
            setSeeding(true);
            try {
              const res = await seedFn();
              toast.success(`Seeded ${res.results.length} QA accounts`);
              load();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSeeding(false);
            }
          }}
        >
          {seeding ? "Seeding…" : "Seed QA accounts"}
        </Button>
      </div>
      <Card className="p-3 text-xs text-muted-foreground space-y-1">
        <div className="font-medium text-foreground">QA credentials (after seeding):</div>
        <div>qa-admin@executionos.test / QaAdmin!2026</div>
        <div>qa-manager@executionos.test / QaManager!2026</div>
        <div>qa-member@executionos.test / QaMember!2026</div>
      </Card>
    </div>
  );
}
