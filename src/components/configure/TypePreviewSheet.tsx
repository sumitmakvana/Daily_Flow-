import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { DynamicFieldsForm } from "@/components/DynamicFieldsForm";
import { dynamicFieldsService, type WorkItemFieldDef } from "@/services/dynamic-fields";
import { workflowService, type WorkItemStatus, type WorkItemTransition } from "@/services/workflow";
import { approvalsService, type ApprovalChain, type ApprovalStep } from "@/services/approvals";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { WorkItemType } from "@/lib/types";

/**
 * Sandbox preview of what an end-user will see when interacting
 * with this work item type. No DB writes.
 */
export function TypePreviewSheet({
  type, open, onOpenChange,
  // Optional in-memory overrides (used by wizard before save)
  draftFields, draftStatuses, draftTransitions, draftChain,
}: {
  type: WorkItemType | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draftFields?: WorkItemFieldDef[];
  draftStatuses?: WorkItemStatus[];
  draftTransitions?: WorkItemTransition[];
  draftChain?: { chain: ApprovalChain; steps: ApprovalStep[] } | null;
}) {
  const [fields, setFields] = useState<WorkItemFieldDef[]>([]);
  const [statuses, setStatuses] = useState<WorkItemStatus[]>([]);
  const [transitions, setTransitions] = useState<WorkItemTransition[]>([]);
  const [chains, setChains] = useState<Array<{ chain: ApprovalChain; steps: ApprovalStep[] }>>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!open || !type) return;
    if (draftFields || draftStatuses || draftTransitions || draftChain !== undefined) {
      setFields(draftFields ?? []);
      setStatuses(draftStatuses ?? []);
      setTransitions(draftTransitions ?? []);
      setChains(draftChain ? [draftChain] : []);
      setValues({});
      return;
    }
    (async () => {
      const [f, s, t, cs] = await Promise.all([
        dynamicFieldsService.listDefs(type.id),
        workflowService.listStatuses(type.id),
        workflowService.listTransitions(type.id),
        approvalsService.listChainsForType(type.id),
      ]);
      const stepEntries = await Promise.all(cs.map(async (c) => ({ chain: c, steps: await approvalsService.listSteps(c.id) })));
      setFields(f); setStatuses(s); setTransitions(t); setChains(stepEntries); setValues({});
    })();
  }, [open, type, draftFields, draftStatuses, draftTransitions, draftChain]);

  const initial = statuses.find((s) => s.is_initial);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Preview: {type?.name ?? "—"}</SheetTitle>
          <SheetDescription>What end-users will experience. No data is saved.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">1. Create form</h3>
            <div className="rounded-md border border-border/60 p-3 space-y-2 bg-card">
              <div className="text-sm font-medium">New {type?.name}</div>
              <div className="text-xs text-muted-foreground">Starts as: <Badge variant="outline">{initial?.label ?? "(no initial status)"}</Badge></div>
              {fields.length > 0
                ? <DynamicFieldsForm defs={fields} values={values} onChange={setValues} />
                : <p className="text-xs text-muted-foreground italic">No custom fields — only built-in fields (name, assignee, due date) will appear.</p>}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">2. Workflow</h3>
            <WorkflowDiagram statuses={statuses} transitions={transitions} />
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">3. Approvals</h3>
            {chains.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No approval chains configured.</p>
            ) : (
              chains.map(({ chain, steps }) => (
                <div key={chain.id} className="rounded-md border border-border/60 p-3 space-y-2">
                  <div className="text-sm font-medium">{chain.name}</div>
                  <ol className="space-y-1">
                    {steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-xs">
                        <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px]">{s.step_order}</span>
                        <span className="flex-1">{s.name}</span>
                        <Badge variant="outline" className="text-[10px] h-4">
                          {s.approver_mode === "role" ? `role: ${s.approver_role}` :
                           s.approver_mode === "user" ? "specific user" : "from item"}
                        </Badge>
                      </li>
                    ))}
                    {steps.length === 0 && <li className="text-xs text-muted-foreground italic">No steps</li>}
                  </ol>
                </div>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">4. Notifications end-users will receive</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>• When assigned a new {type?.name}</li>
              <li>• When the work item is updated or commented on</li>
              {chains.length > 0 && <li>• When their approval is requested</li>}
              {statuses.some((s) => s.category === "done") && <li>• When the item is marked complete</li>}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WorkflowDiagram({ statuses, transitions }: { statuses: WorkItemStatus[]; transitions: WorkItemTransition[] }) {
  if (statuses.length === 0) return <p className="text-xs text-muted-foreground italic">No statuses defined.</p>;
  const initial = statuses.filter((s) => s.is_initial);
  const terminal = statuses.filter((s) => s.is_terminal);
  const middle = statuses.filter((s) => !s.is_initial && !s.is_terminal);
  const groups = [
    { title: "Start", items: initial },
    { title: "In flight", items: middle },
    { title: "Done", items: terminal },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <div className="text-[10px] text-muted-foreground">{g.title}</div>
              <div className="flex gap-1 flex-wrap">
                {g.items.map((s) => (
                  <Badge key={s.id} variant="outline" style={{ borderColor: s.color ?? undefined, color: s.color ?? undefined }}>
                    {s.is_terminal && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {s.label}
                  </Badge>
                ))}
              </div>
            </div>
            {gi < groups.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {transitions.length} transition{transitions.length === 1 ? "" : "s"} defined.
      </div>
    </div>
  );
}
