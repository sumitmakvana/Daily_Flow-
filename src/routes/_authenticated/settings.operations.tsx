import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { teamsService, projectsService, workSettingsService, holidaysService } from "@/services/operations";
import type { Team, Project, WorkSettings, HolidayCalendar } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/operations")({
  component: OpsSettings,
});

function OpsSettings() {
  const { isManager } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [holidays, setHolidays] = useState<HolidayCalendar[]>([]);
  const [settings, setSettings] = useState<WorkSettings | null>(null);

  const load = async () => {
    const [t, p, h, s] = await Promise.all([
      teamsService.list(), projectsService.list(), holidaysService.list(), workSettingsService.get(),
    ]);
    setTeams(t); setProjects(p); setHolidays(h); setSettings(s);
  };
  useEffect(() => { load(); }, []);

  if (!isManager) {
    return <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">Managers only.</div>;
  }
  if (!settings) return null;

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-5">
      <h1 className="text-xl font-semibold">Operations settings</h1>

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
            <li key={p.id} className="py-2 flex justify-between text-xs">
              <span><span className="font-medium text-sm">{p.name}</span> · {p.client ?? "—"} · SLA {p.sla_days}d</span>
              <span className="text-muted-foreground">{teams.find((t) => t.id === p.team_id)?.name ?? "—"}</span>
            </li>
          ))}
          {projects.length === 0 && <li className="py-2 text-xs italic text-muted-foreground">No projects yet.</li>}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-semibold">Holidays</h2>
        <HolidayCreator onCreated={load} />
        <ul className="text-sm divide-y divide-border">
          {holidays.map((h) => (
            <li key={h.id} className="py-2 flex justify-between text-xs">
              <span><span className="font-medium">{h.calendar_date}</span> · {h.label}</span>
              <button onClick={async () => { await holidaysService.remove(h.id); load(); }} className="text-muted-foreground hover:text-priority-high">Remove</button>
            </li>
          ))}
          {holidays.length === 0 && <li className="py-2 text-xs italic text-muted-foreground">No holidays added.</li>}
        </ul>
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
  return (
    <div className="flex gap-2 items-end">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Button size="sm" disabled={!date || !label} onClick={async () => {
        await holidaysService.add(date, label); setDate(""); setLabel(""); onCreated();
      }}>Add</Button>
    </div>
  );
}
