import React, { useEffect, useState } from "react";
import {
  Accessibility,
  ArrowDownCircle,
  X,
  RotateCcw,
  LayoutGrid,
  List,
  Droplet,
  Sun,
  Moon,
  Contrast,
  Type,
  Maximize2,
  Link as LinkIcon,
  EyeOff,
  Volume2,
  Mic,
  Target,
  MousePointer,
  HelpCircle,
  Check,
  BookOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface UX4GAccessibilityProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UX4GAccessibilityToolbar({
  isOpen: externalIsOpen,
  onOpenChange: externalOnOpenChange,
}: UX4GAccessibilityProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = (val: boolean) => {
    if (externalOnOpenChange) {
      externalOnOpenChange(val);
    } else {
      setInternalIsOpen(val);
    }
  };

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // State flags for UX4G active features
  const [monochrome, setMonochrome] = useState(false);
  const [highSaturate, setHighSaturate] = useState(false);
  const [lowSaturate, setLowSaturate] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [invertColors, setInvertColors] = useState(false);

  const [fontSize, setFontSize] = useState<"normal" | "large" | "xlarge">("normal");
  const [lineHeight, setLineHeight] = useState(false);
  const [textSpacing, setTextSpacing] = useState(false);
  const [highlightLinks, setHighlightLinks] = useState(false);
  const [dyslexicFont, setDyslexicFont] = useState(false);

  const [voiceSupport, setVoiceSupport] = useState(false);
  const [hideImages, setHideImages] = useState(false);
  const [readingGuide, setReadingGuide] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [largeCursor, setLargeCursor] = useState(false);

  // Keyboard shortcut Ctrl+F2 listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "F2") {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Sync state changes to HTML root attributes & CSS classes
  useEffect(() => {
    const root = document.documentElement;

    root.classList.toggle("ux4g-monochrome", monochrome);
    root.classList.toggle("ux4g-high-saturate", highSaturate);
    root.classList.toggle("ux4g-low-saturate", lowSaturate);
    root.classList.toggle("ux4g-high-contrast-dark", darkMode);
    root.classList.toggle("ux4g-invert-colors", invertColors);

    root.setAttribute("data-font-size", fontSize);
    root.setAttribute("data-line-height", lineHeight ? "high" : "normal");
    root.setAttribute("data-text-spacing", textSpacing ? "high" : "normal");
    root.classList.toggle("ux4g-highlight-links", highlightLinks);
    root.classList.toggle("ux4g-dyslexic-font", dyslexicFont);

    root.classList.toggle("ux4g-hide-images", hideImages);
    root.classList.toggle("ux4g-focus-mode", focusMode);
    root.classList.toggle("ux4g-large-cursor", largeCursor);
  }, [
    monochrome,
    highSaturate,
    lowSaturate,
    darkMode,
    invertColors,
    fontSize,
    lineHeight,
    textSpacing,
    highlightLinks,
    dyslexicFont,
    hideImages,
    focusMode,
    largeCursor,
  ]);

  // Mouse reading guide tracking logic
  useEffect(() => {
    let guideEl = document.getElementById("ux4g-reading-guide-line");
    if (!guideEl) {
      guideEl = document.createElement("div");
      guideEl.id = "ux4g-reading-guide-line";
      document.body.appendChild(guideEl);
    }

    if (readingGuide) {
      guideEl.style.display = "block";
      const moveGuide = (e: MouseEvent) => {
        if (guideEl) guideEl.style.top = `${e.clientY - 6}px`;
      };
      window.addEventListener("mousemove", moveGuide);
      return () => {
        window.removeEventListener("mousemove", moveGuide);
        if (guideEl) guideEl.style.display = "none";
      };
    } else {
      guideEl.style.display = "none";
    }
  }, [readingGuide]);

  // Voice Reader Support (Speech Synthesis on mouse hover)
  useEffect(() => {
    if (!voiceSupport) {
      window.speechSynthesis?.cancel();
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || target.closest("[role='dialog']")) return;
      const text = target.innerText || target.getAttribute("aria-label") || target.getAttribute("alt");
      if (text && text.trim().length > 0 && text.trim().length < 200) {
        window.speechSynthesis?.cancel();
        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = 1.0;
        window.speechSynthesis?.speak(utterance);
      }
    };

    document.body.addEventListener("mouseover", handleMouseOver);
    return () => {
      document.body.removeEventListener("mouseover", handleMouseOver);
      window.speechSynthesis?.cancel();
    };
  }, [voiceSupport]);

  // Reset all options to default
  const handleReset = () => {
    setMonochrome(false);
    setHighSaturate(false);
    setLowSaturate(false);
    setDarkMode(false);
    setInvertColors(false);
    setFontSize("normal");
    setLineHeight(false);
    setTextSpacing(false);
    setHighlightLinks(false);
    setDyslexicFont(false);
    setVoiceSupport(false);
    setHideImages(false);
    setReadingGuide(false);
    setFocusMode(false);
    setLargeCursor(false);
    window.speechSynthesis?.cancel();
  };

  return (
    <>
      {/* Skip to main content keyboard access link */}
      <a
        href="#main-content"
        className="sr-only-focusable z-50 bg-primary text-primary-foreground font-semibold px-3 py-1.5 rounded focus:not-sr-only focus:absolute focus:top-2 focus:left-2 shadow-md outline-none"
      >
        Skip to main content <ArrowDownCircle className="inline h-3.5 w-3.5 ml-1" />
      </a>

      {/* Floating Bottom-Right Trigger Button (Ctrl+F2) matching codebase theme */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground p-3 rounded-full shadow-2xl transition-all transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-ring border border-border"
        aria-label="Toggle Accessibility Options (Ctrl+F2)"
        title="Accessibility Options (Ctrl+F2)"
      >
        <Accessibility className="h-5 w-5 text-primary-foreground" />
        <span className="hidden sm:inline text-xs font-semibold pr-1">Ctrl+F2</span>
      </button>

      {/* Right-Side Modal Drawer matching application codebase dark linear theme */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Accessibility Options by UX4G"
            className="w-full max-w-md bg-background text-foreground h-full flex flex-col shadow-2xl border-l border-border overflow-hidden animate-in slide-in-from-right duration-300"
          >
            {/* Header Banner - Matches app card / border theme */}
            <div className="bg-card text-card-foreground p-4 flex items-center justify-between border-b border-border shadow-sm">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  <Accessibility className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-sm md:text-base tracking-wide text-foreground">
                    Accessibility Options
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-muted rounded p-0.5 border border-border">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "p-1 rounded transition-colors",
                      viewMode === "grid" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Grid View"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={cn(
                      "p-1 rounded transition-colors",
                      viewMode === "list" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                    )}
                    title="List View"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsOpen(false)}
                  title="Close accessibility panel"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Scrollable Content Body matching app background */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-background">
              {/* Category 1: Color Adjustment */}
              <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>Color Adjustment</span>
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">5 Options</span>
                </h3>
                <div className={cn(viewMode === "grid" ? "grid grid-cols-3 gap-2.5" : "space-y-2")}>
                  <CardButton
                    label="Monochrome"
                    icon={<Droplet className="h-4 w-4" />}
                    active={monochrome}
                    onClick={() => setMonochrome(!monochrome)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="High Saturate"
                    icon={<Sun className="h-4 w-4" />}
                    active={highSaturate}
                    onClick={() => {
                      setHighSaturate(!highSaturate);
                      if (!highSaturate) setLowSaturate(false);
                    }}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Low Saturate"
                    icon={<Droplet className="h-4 w-4 opacity-50" />}
                    active={lowSaturate}
                    onClick={() => {
                      setLowSaturate(!lowSaturate);
                      if (!lowSaturate) setHighSaturate(false);
                    }}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Dark Mode"
                    icon={<Moon className="h-4 w-4" />}
                    active={darkMode}
                    onClick={() => setDarkMode(!darkMode)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Invert Colors"
                    icon={<Contrast className="h-4 w-4" />}
                    active={invertColors}
                    onClick={() => setInvertColors(!invertColors)}
                    viewMode={viewMode}
                  />
                </div>
              </div>

              {/* Category 2: Content Adjustment */}
              <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>Content Adjustment</span>
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">5 Options</span>
                </h3>
                <div className={cn(viewMode === "grid" ? "grid grid-cols-3 gap-2.5" : "space-y-2")}>
                  <CardButton
                    label={fontSize === "xlarge" ? "Extra Big Text" : fontSize === "large" ? "Bigger Text" : "Normal Text"}
                    icon={<Type className="h-4 w-4" />}
                    active={fontSize !== "normal"}
                    onClick={() => {
                      if (fontSize === "normal") setFontSize("large");
                      else if (fontSize === "large") setFontSize("xlarge");
                      else setFontSize("normal");
                    }}
                    badge={fontSize !== "normal" ? fontSize.toUpperCase() : undefined}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Line Height"
                    icon={<Maximize2 className="h-4 w-4 rotate-90" />}
                    active={lineHeight}
                    onClick={() => setLineHeight(!lineHeight)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Text Spacing"
                    icon={<Type className="h-4 w-4 tracking-widest" />}
                    active={textSpacing}
                    onClick={() => setTextSpacing(!textSpacing)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Highlight Links"
                    icon={<LinkIcon className="h-4 w-4" />}
                    active={highlightLinks}
                    onClick={() => setHighlightLinks(!highlightLinks)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Dyslexia Friendly"
                    icon={<BookOpen className="h-4 w-4" />}
                    active={dyslexicFont}
                    onClick={() => setDyslexicFont(!dyslexicFont)}
                    viewMode={viewMode}
                  />
                </div>
              </div>

              {/* Category 3: Orientation Adjustment */}
              <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>Orientation Adjustment</span>
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">6 Options</span>
                </h3>
                <div className={cn(viewMode === "grid" ? "grid grid-cols-3 gap-2.5" : "space-y-2")}>
                  <CardButton
                    label="Screen Reader"
                    icon={<Volume2 className="h-4 w-4" />}
                    active={voiceSupport}
                    onClick={() => setVoiceSupport(!voiceSupport)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Voice Support"
                    icon={<Mic className="h-4 w-4" />}
                    active={voiceSupport}
                    onClick={() => setVoiceSupport(!voiceSupport)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Hide Images"
                    icon={<EyeOff className="h-4 w-4" />}
                    active={hideImages}
                    onClick={() => setHideImages(!hideImages)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Reading Guides"
                    icon={<Maximize2 className="h-4 w-4" />}
                    active={readingGuide}
                    onClick={() => setReadingGuide(!readingGuide)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Focus Mode"
                    icon={<Target className="h-4 w-4" />}
                    active={focusMode}
                    onClick={() => setFocusMode(!focusMode)}
                    viewMode={viewMode}
                  />
                  <CardButton
                    label="Cursor Size"
                    icon={<MousePointer className="h-4 w-4" />}
                    active={largeCursor}
                    onClick={() => setLargeCursor(!largeCursor)}
                    viewMode={viewMode}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 bg-card border-t border-border flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="w-full font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset Options
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Helper Card Button styled using the codebase design tokens (bg-card, border-border, text-card-foreground)
function CardButton({
  label,
  icon,
  active,
  onClick,
  badge,
  viewMode,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  viewMode: "grid" | "list";
}) {
  if (viewMode === "list") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left bg-card text-card-foreground",
          active
            ? "border-primary ring-1 ring-primary/30 bg-primary/10"
            : "border-border hover:border-primary/50 hover:bg-accent"
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {icon}
          </div>
          <span className="text-xs font-medium">{label}</span>
        </div>
        {active && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/20 px-2 py-0.5 rounded-full">
            <Check className="h-3 w-3" /> Active
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all bg-card text-card-foreground aspect-square shadow-sm hover:shadow-md",
        active
          ? "border-primary ring-2 ring-primary/30 bg-primary/10 font-semibold"
          : "border-border hover:border-primary/50 hover:bg-accent/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {/* Active Indicator Badge */}
      {active && (
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
      )}
      {badge && (
        <span className="absolute top-1.5 left-1.5 text-[9px] font-bold bg-primary text-primary-foreground px-1 rounded">
          {badge}
        </span>
      )}
      <div className={cn("mb-2 p-2 rounded-lg transition-colors", active ? "text-primary bg-primary/20" : "text-muted-foreground bg-muted")}>
        {icon}
      </div>
      <span className="text-[11px] font-medium leading-tight line-clamp-2">{label}</span>
    </button>
  );
}
