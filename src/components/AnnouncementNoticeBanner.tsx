import React, { useState } from "react";
import { InteractiveFigmaDemoModal } from "@/components/InteractiveFigmaDemoModal";
import { Play, X, Compass, Sparkles, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "@tanstack/react-router";

export function AnnouncementNoticeBanner() {
  const location = useLocation();
  const [demoOpen, setDemoOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const pathname = location.pathname || "";

  // Dynamic container max-width matching each specific page layout
  let maxWidthClass = "max-w-5xl"; // default
  if (pathname.includes("/calendar")) {
    maxWidthClass = "max-w-7xl";
  } else if (pathname.includes("/today")) {
    maxWidthClass = "max-w-2xl";
  } else if (pathname.includes("/blockers")) {
    maxWidthClass = "max-w-4xl";
  } else if (pathname.includes("/eod-tasks")) {
    maxWidthClass = "max-w-4xl";
  } else if (pathname.includes("/my-day")) {
    maxWidthClass = "max-w-5xl";
  } else if (pathname.includes("/tasks")) {
    maxWidthClass = "max-w-5xl";
  }

  return (
    <>
      {/* PREMIUM ANNOUNCEMENT NOTICE BANNER */}
      {!dismissed && (
        <div className={`${maxWidthClass} mx-auto px-3 md:px-4 mt-3 mb-1 transition-all duration-200`}>
          <div className="relative overflow-hidden bg-card/95 text-foreground px-4 py-2.5 rounded-xl shadow-lg border border-primary/25 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-3 group hover:border-primary/40 transition-all duration-300">
            {/* AMBIENT GLOW BACKDROP */}
            <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none group-hover:bg-primary/20 transition-all duration-500" />
            
            <div className="flex items-center gap-3 z-10">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 via-blue-500/10 to-indigo-500/20 border border-primary/30 flex items-center justify-center text-primary shrink-0 shadow-sm">
                <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              </div>
              <div className="space-y-0.5 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs tracking-wide text-foreground flex items-center gap-1.5">
                    ✨ Explore Daily Flow: Interactive Product Tour
                  </span>
                  <span className="hidden sm:inline-flex items-center whitespace-nowrap shrink-0 font-mono text-[10px] bg-primary/15 text-primary border border-primary/30 px-2.5 py-0.5 rounded-full font-bold shadow-xs">
                    ⚡ 9-STEP TOUR
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground font-medium line-clamp-1">
                  Experience My Day, Today, Tasks Board, Calendar & EOD Check-In with interactive feedback.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 z-10 w-full sm:w-auto justify-end shrink-0">
              <Button
                onClick={() => setDemoOpen(true)}
                size="sm"
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-primary hover:brightness-110 text-white font-bold text-xs px-4 py-1.5 h-8 rounded-lg shadow-md gap-1.5 transition-all cursor-pointer w-full sm:w-auto hover:scale-[1.02] active:scale-[0.98]"
              >
                <Play className="h-3 w-3 fill-current" /> Start Interactive Tour
              </Button>

              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 p-1.5 rounded-lg transition-colors cursor-pointer"
                title="Dismiss Banner"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INTERACTIVE GUIDE MODAL */}
      <InteractiveFigmaDemoModal open={demoOpen} onOpenChange={setDemoOpen} />
    </>
  );
}
