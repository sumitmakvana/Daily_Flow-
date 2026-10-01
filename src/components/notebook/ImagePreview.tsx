import React from "react";
import { cn } from "@/lib/utils";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";

interface ImagePreviewProps {
  images?: string[];
  size?: "sm" | "md";
  className?: string;
}

/** Thumbnail strip for note images; clicking a thumbnail opens a larger lightbox. */
export function ImagePreview({ images, size = "sm", className }: ImagePreviewProps) {
  const [active, setActive] = React.useState<string | null>(null);

  if (!images || images.length === 0) return null;

  return (
    <>
      <div
        className={cn("flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {images.map((img, idx) => (
          <img
            key={idx}
            src={img}
            alt="Attachment"
            title="Click to enlarge"
            onClick={() => setActive(img)}
            className={cn(
              "object-cover rounded-md border border-border/80 shrink-0 bg-background cursor-zoom-in hover:opacity-90",
              size === "sm" ? "w-14 h-14" : "w-28 h-28"
            )}
          />
        ))}
      </div>
      <ImagePreviewModal
        open={!!active}
        onOpenChange={(o) => !o && setActive(null)}
        url={active}
      />
    </>
  );
}
