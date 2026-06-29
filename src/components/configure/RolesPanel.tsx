import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orgRolesService, type OrgRole, type UserOrgRole } from "@/services/org-roles";
import { supabase } from "@/integrations/supabase/client";
import { toKey, isValidKey } from "@/lib/slug";
import { UserPicker } from "./UserPicker";
import { toast } from "sonner";
import { Plus, Archive, ArchiveRestore, Users, Network } from "lucide-react";

type Profile = { id: string; display_name: string | null; email: string | null };

export function RolesPanel() {
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [hierarchy, setHierarchy] = useState<Array<{ parent_role_id: string; child_role_id: string }>>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrgRole | null>(null);
  const [memberRole, setMemberRole] = useState<OrgRole | null>(null);

  const load = async () => {
    try {
      const [rs, hs] = await Promise.all([
        orgRolesService.list(true),
        orgRolesService.listHierarchy(),
      ]);
      setRoles(rs); setHierarchy(hs);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const archive = async (r: OrgRole, next: boolean) => {
    try { await orgRolesService.update(r.id, { is_active: next }); toast.success(next ? "Restored" : "Archived"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const setParent = async (child: OrgRole, parentId: string | null) => {
    try { await orgRolesService.setParent(child.id, parentId); toast.success("Hierarchy updated"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const visible = roles.filter((r) => showArchived || r.is_active);
  const parentOf = (childId: string) => hierarchy.find((h) => h.child_role_id === childId)?.parent_role_id ?? null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Roles</h2>
          <p className="text-xs text-muted-foreground">
            Custom role labels (Area Manager, Plant Head, Project Manager…). Used by approvals and workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />Archived
          </label>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setEditing(null)}><Plus className="h-3 w-3 mr-1" />New Role</Button>
            </DialogTrigger>
            <RoleFormDialog editing={editing} onSaved={() => { setOpen(false); setEditing(null); load(); }} />
          </Dialog>
        </div>
      </div>

      <div className="space-y-1">
        {visible.map((r) => {
          const parentId = parentOf(r.id);
          return (
            <div key={r.id} className={`flex items-center gap-3 border-b border-border/40 py-2 last:border-0 ${!r.is_active ? "opacity-50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {r.label}
                  {r.is_system && <Badge variant="outline" className="text-[10px] h-4">system</Badge>}
                  {!r.is_active && <Badge variant="secondary" className="text-[10px] h-4">archived</Badge>}
                </div>
                <div className="text-xs text-muted-foreground"><code>{r.key}</code>{r.description ? ` — ${r.description}` : ""}</div>
              </div>
              <div className="flex items-center gap-1">
                <Network className="h-3 w-3 text-muted-foreground" />
                <Select value={parentId ?? "__none__"} onValueChange={(v) => setParent(r, v === "__none__" ? null : v)}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="No parent" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No parent</SelectItem>
                    {roles.filter((x) => x.id !== r.id && x.is_active).map((x) => (
                      <SelectItem key={x.id} value={x.id}>inherits ← {x.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMemberRole(r)} title="Members">
                <Users className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setOpen(true); }}>Edit</Button>
              {!r.is_system && (
                <Button variant="ghost" size="sm" onClick={() => archive(r, !r.is_active)} title={r.is_active ? "Archive" : "Restore"}>
                  {r.is_active ? <Archive className="h-3 w-3" /> : <ArchiveRestore className="h-3 w-3" />}
                </Button>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No roles yet.</p>}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Hierarchy: a parent role inherits the child's permissions. e.g. set Regional Manager as parent of Area Manager, and Regional Managers can also approve anything an Area Manager can.
      </p>

      {memberRole && <MembersDialog role={memberRole} onClose={() => setMemberRole(null)} />}
    </Card>
  );
}

function RoleFormDialog({ editing, onSaved }: { editing: OrgRole | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    key: editing?.key ?? "",
    keyEdited: !!editing,
    label: editing?.label ?? "",
    description: editing?.description ?? "",
    sort_order: editing?.sort_order ?? 100,
  });
  const onLabel = (label: string) =>
    setForm((f) => ({ ...f, label, key: f.keyEdited ? f.key : toKey(label) }));

  const save = async () => {
    if (!form.label) return toast.error("Label required");
    if (!isValidKey(form.key)) return toast.error("Invalid key — letters/numbers/underscores only");
    try {
      if (editing) {
        await orgRolesService.update(editing.id, { label: form.label, description: form.description || undefined, sort_order: form.sort_order });
      } else {
        await orgRolesService.create({ key: form.key, label: form.label, description: form.description || undefined, sort_order: form.sort_order });
      }
      toast.success("Saved"); onSaved();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit Role" : "New Role"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Label</Label>
          <Input value={form.label} onChange={(e) => onLabel(e.target.value)} placeholder="e.g. Area Manager" autoFocus />
          {form.key && <p className="text-[10px] text-muted-foreground mt-1">Internal key: <code>{form.key}</code></p>}
        </div>
        <div>
          <Label>Description</Label>
          <Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
        </div>
      </div>
      <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
    </DialogContent>
  );
}

function MembersDialog({ role, onClose }: { role: OrgRole; onClose: () => void }) {
  const [members, setMembers] = useState<UserOrgRole[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [picker, setPicker] = useState<string | null>(null);

  const load = async () => {
    const ms = await orgRolesService.listMembers(role.id);
    setMembers(ms);
    if (ms.length) {
      const { data } = await supabase.from("profiles").select("id,display_name,email").in("id", ms.map((m) => m.user_id));
      const map: Record<string, Profile> = {};
      (data ?? []).forEach((p) => { map[(p as Profile).id] = p as Profile; });
      setProfiles(map);
    } else setProfiles({});
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [role.id]);

  const add = async () => {
    if (!picker) return;
    try { await orgRolesService.assign(picker, role.id); setPicker(null); toast.success("Assigned"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (userId: string) => {
    try { await orgRolesService.unassign(userId, role.id); toast.success("Removed"); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Members of "{role.label}"</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1 max-h-60 overflow-auto">
            {members.length === 0 && <p className="text-xs text-muted-foreground py-3 text-center">No members yet.</p>}
            {members.map((m) => {
              const p = profiles[m.user_id];
              return (
                <div key={m.id} className="flex items-center justify-between border-b border-border/40 py-1 last:border-0 text-sm">
                  <span>{p?.display_name ?? p?.email ?? m.user_id.slice(0, 8)}</span>
                  <Button variant="ghost" size="sm" onClick={() => remove(m.user_id)}>Remove</Button>
                </div>
              );
            })}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label>Add person</Label><UserPicker value={picker} onChange={setPicker} /></div>
            <Button onClick={add} disabled={!picker}>Add</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
