import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { onboardingService, ONBOARDING_STEPS, type Onboarding } from "@/services/onboarding";
import { templatesService, type IndustryTemplate } from "@/services/templates";
import { workItemTypesService } from "@/services/work-item-types";
import { toast } from "sonner";
import { Check, Loader2, Rocket, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import type { WorkItemType } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/onboarding")({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin");
    if (!data?.length) throw redirect({ to: "/today" });
  },
  component: OnboardingPage,
});

const INDUSTRIES = [
  { key: "it", label: "IT / Engineering", templateKey: "it_startup", emoji: "💻" },
  { key: "pharma", label: "Pharmaceutical", templateKey: "pharma", emoji: "💊" },
  { key: "adhesives", label: "Adhesives / Channel", templateKey: "adhesives", emoji: "🏬" },
  { key: "manufacturing", label: "Manufacturing", templateKey: "manufacturing", emoji: "🏭" },
  { key: "consulting", label: "Consulting", templateKey: "consulting", emoji: "📊" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<Onboarding | null>(null);
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [types, setTypes] = useState<WorkItemType[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onboardingService.get().then(setState).catch((e) => toast.error((e as Error).message));
    templatesService.list().then(setTemplates).catch(() => {});
    workItemTypesService.list(true).then(setTypes).catch(() => {});
  }, []);

  if (!state) return <div className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  const step = state.current_step;
  const pct = Math.round((step / (ONBOARDING_STEPS.length - 1)) * 100);
  const meta = ONBOARDING_STEPS[step];

  const advance = async (next: number, patch: Partial<Onboarding> = {}) => {
    setBusy(true);
    try {
      await onboardingService.setStep(next, { industry: patch.industry, data: patch.data });
      const fresh = await onboardingService.get();
      setState(fresh);
      const reloadedTypes = await workItemTypesService.list(true);
      setTypes(reloadedTypes);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Get your platform pilot-ready</h1>
          <p className="text-xs text-muted-foreground">Step {step + 1} of {ONBOARDING_STEPS.length} — {meta.title}</p>
        </div>
        {state.completed_at && <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />Complete</Badge>}
      </div>
      <Progress value={pct} className="h-2" />

      <div className="grid grid-cols-1 sm:grid-cols-6 gap-1 text-[10px]">
        {ONBOARDING_STEPS.map((s) => (
          <div key={s.id} className={`text-center p-1 rounded ${s.id < step ? "text-primary" : s.id === step ? "font-semibold" : "text-muted-foreground"}`}>
            {s.id < step ? "✓ " : `${s.id + 1}. `}{s.title}
          </div>
        ))}
      </div>

      <Card className="p-5 min-h-[300px]">
        <div className="mb-3">
          <h2 className="text-base font-semibold">{meta.title}</h2>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>

        {step === 0 && (
          <div className="space-y-2">
            {INDUSTRIES.map((i) => (
              <button key={i.key}
                disabled={busy}
                onClick={() => advance(1, { industry: i.key })}
                className="w-full text-left p-3 border rounded-lg hover:bg-accent transition-colors flex items-center gap-3">
                <div className="text-2xl">{i.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{i.label}</div>
                  <div className="text-xs text-muted-foreground">{templates.find((t) => t.key === i.templateKey)?.description ?? "Pre-built configuration"}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            {(() => {
              const ind = INDUSTRIES.find((i) => i.key === state.industry);
              const tpl = templates.find((t) => t.key === ind?.templateKey);
              if (!tpl) return <p className="text-xs text-muted-foreground">No template found for {state.industry}.</p>;
              return (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <div className="font-semibold text-sm">{tpl.name}</div>
                    {tpl.is_installed && <Badge variant="secondary" className="gap-1 text-[10px]"><Check className="h-3 w-3" />Installed</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{tpl.description}</p>
                  <Button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await templatesService.install(tpl.id);
                        toast.success("Template installed");
                        await advance(2);
                      } catch (e) { toast.error((e as Error).message); }
                      finally { setBusy(false); }
                    }}
                    disabled={busy} className="w-full">
                    {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    {tpl.is_installed ? "Reinstall & continue" : "Install template pack"}
                  </Button>
                </Card>
              );
            })()}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Confirm or change the auto-ID prefix for each new type. Work items will be numbered like <code>DV-2026-0001</code>.</p>
            {types.filter((t) => t.active).map((t) => (
              <div key={t.id} className="flex items-center gap-2 border-b border-border/40 py-2 last:border-0">
                <div className="w-2 h-2 rounded-full" style={{ background: t.color ?? "#94a3b8" }} />
                <div className="flex-1 text-sm">{t.name}</div>
                <input
                  defaultValue={t.id_prefix ?? ""}
                  onBlur={async (e) => {
                    const v = e.target.value.trim().toUpperCase();
                    if (v === (t.id_prefix ?? "")) return;
                    try { await workItemTypesService.update(t.id, { id_prefix: v || null }); toast.success(`${t.name}: ${v || "no prefix"}`); }
                    catch (err) { toast.error((err as Error).message); }
                  }}
                  placeholder="—"
                  maxLength={8}
                  className="w-24 h-8 text-xs px-2 border rounded bg-background uppercase"
                />
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Invite teammates and assign their roles. You can do this anytime under Configure → Roles.</p>
            <Button variant="outline" onClick={() => navigate({ to: "/configure" })}>Open Roles panel</Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Create a sample work item to verify everything works — workflow transitions, field capture, approvals.</p>
            <Button onClick={() => navigate({ to: "/today" })}>Go to Today and create a work item</Button>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-center py-6">
            <div className="text-4xl">🎉</div>
            <div className="font-semibold">You're pilot-ready</div>
            <p className="text-xs text-muted-foreground">Your platform is configured and ready for daily use.</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => navigate({ to: "/configure" })}>Go to Configure</Button>
              <Button onClick={() => navigate({ to: "/today" })}>Start working</Button>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-5 mt-5 border-t">
          <Button variant="ghost" disabled={busy || step === 0} onClick={() => advance(Math.max(0, step - 1))}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          {step > 0 && step < ONBOARDING_STEPS.length - 1 && (
            <Button disabled={busy} onClick={() => advance(step + 1)}>
              {step === ONBOARDING_STEPS.length - 2 ? "Finish" : "Next"}<ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
