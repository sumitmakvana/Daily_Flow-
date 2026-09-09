import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { teamsService, projectsService, workSettingsService, holidaysService } from "@/services/operations";
import type { Team, Project, WorkSettings, HolidayCalendar } from "@/lib/types";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { fetchIndianHolidays } from "@/lib/format";
import { Calendar as CalendarIcon, Building2, Trash2, Plus, Palmtree, Download } from "lucide-react";

const CURATED_HOLIDAYS_BY_YEAR: Record<number, Array<{ date: string; label: string }>> = {
  2025: [
    { date: "2025-01-14", label: "Makar Sankranti" },
    { date: "2025-01-26", label: "Republic Day" },
    { date: "2025-03-15", label: "Holi 2nd Day – Dhuleti" },
    { date: "2025-08-09", label: "Raksha Bandhan" },
    { date: "2025-08-15", label: "Independence Day" },
    { date: "2025-08-16", label: "Janmashtami (Shravan Vad-8)" },
    { date: "2025-10-02", label: "Mahatma Gandhi's Birthday" },
    { date: "2025-10-02", label: "Dusshera (Vijaya Dashmi)" },
    { date: "2025-10-20", label: "Diwali" },
    { date: "2025-10-22", label: "Vikram Samvant New Year Day" },
    { date: "2025-10-23", label: "Bhai Bij" },
  ],
  2026: [
    { date: "2026-01-14", label: "Makar Sankranti" },
    { date: "2026-01-26", label: "Republic Day" },
    { date: "2026-03-04", label: "Holi 2nd Day – Dhuleti" },
    { date: "2026-08-15", label: "Independence Day" },
    { date: "2026-08-28", label: "Raksha Bandhan" },
    { date: "2026-09-04", label: "Janmashtami (Shravan Vad-8)" },
    { date: "2026-10-02", label: "Mahatma Gandhi's Birthday" },
    { date: "2026-10-20", label: "Dusshera (Vijaya Dashmi)" },
    { date: "2026-11-08", label: "Diwali" },
    { date: "2026-11-10", label: "Vikram Samvant New Year Day" },
    { date: "2026-11-11", label: "Bhai Bij" },
  ],
  2027: [
    { date: "2027-01-14", label: "Makar Sankranti" },
    { date: "2027-01-26", label: "Republic Day" },
    { date: "2027-03-23", label: "Holi 2nd Day – Dhuleti" },
    { date: "2027-08-15", label: "Independence Day" },
    { date: "2027-08-17", label: "Raksha Bandhan" },
    { date: "2027-08-25", label: "Janmashtami (Shravan Vad-8)" },
    { date: "2027-10-02", label: "Mahatma Gandhi's Birthday" },
    { date: "2027-10-09", label: "Dusshera (Vijaya Dashmi)" },
    { date: "2027-10-29", label: "Diwali" },
    { date: "2027-10-30", label: "Vikram Samvant New Year Day" },
    { date: "2027-10-31", label: "Bhai Bij" },
  ],
  2028: [
    { date: "2028-01-14", label: "Makar Sankranti" },
    { date: "2028-01-26", label: "Republic Day" },
    { date: "2028-03-11", label: "Holi 2nd Day – Dhuleti" },
    { date: "2028-08-05", label: "Raksha Bandhan" },
    { date: "2028-08-13", label: "Janmashtami (Shravan Vad-8)" },
    { date: "2028-08-15", label: "Independence Day" },
    { date: "2028-09-28", label: "Dusshera (Vijaya Dashmi)" },
    { date: "2028-10-02", label: "Mahatma Gandhi's Birthday" },
    { date: "2028-10-17", label: "Diwali" },
    { date: "2028-10-18", label: "Vikram Samvant New Year Day" },
    { date: "2028-10-19", label: "Bhai Bij" },
  ],
};

function formatHolidayDate(dateStr: unknown) {
  try {
    const raw = typeof dateStr === "string" ? dateStr : (dateStr instanceof Date ? dateStr.toISOString() : String(dateStr || ""));
    const [y, m, d] = raw.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
    const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { dayName, formatted };
  } catch (e) {
    return { dayName: "", formatted: String(dateStr || "") };
  }
}

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

export const Route = createFileRoute("/_authenticated/settings/operations")({
  component: OpsSettings,
});

function OpsSettings() {
  const { isManager } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [holidays, setHolidays] = useState<HolidayCalendar[]>([]);
  const [settings, setSettings] = useState<WorkSettings | null>(null);
  const [serverSettings, setServerSettings] = useState<WorkSettings | null>(null);
  const [selectedImportYear, setSelectedImportYear] = useState<number>(2026);

  const load = async () => {
    const [t, p, h, s] = await Promise.all([
      teamsService.list(), projectsService.list(), holidaysService.list(), workSettingsService.get(),
    ]);
    setTeams(t);
    setProjects(p);
    setHolidays(h);
    setServerSettings((prevServer) => {
      if (!prevServer || JSON.stringify(prevServer) !== JSON.stringify(s)) {
        setSettings((prevDraft) => {
          if (!prevDraft || !prevServer || JSON.stringify(prevDraft) === JSON.stringify(prevServer)) {
            return s;
          }
          return prevDraft;
        });
      }
      return s;
    });
  };
  useEffect(() => { load(); }, []);
  useRealtimeTasks(load, "settings-ops-rt");

  if (!isManager) {
    return <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">Managers only.</div>;
  }
  if (!settings) return null;

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-5">
      <h1 className="text-xl font-semibold">Operations settings</h1>

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
          <Link
            to="/settings/email-operations"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            activeProps={{ className: "bg-primary text-primary-foreground font-semibold" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground hover:bg-accent/40" }}
          >
            Email Operations
          </Link>
        </div>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Work settings</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Daily capacity (hours)</Label>
            <Input
              type="number" step="0.5" min="1" max="24"
              value={settings.daily_capacity_hours}
              onChange={(e) => setSettings({ ...settings, daily_capacity_hours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Default SLA (days)</Label>
            <Input
              type="number" min="1" max="60"
              value={settings.sla_default_days}
              onChange={(e) => setSettings({ ...settings, sla_default_days: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Morning digest time</Label>
            <TimeDropdownPicker
              value={settings.morning_digest_time ?? "10:00"}
              onChange={(val) => setSettings({ ...settings, morning_digest_time: val })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Evening digest time</Label>
            <TimeDropdownPicker
              value={settings.evening_digest_time ?? "18:00"}
              onChange={(val) => setSettings({ ...settings, evening_digest_time: val })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">No Tasks Reminder Interval</Label>
          <Select
            value={String(settings.no_tasks_reminder_interval ?? 20)}
            onValueChange={(val) => setSettings({ ...settings, no_tasks_reminder_interval: Number(val) })}
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
        <div>
          <Label className="text-xs">Workdays (1=Mon … 7=Sun)</Label>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = settings.workdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSettings({
                    ...settings,
                    workdays: on ? settings.workdays.filter((x) => x !== d) : [...settings.workdays, d].sort(),
                  })}
                  className={"h-9 w-9 rounded-md border text-xs font-medium " + (on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground")}
                >{"MTWTFSS"[d - 1]}</button>
              );
            })}
          </div>
        </div>
        <Button size="sm" onClick={async () => {
          await workSettingsService.update({
            daily_capacity_hours: settings.daily_capacity_hours,
            sla_default_days: settings.sla_default_days,
            workdays: settings.workdays,
            morning_digest_time: settings.morning_digest_time ?? "10:00",
            evening_digest_time: settings.evening_digest_time ?? "18:00",
            no_tasks_reminder_interval: settings.no_tasks_reminder_interval ?? 20,
          });
          toast.success("Settings saved");
        }}>Save</Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Teams</h2>
        <TeamCreator onCreated={load} teams={teams} />
        <ul className="text-sm divide-y divide-border">
          {teams.map((t) => (
            <li key={t.id} className="py-2 flex justify-between">
              <span>{t.name}{t.parent_team_id && <span className="text-xs text-muted-foreground"> · under {teams.find((p) => p.id === t.parent_team_id)?.name}</span>}</span>
              <button onClick={async () => { await teamsService.delete(t.id); load(); }} className="text-xs text-muted-foreground hover:text-priority-high">Remove</button>
            </li>
          ))}
          {teams.length === 0 && <li className="py-2 text-xs italic text-muted-foreground">No teams yet.</li>}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Projects</h2>
        <ProjectCreator teams={teams} defaultSla={settings.sla_default_days} onCreated={load} />
        <ul className="text-sm divide-y divide-border">
          {projects.map((p) => (
            <li key={p.id} className="py-2 flex justify-between text-xs items-center">
              <span><span className="font-medium text-sm">{p.name}</span> · {p.client ?? "—"} · SLA {p.sla_days}d</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{teams.find((t) => t.id === p.team_id)?.name ?? "—"}</span>
                <button
                  onClick={async () => {
                    await projectsService.delete(p.id);
                    load();
                  }}
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
          {projects.length === 0 && <li className="py-2 text-xs italic text-muted-foreground">No projects yet.</li>}
        </ul>
      </Card>

      {/* Official Company Holidays Section */}
      <Card className="p-4 md:p-5 space-y-4 border border-border/60 shadow-xs bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-muted text-muted-foreground border border-border">
                <Building2 className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-foreground tracking-tight">Official Company Office Holidays</h2>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                {holidays.length} {holidays.length === 1 ? "Holiday" : "Holidays"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Configure official office closure days. These automatically reflect on the Calendar, skip task start dates, and deduct from SLA working hours.
            </p>
          </div>

          {/* Dynamic Year Import Selector */}
          <div className="flex items-center gap-2">
            <Select value={String(selectedImportYear)} onValueChange={(val) => setSelectedImportYear(Number(val))}>
              <SelectTrigger className="h-8 w-24 text-xs bg-background border-border">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2027">2027</SelectItem>
                <SelectItem value="2028">2028</SelectItem>
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  toast.loading(`Importing ${selectedImportYear} Public Holidays...`, { id: "import-holidays" });
                  const curated = CURATED_HOLIDAYS_BY_YEAR[selectedImportYear];
                  if (curated && curated.length > 0) {
                    for (const h of curated) {
                      await holidaysService.add(h.date, h.label);
                    }
                  } else {
                    const fetched = await fetchIndianHolidays(selectedImportYear);
                    const list = Object.entries(fetched);
                    if (list.length === 0) {
                      toast.error(`No public holiday records found for ${selectedImportYear}`, { id: "import-holidays" });
                      return;
                    }
                    for (const [dateStr, hObj] of list) {
                      await holidaysService.add(dateStr, hObj.name);
                    }
                  }
                  toast.success(`Holidays for ${selectedImportYear} imported successfully!`, { id: "import-holidays" });
                  load();
                } catch (err) {
                  toast.error("Failed to import holidays: " + (err as Error).message, { id: "import-holidays" });
                }
              }}
              className="text-xs gap-1.5 border-border bg-background hover:bg-muted text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-muted-foreground" />
              Import {selectedImportYear} List
            </Button>
          </div>
        </div>

        {/* Creator Input Bar */}
        <HolidayCreator onCreated={load} />

        {/* Holidays Table / List View */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-background/50">
          {holidays.length > 0 ? (
            <div className="divide-y divide-border/40 text-xs">
              <div className="grid grid-cols-12 bg-muted/40 px-3.5 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40">
                <div className="col-span-3">Date</div>
                <div className="col-span-2">Day</div>
                <div className="col-span-5">Holiday Name</div>
                <div className="col-span-2 text-right">Action</div>
              </div>
              {holidays.map((h) => {
                const { dayName, formatted } = formatHolidayDate(h.calendar_date);
                return (
                  <div key={h.id} className="grid grid-cols-12 items-center px-3.5 py-2.5 hover:bg-accent/20 transition-colors">
                    <div className="col-span-3 font-mono font-medium text-foreground flex items-center gap-1.5">
                      <CalendarIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{formatted}</span>
                    </div>
                    <div className="col-span-2 text-muted-foreground font-medium">
                      {dayName}
                    </div>
                    <div className="col-span-5 font-medium text-foreground flex items-center gap-2">
                      <span>{h.label}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border">
                        Office Closed
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          await holidaysService.remove(h.id);
                          toast.success(`Removed ${h.label}`);
                          load();
                        }}
                        className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                        title="Remove holiday"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 px-4 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-muted/60 mx-auto flex items-center justify-center text-muted-foreground">
                <Palmtree className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs font-semibold text-foreground">No official company holidays added yet.</p>
              <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                Add individual holiday dates above or select a year and click <span className="font-semibold text-foreground">Import List</span> to populate.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function TeamCreator({ teams, onCreated }: { teams: Team[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="flex-1">
        <Label className="text-xs">Parent (optional)</Label>
        <select value={parent} onChange={(e) => setParent(e.target.value)} className="w-full h-9 rounded-md border bg-background px-2 text-sm">
          <option value="">—</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <Button size="sm" disabled={!name} onClick={async () => {
        await teamsService.create({ name, parent_team_id: parent || null, manager_id: null });
        setName(""); setParent(""); onCreated();
      }}>Add</Button>
    </div>
  );
}

function ProjectCreator({ teams, defaultSla, onCreated }: { teams: Team[]; defaultSla: number; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [teamId, setTeamId] = useState("");
  const [sla, setSla] = useState(defaultSla);
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
      <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
      <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
        <option value="">No team</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <Input type="number" min={1} value={sla} onChange={(e) => setSla(Number(e.target.value))} />
      <Button size="sm" disabled={!name} onClick={async () => {
        await projectsService.create({ name, client: client || null, team_id: teamId || null, sla_days: sla, status: "active" });
        setName(""); setClient(""); setTeamId(""); onCreated();
      }}>Add</Button>
    </div>
  );
}

function HolidayCreator({ onCreated }: { onCreated: () => void }) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-muted/20 p-2.5 rounded-lg border border-border/50">
      <div className="sm:col-span-4 space-y-1">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch (err) {}
          }}
          className="cursor-pointer bg-background"
        />
      </div>
      <div className="sm:col-span-6 space-y-1">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Holiday Name / Label</Label>
        <Input placeholder="e.g. Diwali / Republic Day" value={label} onChange={(e) => setLabel(e.target.value)} className="bg-background" />
      </div>
      <div className="sm:col-span-2">
        <Button
          size="sm"
          disabled={!date || !label || loading}
          onClick={async () => {
            setLoading(true);
            try {
              await holidaysService.add(date, label);
              toast.success(`Added holiday: ${label}`);
              setDate("");
              setLabel("");
              onCreated();
            } catch (err) {
              toast.error("Failed to add holiday: " + (err as Error).message);
            } finally {
              setLoading(false);
            }
          }}
          className="w-full gap-1 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}
