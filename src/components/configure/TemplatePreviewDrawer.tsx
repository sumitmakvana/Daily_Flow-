import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { templatesService, type IndustryTemplate, type TemplateComponent } from "@/services/templates";
import { toast } from "sonner";
import { Loader2, Download } from "lucide-react";

const KIND_LABEL: Record<TemplateComponent["component_kind"], string> = {
  work_item_type: "Work Item Type",
  status: "Status",
  transition: "Transition",
  field_def: "Field",
  approval_chain: "Approval Chain",
  approval_step: "Approval Step",
  // @ts-expect-error new kind not in shared type yet
  org_role: "Role",
};

export function TemplatePreviewDrawer({
  template,
  open,
  onOpenChange,
  onInstall,
  installing,
}: {
  template: IndustryTemplate | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInstall: () => void;
  installing: boolean;
}) {
  const [components, setComponents] = useState<TemplateComponent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!template || !open) return;
    setLoading(true);
    templatesService.componentsFor(template.id)
      .then(setComponents)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [template, open]);

  const grouped = components.reduce<Record<string, TemplateComponent[]>>((acc, c) => {
    (acc[c.component_kind] ||= []).push(c); return acc;
  }, {});
  const order: TemplateComponent["component_kind"][] = ["work_item_type", "status", "transition", "field_def", "approval_chain", "approval_step"];
  const extras = Object.keys(grouped).filter((k) => !order.includes(k as TemplateComponent["component_kind"])) as TemplateComponent["component_kind"][];
  const all = [...order, ...extras];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{template?.name ?? "Template"}</SheetTitle>
          <SheetDescription>{template?.description}</SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-1">
              {all.map((k) => grouped[k]?.length ? (
                <Badge key={k} variant="secondary" className="text-[10px]">
                  {grouped[k].length} {KIND_LABEL[k] ?? k}{grouped[k].length === 1 ? "" : "s"}
                </Badge>
              ) : null)}
            </div>
            {all.map((kind) => grouped[kind]?.length ? (
              <div key={kind}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{KIND_LABEL[kind] ?? kind}s</div>
                <div className="space-y-1">
                  {grouped[kind].map((c) => (
                    <div key={c.id} className="text-xs border-l-2 border-border pl-2 py-1">
                      <div className="font-medium">
                        {(c.payload as any).name || (c.payload as any).label || (c.payload as any).key}
                      </div>
                      {(c.payload as any).id_prefix && (
                        <div className="text-muted-foreground">Auto-ID prefix: <code>{(c.payload as any).id_prefix}</code></div>
                      )}
                      {(c.payload as any).data_type && (
                        <div className="text-muted-foreground">Type: <code>{(c.payload as any).data_type}</code>{(c.payload as any).required_for_completion ? " · required to complete" : ""}</div>
                      )}
                      {(c.payload as any).approver_role_key && (
                        <div className="text-muted-foreground">Approver: <code>{(c.payload as any).approver_role_key}</code></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null)}
            <div className="pt-3 border-t">
              <Button onClick={onInstall} disabled={installing} className="w-full">
                {installing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                {template?.is_installed ? "Reinstall" : "Install"} this pack
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">A safety snapshot is taken automatically.</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
