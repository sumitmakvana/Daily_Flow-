import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { templatesService, type IndustryTemplate } from "@/services/templates";
import { TemplatePreviewDrawer } from "./TemplatePreviewDrawer";
import { toast } from "sonner";
import { Check, Download, Loader2, Eye, Sparkles } from "lucide-react";

const INDUSTRY_LABEL: Record<IndustryTemplate["industry"], string> = {
  it: "IT", pharma: "Pharma", adhesives: "Adhesives",
  manufacturing: "Manufacturing", consulting: "Consulting", generic: "Generic",
};

export function TemplatesPanel() {
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [componentCounts, setComponentCounts] = useState<Record<string, number>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<IndustryTemplate | null>(null);

  const load = async () => {
    try {
      const ts = await templatesService.list();
      setTemplates(ts);
      const counts: Record<string, number> = {};
      await Promise.all(ts.map(async (t) => {
        const cs = await templatesService.componentsFor(t.id);
        counts[t.id] = cs.length;
      }));
      setComponentCounts(counts);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const install = async (t: IndustryTemplate) => {
    setInstalling(t.id);
    try {
      await templatesService.install(t.id);
      toast.success(`Installed: ${t.name}`);
      setPreviewing(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setInstalling(null); }
  };

  const grouped = templates.reduce<Record<string, IndustryTemplate[]>>((acc, t) => {
    (acc[t.industry] ||= []).push(t); return acc;
  }, {});

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Industry Template Marketplace
        </h2>
        <p className="text-xs text-muted-foreground">Pre-built configurations for your industry. One click installs types, workflows, fields, roles, and approval chains.</p>
      </div>
      {Object.entries(grouped).map(([industry, list]) => (
        <div key={industry} className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{INDUSTRY_LABEL[industry as IndustryTemplate["industry"]]}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map((t) => (
              <Card key={t.id} className="p-4 space-y-3 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {t.name}
                      {t.is_installed && <Badge variant="secondary" className="gap-1 text-[10px]"><Check className="h-3 w-3" />Installed</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">v{t.version} · {componentCounts[t.id] ?? 0} components</div>
                  </div>
                </div>
                {t.description && <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setPreviewing(t)}>
                    <Eye className="h-3 w-3 mr-1" />Preview
                  </Button>
                  <Button size="sm" variant={t.is_installed ? "secondary" : "default"} className="flex-1"
                          disabled={installing === t.id} onClick={() => install(t)}>
                    {installing === t.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                    {t.is_installed ? "Reinstall" : "Install"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {templates.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No templates available.</p>}

      <TemplatePreviewDrawer
        template={previewing}
        open={!!previewing}
        onOpenChange={(o) => !o && setPreviewing(null)}
        onInstall={() => previewing && install(previewing)}
        installing={installing === previewing?.id}
      />
    </Card>
  );
}
