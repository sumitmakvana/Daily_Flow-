import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Loader2, Sparkles, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingContextType {
  isLoading: boolean;
  loadingText: string;
  detailText: string | null;
  progress: number | null; // 0 to 100 or null for indeterminate
  showLoader: (text?: string, detail?: string | null) => void;
  hideLoader: () => void;
  setProgress: (val: number | null) => void;
}

const LoadingContext = createContext<LoadingContextType>({
  isLoading: false,
  loadingText: "Loading...",
  detailText: null,
  progress: null,
  showLoader: () => {},
  hideLoader: () => {},
  setProgress: () => {},
});

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Loading operations data...");
  const [detailText, setDetailText] = useState<string | null>("Fetching latest updates from server...");
  const [progress, setProgressState] = useState<number | null>(null);

  const showLoader = useCallback((text = "Loading data...", detail: string | null = "Processing background sync...") => {
    setLoadingText(text);
    setDetailText(detail);
    setIsLoading(true);
  }, []);

  const hideLoader = useCallback(() => {
    setIsLoading(false);
    setProgressState(null);
  }, []);

  const setProgress = useCallback((val: number | null) => {
    setProgressState(val);
  }, []);

  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        loadingText,
        detailText,
        progress,
        showLoader,
        hideLoader,
        setProgress,
      }}
    >
      {children}
      <GlobalLoaderOverlay />
    </LoadingContext.Provider>
  );
}

export function useGlobalLoader() {
  return useContext(LoadingContext);
}

/**
 * Top floating Execution OS Glassmorphic Global Loader
 */
function GlobalLoaderOverlay() {
  const { isLoading, loadingText, detailText, progress } = useGlobalLoader();

  if (!isLoading) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#0B1220]/90 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl text-slate-100 min-w-[280px] max-w-[480px]">
        {/* Animated Glow Loader Icon */}
        <div className="relative flex items-center justify-center shrink-0">
          <div className="absolute h-6 w-6 rounded-full bg-indigo-500/30 animate-ping" />
          <Loader2 className="h-4 w-4 animate-spin text-[#5C8EFA] relative z-10" />
        </div>

        {/* Text Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-tight text-slate-100 truncate">
              {loadingText}
            </span>
            {progress !== null && (
              <span className="text-[10px] font-mono text-indigo-400 font-bold shrink-0">
                {Math.round(progress)}%
              </span>
            )}
          </div>
          {detailText && (
            <p className="text-[11px] text-slate-400 truncate mt-0.5 font-medium">
              {detailText}
            </p>
          )}

          {/* Progress Bar (Determinate or Indeterminate) */}
          <div className="w-full bg-slate-800/80 h-1 rounded-full overflow-hidden mt-1.5 border border-slate-700/50">
            {progress !== null ? (
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-200"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            ) : (
              <div className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full w-1/2 animate-shimmer rounded-full" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable Section Inline Loader Component for Cards/Panels
 */
export function SectionLoader({
  title = "Loading data...",
  subtext = "Please wait a moment...",
  className,
}: {
  title?: string;
  subtext?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-xl bg-card/60 border border-border/60 backdrop-blur-sm min-h-[160px]",
        className
      )}
    >
      <div className="relative flex items-center justify-center mb-3">
        <div className="absolute h-9 w-9 rounded-full bg-indigo-500/20 animate-pulse" />
        <Loader2 className="h-6 w-6 animate-spin text-primary relative z-10" />
      </div>
      <p className="text-xs font-semibold text-foreground tracking-tight">{title}</p>
      {subtext && <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">{subtext}</p>}
    </div>
  );
}
