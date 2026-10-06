import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Laptop, Apple, Monitor, Terminal, BellRing, Keyboard, PanelBottomClose } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DESKTOP_DOWNLOADS, detectDesktopPlatform, type DesktopPlatform } from "@/lib/desktop-downloads";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/desktop-hub")({
  component: DownloadHubPage,
});

const PLATFORM_ICON: Record<DesktopPlatform, typeof Apple> = {
  macos: Apple,
  windows: Monitor,
  linux: Terminal,
};

const FEATURES = [
  { icon: Keyboard, title: "Quick Notes", text: "Press Alt + N anywhere to jot a note in the Notebook." },
  { icon: PanelBottomClose, title: "Lives in the tray", text: "Closing the window keeps Operon running in the background." },
  { icon: BellRing, title: "Native notifications", text: "Stay updated even when your browser is closed." },
];

function DownloadHubPage() {
  const [current, setCurrent] = useState<DesktopPlatform | null>(null);
  useEffect(() => setCurrent(detectDesktopPlatform()), []);

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-6 py-5 space-y-5">
      <div className="text-center space-y-1 pb-2">
        <h1 className="text-xl font-semibold text-foreground tracking-tight flex items-center justify-center gap-2">
          <Laptop className="h-5 w-5 text-primary" /> Get Operon on your desktop
        </h1>
        <p className="text-xs text-muted-foreground">
          Stay focused with native updates, even when your browser is closed.
        </p>
      </div>

      <Card className="p-4 bg-card border-border/50">
        <h2 className="text-base font-semibold text-foreground">Desktop</h2>
        <p className="text-xs text-muted-foreground mb-3">Same Operon account, same data — just faster to reach.</p>
        <div className="divide-y divide-border/50 border-t border-border/50">
          {DESKTOP_DOWNLOADS.map((d) => {
            const Icon = PLATFORM_ICON[d.id];
            return (
              <div key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="h-5 w-5 text-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground">{d.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{d.ext}</span>
                  {current === d.id && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/30">
                      Your device
                    </span>
                  )}
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={current === d.id ? "default" : "outline"}
                  className={cn("h-8 text-xs gap-1.5")}
                >
                  <a href={d.href} download={d.file}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Installers are unsigned: Windows SmartScreen or macOS Gatekeeper may ask you to confirm. On Linux run{" "}
          <span className="font-mono">chmod +x Operon-Linux.AppImage</span> first.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-3 bg-card border-border/50 space-y-1">
            <f.icon className="h-4 w-4 text-primary" />
            <div className="text-xs font-semibold text-foreground">{f.title}</div>
            <p className="text-xs text-muted-foreground">{f.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
