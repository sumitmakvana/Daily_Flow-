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

  // Local draft state for edits
  const [editedManagers, setEditedManagers] = useState<Record<string, string | null>>({});
  const [editedRoles, setEditedRoles] = useState<Record<string, AppRole>>({});

  const deleteUserFn = useServerFn(deleteUser);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email,avatar_url,manager_id"),
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

  const saveChanges = async (userId: string) => {
    const updatedManagerId = editedManagers[userId];
    const updatedRole = editedRoles[userId];

    setLoading(true);
    try {
      // Save manager if edited
      if (updatedManagerId !== undefined) {
        const { error } = await supabase
          .from("profiles")
          .update({ manager_id: updatedManagerId } as never)
          .eq("id", userId);
        if (error) throw error;
        setEditedManagers(prev => {
          const { [userId]: _, ...rest } = prev;
          return rest;
        });
      }

      // Save role if edited
      if (updatedRole !== undefined) {
        const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", userId);
        if (deleteError) throw deleteError;

        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: updatedRole } as never);
        if (error) throw error;
        setEditedRoles(prev => {
          const { [userId]: _, ...rest } = prev;
          return rest;
        });
      }

      toast.success("Changes saved successfully");
      load();
    } catch (e) {
      toast.error((e as Error).message || "Failed to save changes");
    } finally {
      setLoading(false);
    }
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
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
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
        {/* Table Header */}
        {filteredProfiles.length > 0 && (
          <div className="hidden md:grid grid-cols-[1fr_200px_160px_100px] gap-4 px-3 py-2 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <div>User / Email</div>
            <div>Manager</div>
            <div>Role</div>
            <div className="text-right">Actions</div>
          </div>
        )}

        <div className="space-y-3">
          {filteredProfiles.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {profiles.length === 0 ? "No users found." : "No users match your search query."}
            </div>
          ) : (
            filteredProfiles.map((p) => {
              const currentManager = editedManagers[p.id] !== undefined ? editedManagers[p.id] : (p.manager_id ?? null);
              const currentRole = editedRoles[p.id] !== undefined ? editedRoles[p.id] : (rolesMap[p.id] ?? "member");
              const hasChanges = (editedManagers[p.id] !== undefined && editedManagers[p.id] !== (p.manager_id ?? null)) || 
                                  (editedRoles[p.id] !== undefined && editedRoles[p.id] !== (rolesMap[p.id] ?? "member"));

              return (
                <div key={p.id} className="grid grid-cols-1 md:grid-cols-[1fr_200px_160px_100px] items-center gap-2 md:gap-4 py-3 border-b border-border/40 last:border-0 last:pb-0">
                  {/* User/Email Column */}
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{p.display_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                  </div>

                  {/* Manager Column */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground md:hidden block mb-1">Manager</label>
                    <Select
                      value={currentManager ?? "__none"}
                      onValueChange={(v) => {
                        setEditedManagers(prev => ({ ...prev, [p.id]: v === "__none" ? null : v }));
                      }}
                    >
                      <SelectTrigger className="h-8 w-full md:w-44 text-xs bg-background/50 border-border/60">
                        <SelectValue placeholder="Manager" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No Manager</SelectItem>
                        {profiles
                          .filter((m) => m.id !== p.id)
                          .map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.display_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Role Column */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground md:hidden block mb-1">Role</label>
                    <Select 
                      value={currentRole} 
                      onValueChange={(v) => {
                        setEditedRoles(prev => ({ ...prev, [p.id]: v as AppRole }));
                      }} 
                      disabled={p.id === user?.id}
                    >
                      <SelectTrigger className="h-8 w-full md:w-32 text-xs bg-background/50 border-border/60"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions / Save Column */}
                  <div className="flex items-center justify-between md:justify-end gap-1.5 pt-2 md:pt-0">
                    {hasChanges && (
                      <Button
                        size="sm"
                        onClick={() => saveChanges(p.id)}
                        className="h-8 px-3 text-xs font-medium"
                      >
                        Save
                      </Button>
                    )}
                    {p.id !== user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto md:ml-0"
                        onClick={() => setUserToDelete(p)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
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

