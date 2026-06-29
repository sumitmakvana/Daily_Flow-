import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { AppNotification } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotifPage,
});

function NotifPage() {
  const { user } = useAuth();
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

  return (
    <div className="max-w-2xl mx-auto px-3 md:px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Bell className="h-5 w-5" /> Inbox</h1>
        <Button variant="ghost" size="sm" onClick={markAll}><Check className="h-3.5 w-3.5 mr-1" /> Mark all read</Button>
      </div>
      <div className="space-y-2">
        {items.map((n) => (
          <Card key={n.id} className={`p-3 ${!n.read_at ? "border-primary/40" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{formatRelative(n.created_at)}</span>
            </div>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground italic">No notifications.</p>}
      </div>
    </div>
  );
}
