import { createFileRoute, redirect } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, RefreshCw, Megaphone, Calendar } from "lucide-react";
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
import { deleteUser, updateUserAdminSettings } from "@/lib/admin-actions";
import { todayISO } from "@/lib/format";
import { fetchAllAnnouncements, createAnnouncement, deleteAnnouncement } from "@/services/announcements.functions";
import { DemoFeedbackDashboard } from "@/components/DemoFeedbackDashboard";

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

  // Custom Banner states
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);

  // New Announcement Form states
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [annEmoji, setAnnEmoji] = useState("📢");
  const [annTheme, setAnnTheme] = useState("default");
  const [annStartDate, setAnnStartDate] = useState("");
  const [annEndDate, setAnnEndDate] = useState("");
  const [annImageUrl, setAnnImageUrl] = useState("");
  const [annIsActive, setAnnIsActive] = useState(true);

  // Local draft state for edits
  const [editedManagers, setEditedManagers] = useState<Record<string, string | null>>({});
  const [editedRoles, setEditedRoles] = useState<Record<string, AppRole>>({});

  const deleteUserFn = useServerFn(deleteUser);
  const updateUserAdminSettingsFn = useServerFn(updateUserAdminSettings);
  const fetchAllAnnouncementsFn = useServerFn(fetchAllAnnouncements);
  const createAnnouncementFn = useServerFn(createAnnouncement);
  const deleteAnnouncementFn = useServerFn(deleteAnnouncement);

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

  const loadAnnouncements = async () => {
    setLoadingAnnouncements(true);
    try {
      const data = await fetchAllAnnouncementsFn();
      setAnnouncements(data ?? []);
    } catch (e) {
      toast.error("Failed to load announcements");
    } finally {
      setLoadingAnnouncements(false);
    }
  };

  useEffect(() => {
    load();
    loadAnnouncements();
  }, []);

  const saveChanges = async (userId: string) => {
    const updatedManagerId = editedManagers[userId];
    const updatedRole = editedRoles[userId];

    setLoading(true);
    try {
      await updateUserAdminSettingsFn({
        data: {
          targetUserId: userId,
          managerId: updatedManagerId !== undefined ? updatedManagerId : undefined,
          role: updatedRole !== undefined ? updatedRole : undefined,
        }
      });

      if (updatedManagerId !== undefined) {
        setEditedManagers(prev => {
          const { [userId]: _, ...rest } = prev;
          return rest;
        });
      }
      if (updatedRole !== undefined) {
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

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim() || !annStartDate || !annEndDate) {
      toast.error("Please fill in all required fields");
      return;
    }

    try {
      await createAnnouncementFn({
        data: {
          title: annTitle.trim(),
          message: annMessage.trim(),
          emoji: annEmoji,
          theme_color: annTheme,
          start_date: annStartDate,
          end_date: annEndDate,
          image_url: annImageUrl.trim() || null,
          is_active: annIsActive
        }
      });

      toast.success("Custom banner created successfully");
      
      // Reset form
      setAnnTitle("");
      setAnnMessage("");
      setAnnEmoji("📢");
      setAnnTheme("default");
      setAnnStartDate("");
      setAnnEndDate("");
      setAnnImageUrl("");
      setAnnIsActive(true);

      loadAnnouncements();
    } catch (e) {
      toast.error((e as Error).message || "Failed to create banner");
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    try {
      await deleteAnnouncementFn({ data: { id } });
      toast.success("Announcement banner deleted");
      loadAnnouncements();
    } catch (e) {
      toast.error("Failed to delete banner");
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin controls</h1>
        <Button variant="outline" size="sm" onClick={() => { load(); loadAnnouncements(); }} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4.5 w-4.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="feedback" className="w-full">
        <TabsList className="flex overflow-x-auto w-full justify-start md:grid md:grid-cols-3 bg-muted/40 p-1 rounded-xl scrollbar-none gap-1 h-auto min-h-11">
          <TabsTrigger value="feedback" className="text-xs font-bold py-2 cursor-pointer text-primary whitespace-nowrap shrink-0 md:shrink px-3">⭐ App Guide Utility Feedback</TabsTrigger>
          <TabsTrigger value="users" className="text-xs font-semibold py-2 cursor-pointer whitespace-nowrap shrink-0 md:shrink px-3">Users & Roles</TabsTrigger>
          <TabsTrigger value="announcements" className="text-xs font-semibold py-2 cursor-pointer whitespace-nowrap shrink-0 md:shrink px-3">Holiday Banners & Custom Notices</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
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
                            className="h-8 px-3 text-xs font-medium cursor-pointer"
                          >
                            Save
                          </Button>
                        )}
                        {p.id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto md:ml-0 cursor-pointer"
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
        </TabsContent>

        <TabsContent value="announcements" className="space-y-6 mt-4">
          {/* Create Custom Banner Form */}
          <Card className="p-5 border-border/50 bg-card/60 backdrop-blur-sm shadow-md space-y-4">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Megaphone className="h-4.5 w-4.5 text-primary" />
              Create Custom Banner / Greeting Override
            </h2>
            <form onSubmit={handleCreateAnnouncement} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Banner Title (e.g. Festival / Event Name)*</label>
                  <Input
                    placeholder="Diwali Holidays"
                    value={annTitle}
                    onChange={(e) => setAnnTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Graphic Emoji*</label>
                  <Input
                    placeholder="🪔"
                    value={annEmoji}
                    onChange={(e) => setAnnEmoji(e.target.value)}
                    className="w-full md:w-32"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Greeting Message / Notice Content*</label>
                <Input
                  placeholder="Wishing you a Happy, Prosperous and Joyful Diwali! Enjoy the breaks."
                  value={annMessage}
                  onChange={(e) => setAnnMessage(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Theme Color / Doodle Template*</label>
                  <Select value={annTheme} onValueChange={setAnnTheme}>
                    <SelectTrigger className="text-xs bg-background/50 border-border/60">
                      <SelectValue placeholder="Select Theme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default Gradient (Indigo/Pink)</SelectItem>
                      <SelectItem value="diwali">Diwali (Orange/Gold & Diya 🪔)</SelectItem>
                      <SelectItem value="uttarayan">Uttarayan (Sky Blue & Kite 🪁)</SelectItem>
                      <SelectItem value="gandhi">Gandhi Jayanti (Green & Glasses 🕊️)</SelectItem>
                      <SelectItem value="tricolor">Tricolor (Patriotic & Chakra 🇮🇳)</SelectItem>
                      <SelectItem value="holi">Holi (Colors Splash 🎨)</SelectItem>
                      <SelectItem value="christmas">Christmas (Red/Green & Tree 🎄)</SelectItem>
                      <SelectItem value="monsoon">Monsoon (Teal/Blue & Cloud 🌧️)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Start Date*</label>
                  <Input
                    type="date"
                    value={annStartDate}
                    onChange={(e) => setAnnStartDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">End Date*</label>
                  <Input
                    type="date"
                    value={annEndDate}
                    onChange={(e) => setAnnEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Custom Image URL (Optional)</label>
                  <Input
                    placeholder="https://example.com/banner-art.png"
                    value={annImageUrl}
                    onChange={(e) => setAnnImageUrl(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-[10px] text-muted-foreground mr-1 self-center">Quick presets:</span>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("https://images.unsplash.com/photo-1513151233558-d860c5398176?w=300&auto=format&fit=crop&q=60")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border/40 cursor-pointer"
                    >
                      🎉 Confetti
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=300&auto=format&fit=crop&q=60")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border/40 cursor-pointer"
                    >
                      ✨ Sparklers
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?w=300&auto=format&fit=crop&q=60")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border/40 cursor-pointer"
                    >
                      🌧️ Rain
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("https://images.unsplash.com/photo-1605647540924-852290f6b0d5?w=300&auto=format&fit=crop&q=60")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border/40 cursor-pointer"
                    >
                      🪔 Diwali Lamps
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("https://images.unsplash.com/photo-1598463289996-0e34c9c1b790?w=300&auto=format&fit=crop&q=60")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border/40 cursor-pointer"
                    >
                      🪁 Kites
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnImageUrl("")}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id="annIsActive"
                    checked={annIsActive}
                    onChange={(e) => setAnnIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="annIsActive" className="text-xs font-semibold text-muted-foreground cursor-pointer select-none">
                    Active (Render banner during set dates)
                  </label>
                </div>
              </div>

              <Button type="submit" className="w-full text-xs py-2 font-bold cursor-pointer">
                Deploy Custom Banner Announcement
              </Button>
            </form>
          </Card>

          {/* List of custom banners */}
          <Card className="p-5 border-border/50 bg-card/60 backdrop-blur-sm shadow-md space-y-4">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Calendar className="h-4.5 w-4.5 text-primary" />
              Scheduled Announcements
            </h2>

            <div className="space-y-3">
              {loadingAnnouncements ? (
                <p className="text-center py-4 text-xs text-muted-foreground italic">Loading banners...</p>
              ) : announcements.length === 0 ? (
                <p className="text-center py-4 text-xs text-muted-foreground italic">No custom banners created yet.</p>
              ) : (
                announcements.map((ann) => {
                  const todayStr = todayISO();
                  const isActiveToday = ann.is_active && todayStr >= ann.start_date && todayStr <= ann.end_date;
                  return (
                    <div key={ann.id} className="flex items-start justify-between gap-3 p-3 border border-border/40 rounded-xl bg-background/40 hover:bg-background/80 transition-colors">
                      <div className="flex items-start gap-2.5">
                        <span className="text-xl p-1 bg-accent/40 rounded">{ann.emoji}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-xs text-foreground">{ann.title}</h3>
                            {isActiveToday && (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[9px] font-bold px-1.5 py-0">
                                Active Today
                              </Badge>
                            )}
                            {!ann.is_active && (
                              <Badge className="bg-muted text-muted-foreground text-[9px] font-bold px-1.5 py-0">
                                Disabled
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ann.message}</p>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mt-1">
                            <span>📅 Dates: {ann.start_date} to {ann.end_date}</span>
                            <span>•</span>
                            <span className="capitalize">Theme: {ann.theme_color}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        onClick={() => handleDeleteAnnouncement(ann.id)}
                      >
                        <Trash2 className="h-4.5 w-4.5" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <DemoFeedbackDashboard />
        </TabsContent>
      </Tabs>

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
