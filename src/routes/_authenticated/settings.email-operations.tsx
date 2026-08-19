import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workSettingsService } from "@/services/operations";
import { notifPrefsService } from "@/services/notif-prefs";
import {
  dispatchEodTestEmailFn,
  dispatchMemberEodTestEmailFn,
  dispatchMorningNudgeTestEmailFn,
} from "@/services/notif-prefs.functions";
import type { WorkSettings, NotificationPrefs } from "@/lib/types";
import { toast } from "sonner";
import { Save, Send, CheckCircle2, Users, Mail, ShieldAlert, Clock, Activity } from "lucide-react";

function TimeDropdownPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [hStr, mStr] = (value || "12:00").split(":");
  let mVal = parseInt(mStr, 10) || 0;
  mVal = Math.round(mVal / 5) * 5;
  if (mVal === 60) mVal = 55;
  const currentHour = hStr || "12";
  const currentMinute = String(mVal).padStart(2, "0");

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Select value={currentHour} onValueChange={(h) => onChange(`${h}:${currentMinute}`)}>
        <SelectTrigger className="w-[75px] bg-background text-foreground [color-scheme:dark]">
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent className="bg-popover border border-border max-h-[200px]">
          {hours.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground font-semibold">:</span>
      <Select value={currentMinute} onValueChange={(m) => onChange(`${currentHour}:${m}`)}>
        <SelectTrigger className="w-[75px] bg-background text-foreground [color-scheme:dark]">
          <SelectValue placeholder="MM" />
        </SelectTrigger>
        <SelectContent className="bg-popover border border-border max-h-[200px]">
          {minutes.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/settings/email-operations")({
  component: EmailOperationsPage,
});

function EmailOperationsPage() {
  const { user, isManager } = useAuth();
  const [workSettings, setWorkSettings] = useState<WorkSettings | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([workSettingsService.get(), notifPrefsService.get(user.id)]).then(
      ([ws, p]) => {
        setWorkSettings(ws);
        if (p) {
          setPrefs({
            ...p,
            eod_send_to_managers: p.eod_send_to_managers ?? true,
            eod_send_to_admins: p.eod_send_to_admins ?? false,
            eod_send_to_custom: p.eod_send_to_custom ?? true,
            custom_target_email: p.custom_target_email ?? (user.email || ""),
          });
        }
      },
    );
  }, [user?.id]);

  if (!isManager) {
    return (
      <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">
        Managers only.
      </div>
    );
  }

  if (!workSettings || !prefs) return null;

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const validateTargetEmails = (emailsStr: string): boolean => {
    const list = emailsStr
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (list.length === 0) {
      toast.error("Please enter at least one target email address.");
      return false;
    }
    for (const email of list) {
      if (!emailRegex.test(email)) {
        toast.error(`❌ Invalid email format: "${email}". Please enter a valid email address.`);
        return false;
      }
    }
    return true;
  };

  const saveAll = async () => {
    if (prefs.eod_send_to_custom && !validateTargetEmails(prefs.custom_target_email || "")) {
      return;
    }

    setBusy(true);
    try {
      await Promise.all([
        workSettingsService.update({
          daily_capacity_hours: workSettings.daily_capacity_hours,
          sla_default_days: workSettings.sla_default_days,
          workdays: workSettings.workdays,
          morning_digest_time: workSettings.morning_digest_time ?? "10:00",
          evening_digest_time: workSettings.evening_digest_time ?? "18:00",
          no_tasks_reminder_interval: workSettings.no_tasks_reminder_interval ?? 20,
        }),
        notifPrefsService.save(prefs),
      ]);
      toast.success("Email operations settings saved successfully!");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendToManagers = prefs.eod_send_to_managers ?? true;
  const sendToAdmins = prefs.eod_send_to_admins ?? false;
  const sendToCustom = prefs.eod_send_to_custom ?? true;
  const customTargetEmail = prefs.custom_target_email ?? (user?.email || "");

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Email Operations</h1>
        <Button onClick={saveAll} disabled={busy} size="sm" className="gap-1.5 shadow-sm">
          <Save className="w-4 h-4" /> {busy ? "Saving…" : "Save Changes"}
        </Button>
      </div>

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
        <Link
          to="/settings/email-operations"
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
          inactiveProps={{
            className: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
          }}
        >
          Email Operations
        </Link>
      </div>

      {/* 1. Global Schedules */}
      <Card className="p-4 space-y-4 border-indigo-500/30 bg-indigo-500/5">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" />
          <span>Digest Schedules & Reminder Frequencies</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Morning Digest Time</Label>
            <TimeDropdownPicker
              value={workSettings.morning_digest_time ?? "10:00"}
              onChange={(val) => setWorkSettings({ ...workSettings, morning_digest_time: val })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Evening Digest Time</Label>
            <TimeDropdownPicker
              value={workSettings.evening_digest_time ?? "18:00"}
              onChange={(val) => setWorkSettings({ ...workSettings, evening_digest_time: val })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">No Tasks / Unstarted Tasks Nudge Interval</Label>
          <Select
            value={String(workSettings.no_tasks_reminder_interval ?? 20)}
            onValueChange={(val) =>
              setWorkSettings({ ...workSettings, no_tasks_reminder_interval: Number(val) })
            }
          >
            <SelectTrigger className="w-full bg-background text-foreground [color-scheme:dark] mt-1">
              <SelectValue placeholder="Select interval" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Disabled</SelectItem>
              <SelectItem value="10">Every 10 minutes</SelectItem>
              <SelectItem value="20">Every 20 minutes</SelectItem>
              <SelectItem value="30">Every 30 minutes</SelectItem>
              <SelectItem value="60">Every hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* 2. Recipient Groups */}
      <Card className="p-4 space-y-4 border-indigo-500/30 bg-indigo-500/5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4 text-indigo-500" />
            <span>EOD Team Digest Recipient Settings</span>
          </h2>
          <Switch
            checked={prefs.digest_enabled}
            onCheckedChange={(v) => setPrefs({ ...prefs, digest_enabled: v })}
          />
        </div>

        {prefs.digest_enabled && (
          <div className="pt-3 space-y-3 border-t border-border/40">
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
                  onChange={(e) => setPrefs({ ...prefs, eod_send_to_managers: e.target.checked })}
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
                  onChange={(e) => setPrefs({ ...prefs, eod_send_to_admins: e.target.checked })}
                  className="accent-indigo-600 w-4 h-4 rounded cursor-pointer"
                />
                <div className="flex-1">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" /> System Admins
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
                  onChange={(e) => setPrefs({ ...prefs, eod_send_to_custom: e.target.checked })}
                  className="accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                />
                <div className="flex-1">
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    🎯 Designated Custom Email Address(es)
                  </div>
                  <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                    Send report to target emails specified below (supports comma-separated list)
                  </div>
                </div>
              </label>
            </div>

            {/* Target Email Input */}
            <div className="pt-2">
              <Label className="text-xs font-bold block mb-1">
                Target Email Address(es) for Reports
              </Label>
              <input
                type="text"
                value={customTargetEmail}
                onChange={(e) => setPrefs({ ...prefs, custom_target_email: e.target.value })}
                placeholder="e.g. manager@company.com, admin@company.com"
                className="w-full bg-background border border-emerald-500/50 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-semibold"
              />
            </div>
          </div>
        )}
      </Card>

      {/* 3. Provider Status & Instant Test */}
      <Card className="p-4 space-y-4">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-500" />
          <span>Email Provider Status & Instant Dispatch Tests</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Email system is active via backend SMTP or Microsoft Graph API. You can trigger instant test emails to your designated target address below.
        </p>

        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <span className="text-xs text-emerald-500 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Ready to dispatch
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {/* Button 1: Morning Nudge Test Email */}
            <Button
              size="sm"
              type="button"
              onClick={async () => {
                if (sendToCustom && !validateTargetEmails(customTargetEmail)) {
                  return;
                }
                try {
                  toast.info(`Sending Morning Nudge Test Email to ${customTargetEmail}...`);
                  const res = await dispatchMorningNudgeTestEmailFn({
                    data: { targetEmail: customTargetEmail },
                  });
                  if (res.ok) {
                    toast.success(`Morning Nudge Email dispatched to ${res.sentTo.join(", ")}!`);
                  } else {
                    toast.error(res.result?.error || "Failed to dispatch email");
                  }
                } catch (err) {
                  toast.error("Error triggering email: " + (err as Error).message);
                }
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8.5 gap-1.5 shadow-sm font-semibold"
            >
              <Send className="w-3.5 h-3.5" /> Test Morning Nudge Email
            </Button>

            {/* Button 2: Team Member EOD Check-in Test */}
            <Button
              size="sm"
              type="button"
              onClick={async () => {
                if (sendToCustom && !validateTargetEmails(customTargetEmail)) {
                  return;
                }
                try {
                  toast.info(`Sending Member EOD Check-in Test Email to ${customTargetEmail}...`);
                  const res = await dispatchMemberEodTestEmailFn({
                    data: { targetEmail: customTargetEmail },
                  });
                  if (res.ok) {
                    toast.success(`Member EOD Email dispatched to ${res.sentTo.join(", ")}!`);
                  } else {
                    toast.error(res.result?.error || "Failed to dispatch email");
                  }
                } catch (err) {
                  toast.error("Error triggering email: " + (err as Error).message);
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8.5 gap-1.5 shadow-sm font-semibold"
            >
              <Send className="w-3.5 h-3.5" /> Test Member EOD Check-in Email
            </Button>

            {/* Button 3: Manager EOD Team Summary Report Test */}
            <Button
              size="sm"
              type="button"
              onClick={async () => {
                if (sendToCustom && !validateTargetEmails(customTargetEmail)) {
                  return;
                }
                try {
                  toast.info(`Sending Manager EOD Report to ${customTargetEmail}...`);
                  const res = await dispatchEodTestEmailFn({
                    data: { targetEmail: customTargetEmail },
                  });
                  if (res.ok) {
                    toast.success(`Manager EOD Report dispatched to ${res.sentTo.join(", ")}!`);
                  } else {
                    toast.error(res.result?.error || "Failed to dispatch email");
                  }
                } catch (err) {
                  toast.error("Error triggering email: " + (err as Error).message);
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8.5 gap-1.5 shadow-sm font-semibold"
            >
              <Send className="w-3.5 h-3.5" /> Test Manager EOD Summary Report
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
