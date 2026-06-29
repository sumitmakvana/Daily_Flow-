import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TypesPanel } from "@/components/configure/TypesPanel";
import { StatusesPanel } from "@/components/configure/StatusesPanel";
import { WorkflowPanel } from "@/components/configure/WorkflowPanel";
import { FieldsPanel } from "@/components/configure/FieldsPanel";
import { ApprovalsPanel } from "@/components/configure/ApprovalsPanel";
import { TemplatesPanel } from "@/components/configure/TemplatesPanel";
import { HealthPanel } from "@/components/configure/HealthPanel";
import { RolesPanel } from "@/components/configure/RolesPanel";
import { VersionsPanel } from "@/components/configure/VersionsPanel";
import { ImportExportPanel } from "@/components/configure/ImportExportPanel";
import { useState } from "react";
import { Sparkles, Rocket, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configure")({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin");
    if (!data?.length) throw redirect({ to: "/today" });
  },
  component: ConfigurePage,
});

function ConfigurePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("health");

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Configure</h1>
          <p className="text-xs text-muted-foreground">Build work types, workflows, forms, and approvals — no code needed.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/configure/automations" })}>
            <Zap className="h-4 w-4 mr-2" />Automations
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/onboarding" })}>
            <Rocket className="h-4 w-4 mr-2" />Onboarding
          </Button>
          <Button onClick={() => navigate({ to: "/configure/new" })}>
            <Sparkles className="h-4 w-4 mr-2" />New Work Type
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="types">Types</TabsTrigger>
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="io">Import / Export</TabsTrigger>
        </TabsList>
        <TabsContent value="health" className="mt-4"><HealthPanel onNavigate={setTab} /></TabsContent>
        <TabsContent value="templates" className="mt-4"><TemplatesPanel /></TabsContent>
        <TabsContent value="types" className="mt-4"><TypesPanel /></TabsContent>
        <TabsContent value="statuses" className="mt-4"><StatusesPanel /></TabsContent>
        <TabsContent value="workflow" className="mt-4"><WorkflowPanel /></TabsContent>
        <TabsContent value="fields" className="mt-4"><FieldsPanel /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RolesPanel /></TabsContent>
        <TabsContent value="approvals" className="mt-4"><ApprovalsPanel /></TabsContent>
        <TabsContent value="versions" className="mt-4"><VersionsPanel /></TabsContent>
        <TabsContent value="io" className="mt-4"><ImportExportPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
