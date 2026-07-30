import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";
import type { Profile, Task } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";
import { ShieldAlert, Sunrise } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { isManager, isAdmin } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    if (!isManager && !isAdmin) return;
    (async () => {
      const [{ data: t }, { data: p }] = await Promise.all([
        supabase.from("tasks").select("*"),
        supabase.from("profiles").select("id,display_name,avatar_url"),
      ]);
      setTasks((t ?? []) as Task[]);
      setProfiles((p ?? []) as Profile[]);
    })();
  }, [isManager, isAdmin]);

  const planVsActual = useMemo(() => profiles.map((p) => {
    const own = tasks.filter((t) => t.assigned_to === p.id);
    return {
      name: p.display_name.split(" ")[0],
      planned: own.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0),
      actual: own.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0),
    };
  }), [tasks, profiles]);

  const completionTrend = useMemo(() => {
    const days: { date: string; completed: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) === key).length;
      days.push({ date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), completed: count });
    }
    return days;
  }, [tasks]);

  const aging = useMemo(() => {
    const buckets = { "0-3d": 0, "4-7d": 0, "8-14d": 0, "15d+": 0 };
    tasks.filter((t) => t.status !== "Completed").forEach((t) => {
      const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
      if (age <= 3) buckets["0-3d"]++;
      else if (age <= 7) buckets["4-7d"]++;
      else if (age <= 14) buckets["8-14d"]++;
      else buckets["15d+"]++;
    });
    return Object.entries(buckets).map(([k, v]) => ({ bucket: k, count: v }));
  }, [tasks]);

  if (!isManager && !isAdmin) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
        <Card className="p-6 border border-border/80 shadow-xl space-y-3">
          <div className="h-12 w-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center mx-auto">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg font-bold">Manager Access Required</CardTitle>
          <CardDescription className="text-xs text-muted-foreground leading-relaxed">
            The Reports dashboard is restricted to Managers and Admins to review team velocity and workload distribution.
          </CardDescription>
          <div className="pt-2">
            <Button asChild size="sm" className="w-full">
              <Link to="/my-day" className="gap-2">
                <Sunrise className="h-4 w-4" /> Go to My Day
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2">Planned vs Actual hours</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={planVsActual}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="planned" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" fill="var(--color-status-completed)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2">Daily completion (14d)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={completionTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={10} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
              <Line type="monotone" dataKey="completed" stroke="var(--color-status-completed)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-3 md:col-span-2">
          <h2 className="text-sm font-semibold mb-2">Task aging (open tasks)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={aging}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="bucket" stroke="var(--color-muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--color-priority-medium)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
