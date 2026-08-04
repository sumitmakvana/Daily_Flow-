import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { notifPrefsService } from "@/services/notif-prefs";
import { dispatchEodTestEmailFn } from "@/services/notif-prefs.functions";
import type { NotificationPrefs } from "@/lib/types";
import { toast } from "sonner";
import { Save, Send, CheckCircle2, Users, Mail, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotifPrefsPage,
});

function NotifPrefsPage() {
  const { user, isManager } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    notifPrefsService.get(user.id).then((p) => {
      if (p) {
        setPrefs({
          ...p,
          eod_send_to_managers: p.eod_send_to_managers ?? true,
          eod_send_to_admins: p.eod_send_to_admins ?? false,
          eod_send_to_custom: p.eod_send_to_custom ?? true,
          custom_target_email: p.custom_target_email || "sumitmakvana535@gmail.com",
        });
      }
    });
  }, [user?.id]);

  if (!user || !prefs) return null;

  const update = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await notifPrefsService.save(prefs);
      setPrefs({
        ...saved,
        eod_send_to_managers: saved.eod_send_to_managers ?? prefs.eod_send_to_managers,
        eod_send_to_admins: saved.eod_send_to_admins ?? prefs.eod_send_to_admins,
        eod_send_to_custom: saved.eod_send_to_custom ?? prefs.eod_send_to_custom,
        custom_target_email: saved.custom_target_email || prefs.custom_target_email,
      });
      toast.success("Notification preferences saved successfully!");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendToManagers = prefs.eod_send_to_managers ?? true;
  const sendToAdmins = prefs.eod_send_to_admins ?? false;
  const sendToCustom = prefs.eod_send_to_custom ?? true;
  const customTargetEmail = prefs.custom_target_email || "sumitmakvana535@gmail.com";

  return (
    <div className="max-w-xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notification preferences</h1>
        <Button onClick={save} disabled={busy} size="sm" className="gap-1.5 shadow-sm">
          <Save className="w-4 h-4" /> {busy ? "Saving…" : "Save All Changes"}
        </Button>
      </div>

      {isManager && (
        <div className="flex gap-2 border-b border-border pb-2">
          <Link
            to="/settings/notifications"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
            inactiveProps={{
              className: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
            }}
          >
            Notifications
          </Link>
          <Link
            to="/settings/operations"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
            inactiveProps={{
              className: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
            }}
          >
            Operations
          </Link>
        </div>
      )}

      <Card className="p-3 space-y-3">
        <Row
          label="Morning digest"
          description="One summary in the morning instead of per-event pings."
        >
          <Switch
            checked={prefs.digest_enabled}
            onCheckedChange={(v) => update("digest_enabled", v)}
          />
        </Row>
        <div>
          <div className="text-sm font-medium">EOD reminder hour</div>
          <p className="text-xs text-muted-foreground">
            When the end-of-day banner appears on the Today screen.
          </p>
          <Slider
            className="mt-2"
            min={12}
            max={20}
            step={1}
            value={[prefs.eod_reminder_hour]}
            onValueChange={(v) => update("eod_reminder_hour", v[0] ?? 16)}
          />
          <div className="text-right text-xs text-muted-foreground mt-1">
            {prefs.eod_reminder_hour}:00
          </div>
        </div>
      </Card>

      {isManager && (
        <Card className="p-4 space-y-4 border-indigo-500/30 bg-indigo-500/5 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Mail className="w-4 h-4 text-indigo-500" />
              <span>EOD Email & PDF Digest Settings</span>
            </h2>
            <Switch
              checked={prefs.digest_enabled}
              onCheckedChange={(v) => update("digest_enabled", v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Receive an automated End-of-Day team performance summary with a PDF attachment at 6:00
            PM IST.
          </p>

          {prefs.digest_enabled && (
            <div className="pt-3 space-y-3 border-t border-border/40">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground block">
                  Select Recipient Group(s) (Multiple Selection Allowed):
                </label>
                <span className="text-[11px] text-indigo-400 font-medium">Checkbox selection</span>
              </div>

              <div className="space-y-2 text-xs">
                {/* Option 1: Direct Managers */}
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    sendToManagers
                      ? "border-indigo-500/50 bg-indigo-500/10 shadow-xs"
                      : "border-border/50 bg-background/60 hover:bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={sendToManagers}
                    onChange={(e) => update("eod_send_to_managers", e.target.checked)}
                    className="accent-indigo-600 w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-400" /> Direct Managers
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Send team status report to respective direct manager emails
                    </div>
                  </div>
                </label>

                {/* Option 2: System Admins */}
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    sendToAdmins
                      ? "border-indigo-500/50 bg-indigo-500/10 shadow-xs"
                      : "border-border/50 bg-background/60 hover:bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={sendToAdmins}
                    onChange={(e) => update("eod_send_to_admins", e.target.checked)}
                    className="accent-indigo-600 w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" /> All System Admins &
                      Leadership
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Broadcast team report to all admin accounts
                    </div>
                  </div>
                </label>

                {/* Option 3: Custom Target Emails */}
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    sendToCustom
                      ? "border-emerald-500/60 bg-emerald-500/15 shadow-xs"
                      : "border-border/50 bg-background/60 hover:bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={sendToCustom}
                    onChange={(e) => update("eod_send_to_custom", e.target.checked)}
                    className="accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      🎯 Designated Custom Email Address(es)
                    </div>
                    <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                      Send report to target emails specified below (supports multiple
                      comma-separated emails)
                    </div>
                  </div>
                </label>
              </div>

              {/* Target Email Input */}
              <div className="pt-2">
                <label className="text-xs font-bold text-foreground block mb-1">
                  Target Email Address(es) for EOD PDF Report (Comma-separated)
                </label>
                <input
                  type="text"
                  value={customTargetEmail}
                  onChange={(e) => update("custom_target_email", e.target.value)}
                  placeholder="e.g. sumitmakvana535@gmail.com, manager@company.com"
                  className="w-full bg-background border border-emerald-500/50 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-semibold"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-between gap-2 flex-wrap">
                <Button
                  size="sm"
                  type="button"
                  onClick={save}
                  disabled={busy}
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs h-8.5 gap-1.5 font-semibold"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save EOD Settings"}
                </Button>

                <Button
                  size="sm"
                  type="button"
                  onClick={async () => {
                    try {
                      toast.info(`Sending EOD Email Report to ${customTargetEmail}...`);
                      const res = await dispatchEodTestEmailFn({
                        data: { targetEmail: customTargetEmail },
                      });
                      if (res.ok) {
                        toast.success(
                          `EOD Email & PDF Report dispatched to ${res.sentTo.join(", ")}!`,
                        );
                      } else {
                        toast.error(res.result?.error || "Failed to dispatch email");
                      }
                    } catch (err) {
                      toast.error("Error triggering EOD Email dispatch: " + (err as Error).message);
                    }
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8.5 gap-1.5 shadow-sm font-semibold"
                >
                  <Send className="w-3.5 h-3.5" /> Send EOD Email Now (Instant Test)
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-3 space-y-3">
        <h2 className="text-sm font-semibold">Per-event alerts</h2>
        <Row label="New assignment">
          <Switch
            checked={prefs.notify_assignment}
            onCheckedChange={(v) => update("notify_assignment", v)}
          />
        </Row>
        <Row label="Priority changed">
          <Switch
            checked={prefs.notify_priority_change}
            onCheckedChange={(v) => update("notify_priority_change", v)}
          />
        </Row>
        <Row label="Blocker resolved">
          <Switch
            checked={prefs.notify_blocker_resolved}
            onCheckedChange={(v) => update("notify_blocker_resolved", v)}
          />
        </Row>
      </Card>

      <Card className="p-3 space-y-3">
        <h2 className="text-sm font-semibold">Manager alerts</h2>
        <Row label="Overload warnings">
          <Switch
            checked={prefs.notify_manager_overload}
            onCheckedChange={(v) => update("notify_manager_overload", v)}
          />
        </Row>
        <Row label="High-priority delays">
          <Switch
            checked={prefs.notify_manager_delays}
            onCheckedChange={(v) => update("notify_manager_delays", v)}
          />
        </Row>
      </Card>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={busy} className="gap-2 shadow-md">
          <Save className="w-4 h-4" /> {busy ? "Saving…" : "Save All Preferences"}
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div>
        <div className="font-medium text-foreground">{label}</div>
        {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}
