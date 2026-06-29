import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RulesPanel } from "@/components/automation/RulesPanel";
import { RunsTable } from "@/components/automation/RunsTable";
import { HealthPanel } from "@/components/automation/HealthPanel";

function ConfigureAutomationsPage() {
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Automations</h1>
        <p className="text-xs text-muted-foreground">
          Trigger-driven rules that keep work moving. Admin-only.
        </p>
      </header>
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4"><RulesPanel /></TabsContent>
        <TabsContent value="runs" className="mt-4"><RunsTable /></TabsContent>
        <TabsContent value="health" className="mt-4"><HealthPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/configure/automations")({
  component: ConfigureAutomationsPage,
});
