import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

export function ImagePreviewModal({
  open,
  onOpenChange,
  url,
  fileName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  fileName?: string | null;
}) {
  if (!url) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-[#0e1422] border-slate-800 text-slate-200 p-4 shadow-2xl rounded-xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-800/80 pb-2.5 pr-6">
          <DialogTitle className="text-xs font-semibold text-slate-300 truncate max-w-[70%]">
            {fileName || "Image Preview"}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2.5 py-1 bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/60 rounded-lg transition-colors font-medium"
            >
              <ExternalLink className="h-3 w-3 text-slate-400" /> Open in New Tab
            </a>
          </div>
        </DialogHeader>

        <div className="mt-3 flex items-center justify-center min-h-[280px] max-h-[70vh] overflow-auto rounded-lg bg-[#080b12] p-2 border border-slate-800/80">
          <img
            src={url}
            alt={fileName || "Attachment preview"}
            className="max-h-[66vh] max-w-full object-contain rounded shadow-md"
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
          <span className="text-slate-400">Click outside or press ESC to close</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs bg-slate-800/60 hover:bg-slate-700 border-slate-700/70 text-slate-200 font-medium px-3 rounded-lg"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
