import { Link } from "@tanstack/react-router";
import { Cloud, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import { useOnlineSync } from "@/hooks/use-online-sync";
import { cn } from "@/lib/utils";

/**
 * Compact connectivity / sync indicator for the app header.
 * Tap target opens the Sync Center.
 */
export function SyncStatusBadge() {
  const { online, syncing, pending, failed } = useOnlineSync();

  const variant = !online
    ? "offline"
    : failed > 0
    ? "failed"
    : pending > 0 || syncing
    ? "pending"
    : "ok";

  const Icon = !online ? CloudOff : failed > 0 ? AlertTriangle : syncing ? Loader2 : Cloud;
  const label = !online
    ? "Offline"
    : failed > 0
    ? `${failed} failed`
    : syncing
    ? "Syncing"
    : pending > 0
    ? `${pending} pending`
    : "Synced";

  return (
    <Link
      to="/sync"
      aria-label={`Sync status: ${label}`}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 h-7 text-[11px] font-medium border transition-colors",
        variant === "offline" && "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
        variant === "failed" && "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-200",
        variant === "pending" && "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
        variant === "ok" && "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
      )}
    >
      <Icon className={cn("h-3 w-3", syncing && "animate-spin")} />
      <span>{label}</span>
    </Link>
  );
}
