import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check, ExternalLink } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { AppNotification } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotifPage,
});

function NotifPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    setItems((data ?? []) as AppNotification[]);
  };
  useEffect(() => { load(); }, [user?.id]);

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() } as never).eq("user_id", user.id).is("read_at", null);
    load();
  };

  const handleClick = async (n: AppNotification) => {
    // Mark this single notification as read
    if (!n.read_at) {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() } as never)
        .eq("id", n.id);
      load();
    }

    // Navigate to the relevant page based on the notification type
    if (n.task_id) {
      navigate({ to: "/tasks", search: { highlightId: n.task_id } });
    } else if (["eod_digest", "sod_digest"].includes(n.type)) {
      navigate({ to: "/my-day" });
    } else if (["eod_team_digest", "sod_team_digest"].includes(n.type)) {
      navigate({ to: "/manager" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-3 md:px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Bell className="h-5 w-5" /> Inbox</h1>
        <Button variant="ghost" size="sm" onClick={markAll}><Check className="h-3.5 w-3.5 mr-1" /> Mark all read</Button>
      </div>
      <div className="space-y-2">
        {items.map((n) => {
          const isClickable = !!n.task_id || ["eod_digest", "sod_digest", "eod_team_digest", "sod_team_digest"].includes(n.type);
          return (
            <Card
              key={n.id}
              className={`p-3 transition-colors ${!n.read_at ? "border-primary/40" : ""} ${isClickable ? "cursor-pointer hover:bg-accent/50" : ""}`}
              onClick={() => isClickable && handleClick(n)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {n.title}
                    {isClickable && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </div>
                  {n.body && <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{n.body}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!n.read_at && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                  <span className="text-[10px] text-muted-foreground">{formatRelative(n.created_at)}</span>
                </div>
              </div>
            </Card>
          );
        })}
        {items.length === 0 && <p className="text-sm text-muted-foreground italic">No notifications.</p>}
      </div>
    </div>
  );
}
