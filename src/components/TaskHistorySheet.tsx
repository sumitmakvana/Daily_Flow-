import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, ArrowRightCircle, Activity, Paperclip, MessageSquare } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { CommentsPanel } from "./CommentsPanel";
import { WorkItemTypeBadge } from "./WorkItemTypeBadge";
import type { Profile, Task, TaskHistory, CarryForwardEvent, WorkItemType, Attachment, Comment } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { workItemTypesService } from "@/services/work-item-types";

type TimelineItem =
  | { kind: "history"; id: string; at: string; data: TaskHistory }
  | { kind: "carry"; id: string; at: string; data: CarryForwardEvent }
  | { kind: "attachment"; id: string; at: string; data: Attachment }
  | { kind: "comment"; id: string; at: string; data: Comment };

export function TaskHistorySheet({
  open,
  onOpenChange,
  task,
  profiles,
  userId,
  canModerate = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: Task | null;
  profiles: Profile[];
  userId: string;
  /** Manager/admin permissions for delete actions. */
  canModerate?: boolean;
}) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [types, setTypes] = useState<WorkItemType[]>([]);

  const load = useCallback(async () => {
    if (!task) return;
    const [{ data: h }, { data: cf }, { data: at }, { data: cm }] = await Promise.all([
      supabase.from("task_history").select("*").eq("task_id", task.id),
      supabase.from("carry_forward_events").select("*").eq("task_id", task.id),
      supabase.from("attachments").select("*").eq("work_item_id", task.id),
      supabase.from("comments").select("*").eq("work_item_id", task.id),
    ]);
    const merged: TimelineItem[] = [
      ...((h ?? []) as TaskHistory[]).map((d) => ({ kind: "history" as const, id: d.id, at: d.created_at, data: d })),
      ...((cf ?? []) as CarryForwardEvent[]).map((d) => ({ kind: "carry" as const, id: d.id, at: d.created_at, data: d })),
      ...((at ?? []) as Attachment[]).map((d) => ({ kind: "attachment" as const, id: d.id, at: d.uploaded_at, data: d })),
      ...((cm ?? []) as Comment[]).map((d) => ({ kind: "comment" as const, id: d.id, at: d.created_at, data: d })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    setItems(merged);
  }, [task]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    void workItemTypesService.list().then(setTypes).catch(() => setTypes([]));
  }, [open]);

  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.display_name ?? "—";
  const type = types.find((t) => t.id === task?.type_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {task ? `${task.task_code} · ${task.task_name}` : "Activity"}
          </SheetTitle>
          {type && (
            <div className="pt-1">
              <WorkItemTypeBadge type={type} />
            </div>
          )}
        </SheetHeader>

        {task && (
          <Tabs defaultValue="timeline" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="timeline" className="text-xs">
                <Activity className="h-3.5 w-3.5 mr-1" /> Activity
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-xs">
                <MessageSquare className="h-3.5 w-3.5 mr-1" /> Comments
              </TabsTrigger>
              <TabsTrigger value="files" className="text-xs">
                <Paperclip className="h-3.5 w-3.5 mr-1" /> Files
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-3 space-y-2">
              {items.length === 0 && <p className="text-xs text-muted-foreground italic">No activity yet.</p>}
              {items.map((it) => {
                if (it.kind === "carry") {
                  return (
                    <div key={it.id} className="rounded-md border border-priority-medium/30 bg-priority-medium/5 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ArrowRightCircle className="h-3 w-3 text-priority-medium" /> {nameOf(it.data.created_by)}
                        </span>
                        <span>{formatRelative(it.at)}</span>
                      </div>
                      <div className="mt-1">
                        Carried forward <span className="font-medium">{it.data.from_date}</span> →{" "}
                        <span className="font-medium">{it.data.to_date}</span>
                        <span className="ml-1 text-muted-foreground">({it.data.reason})</span>
                      </div>
                    </div>
                  );
                }
                if (it.kind === "attachment") {
                  return (
                    <div key={it.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Paperclip className="h-3 w-3" /> {nameOf(it.data.uploaded_by)} uploaded
                        </span>
                        <span>{formatRelative(it.at)}</span>
                      </div>
                      <div className="mt-1 truncate">{it.data.file_name}</div>
                    </div>
                  );
                }
                if (it.kind === "comment") {
                  return (
                    <div key={it.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" /> {nameOf(it.data.user_id)}
                        </span>
                        <span>{formatRelative(it.at)}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-foreground">
                        {it.data.deleted_at ? <span className="italic text-muted-foreground">[deleted]</span> : it.data.body}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={it.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span>{nameOf(it.data.updated_by)}</span>
                      <span>{formatRelative(it.at)}</span>
                    </div>
                    {it.data.old_status !== it.data.new_status && (
                      <div className="mt-1 flex items-center gap-1.5">
                        {it.data.old_status && <StatusBadge status={it.data.old_status} />}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {it.data.new_status && <StatusBadge status={it.data.new_status} />}
                      </div>
                    )}
                    {it.data.comment && <div className="mt-1 text-foreground">{it.data.comment}</div>}
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="comments" className="mt-3">
              <CommentsPanel workItemId={task.id} userId={userId} profiles={profiles} canModerate={canModerate} />
            </TabsContent>

            <TabsContent value="files" className="mt-3">
              <AttachmentsPanel workItemId={task.id} userId={userId} canDeleteAny={canModerate} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
