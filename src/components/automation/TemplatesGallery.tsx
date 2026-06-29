import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { RULE_TEMPLATES, type RuleTemplate } from "@/lib/automation/templates";

export function TemplatesGallery({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (tpl: RuleTemplate) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = RULE_TEMPLATES.find((t) => t.id === selected) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />Rule templates
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pre-built rules for common operational patterns. Picking one opens the editor pre-filled — review
            keys & impact, then enable when ready.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {RULE_TEMPLATES.map((t) => (
            <Card
              key={t.id}
              className={`p-3 cursor-pointer transition-colors text-sm space-y-1 ${
                selected === t.id ? "border-primary ring-1 ring-primary" : "hover:bg-muted/40"
              }`}
              onClick={() => setSelected(t.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{t.name}</div>
                <Badge variant="outline" className="text-[10px]">{t.industry}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t.summary}</p>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium">Why:</span> {t.why}
              </p>
            </Card>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!sel} onClick={() => sel && onPick(sel)}>Use template</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
