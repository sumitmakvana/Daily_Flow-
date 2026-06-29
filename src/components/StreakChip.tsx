import { Flame } from "lucide-react";
import { useEffect, useState } from "react";
import { streaksService } from "@/services/operations";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export function StreakChip({ className }: { className?: string }) {
  const { user } = useAuth();
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    if (!user) return;
    streaksService.forUser(user.id).then((s) => setStreak(s?.current_streak ?? 0));
  }, [user]);
  if (streak < 2) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-priority-medium/30 bg-priority-medium/10 px-1.5 py-0.5 text-[10px] font-medium text-priority-medium",
        className,
      )}
      title={`${streak}-day streak`}
    >
      <Flame className="h-3 w-3" /> {streak}
    </span>
  );
}
