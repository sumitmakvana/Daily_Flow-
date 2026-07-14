import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { nudgesService } from "@/services/nudges";
import type { Nudge } from "@/lib/types";
import { SEVERITY_TONE } from "@/services/risks";
import { formatRelative } from "@/lib/format";

export function NudgeCenter({ userId }: { userId: string }) {
  const [items, setItems] = useState<Nudge[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => nudgesService.listActive(userId).then(setItems).catch(() => undefined);
  useEffect(() => {
    load();
    const ch = supabase
      .channel(`nudges-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "nudges", filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unread = items.filter((n) => !n.read_at).length;

  const dismiss = async (id: string) => {
    await nudgesService.dismiss(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) items.filter((n) => !n.read_at).forEach((n) => nudgesService.markRead(n.id)); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="Nudges">
          <Sparkles className="h-4 w-4 text-amber-500" />
          {unread > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-priority-high text-white border-0">
              {unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Nudges</span>
          <span className="text-[10px] text-muted-foreground">{items.length} active</span>
        </div>
        <ul className="max-h-96 overflow-y-auto divide-y divide-border">
          {items.length === 0 && (
            <li className="px-3 py-6 text-xs text-muted-foreground italic text-center">All clear — no nudges right now.</li>
          )}
          {items.map((n) => (
            <li key={n.id} className="px-3 py-2.5 flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${SEVERITY_TONE[n.severity].split(" ")[0]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">{n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
                <div className="text-[10px] text-muted-foreground mt-1">{formatRelative(n.created_at)}</div>
              </div>
              <button
                onClick={() => dismiss(n.id)}
                className="text-muted-foreground hover:text-foreground"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
