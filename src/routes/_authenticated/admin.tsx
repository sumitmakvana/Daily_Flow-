import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search, Trash2, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AppRole, Profile } from "@/lib/types";
import { toast } from "sonner";
import { deleteUser } from "@/lib/admin-actions";

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
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteUserFn = useServerFn(deleteUser);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email,avatar_url"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      setProfiles((p ?? []) as Profile[]);
      const m: Record<string, AppRole> = {};
      (r ?? []).forEach((row: { user_id: string; role: AppRole }) => {
        const cur = m[row.user_id];
        const priority = { admin: 3, manager: 2, member: 1 } as const;
        if (!cur || priority[row.role] > priority[cur]) m[row.user_id] = row.role;
      });
      setRolesMap(m);
    } catch (e) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole } as never);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    load();
  };

  const handleDelete = async () => {
    if (!userToDelete) return;
    setDeleting(true);
    try {
      await deleteUserFn({ data: userToDelete.id });
      toast.success(`User "${userToDelete.display_name}" has been deleted.`);
      setUserToDelete(null);
      load();
    } catch (e) {
      toast.error((e as Error).message || "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  };

  const filteredProfiles = profiles.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const nameMatch = p.display_name?.toLowerCase().includes(q) ?? false;
    const emailMatch = p.email?.toLowerCase().includes(q) ?? false;
    return nameMatch || emailMatch;
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin · Users & Roles</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4.5 w-4.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-background/50 border-border/80 focus-visible:ring-1"
        />
      </div>

      <Card className="p-4 border-border/50 bg-card/60 backdrop-blur-sm shadow-md">
        <div className="space-y-3">
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {profiles.length === 0 ? "No users found." : "No users match your search query."}
            </div>
          ) : (
            filteredProfiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 border-b border-border/40 pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-foreground truncate">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={rolesMap[p.id] ?? "member"} onValueChange={(v) => changeRole(p.id, v as AppRole)} disabled={p.id === user?.id}>
                    <SelectTrigger className="h-8 w-28 text-xs bg-background/50 border-border/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {p.id !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => setUserToDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">Tip: new users self-signup from the login page. The first user automatically becomes admin.</p>

      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user account <strong>{userToDelete?.display_name}</strong> ({userToDelete?.email}). All comments and assignments will be cleaned up safely to prevent database conflicts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? "Deleting..." : "Yes, Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

