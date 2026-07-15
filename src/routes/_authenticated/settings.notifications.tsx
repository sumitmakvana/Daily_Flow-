import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { notifPrefsService } from "@/services/notif-prefs";
import type { NotificationPrefs } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotifPrefsPage,
});

function NotifPrefsPage() {
  const { user, isManager } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    notifPrefsService.get(user.id).then(setPrefs);
  }, [user?.id]);

  if (!user || !prefs) return null;

  const update = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await notifPrefsService.save(prefs);
      setPrefs(saved);
      toast.success("Preferences saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold">Notification preferences</h1>

      {isManager && (
        <div className="flex gap-2 border-b border-border pb-2">
          <Link
            to="/settings/notifications"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground hover:bg-accent/40" }}
          >
            Notifications
          </Link>
          <Link
            to="/settings/operations"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground hover:bg-accent/40" }}
          >
            Operations
          </Link>
        </div>
      )}

      <Card className="p-3 space-y-3">
        <Row label="Morning digest" description="One summary in the morning instead of per-event pings.">
          <Switch checked={prefs.digest_enabled} onCheckedChange={(v) => update("digest_enabled", v)} />
        </Row>
        <div>
          <div className="text-sm font-medium">EOD reminder hour</div>
          <p className="text-xs text-muted-foreground">When the end-of-day banner appears on the Today screen.</p>
          <Slider
            className="mt-2"
            min={12} max={20} step={1}
            value={[prefs.eod_reminder_hour]}
            onValueChange={(v) => update("eod_reminder_hour", v[0] ?? 16)}
          />
          <div className="text-right text-xs text-muted-foreground mt-1">{prefs.eod_reminder_hour}:00</div>
        </div>
      </Card>

      <Card className="p-3 space-y-3">
        <h2 className="text-sm font-semibold">Per-event alerts</h2>
        <Row label="New assignment"><Switch checked={prefs.notify_assignment} onCheckedChange={(v) => update("notify_assignment", v)} /></Row>
        <Row label="Priority changed"><Switch checked={prefs.notify_priority_change} onCheckedChange={(v) => update("notify_priority_change", v)} /></Row>
        <Row label="Blocker resolved"><Switch checked={prefs.notify_blocker_resolved} onCheckedChange={(v) => update("notify_blocker_resolved", v)} /></Row>
      </Card>

      <Card className="p-3 space-y-3">
        <h2 className="text-sm font-semibold">Manager alerts</h2>
        <Row label="Overload warnings"><Switch checked={prefs.notify_manager_overload} onCheckedChange={(v) => update("notify_manager_overload", v)} /></Row>
        <Row label="High-priority delays"><Switch checked={prefs.notify_manager_delays} onCheckedChange={(v) => update("notify_manager_delays", v)} /></Row>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
      </div>
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}
