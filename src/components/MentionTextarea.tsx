import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  filterMentionUsers,
  getMentionQuery,
  insertMention,
  type MentionQuery,
  type MentionUser,
} from "@/lib/mentions";

/** Popup is at most this tall (px) and scrolls beyond it. */
const POPUP_MAX_HEIGHT = 200;

type TextareaProps = Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "onKeyDown">;

export interface MentionTextareaProps extends TextareaProps {
  value: string;
  onValueChange: (value: string) => void;
  users: MentionUser[];
  /** Enter (with no suggestion popup open) calls this; Shift+Enter inserts a new line. */
  onSubmit?: () => void;
  /** Escape (with no popup open) calls this. */
  onCancel?: () => void;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

/**
 * Textarea with Teams-style @mention autocomplete. Typing `@` opens a popup of
 * users (avatar, name, email) that filters as you type. ArrowUp/Down move,
 * Enter/Tab or click select, Escape closes. When the popup is closed Enter
 * submits (via `onSubmit`) and Shift+Enter inserts a newline.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea({ value, onValueChange, users, onSubmit, onCancel, className, ...rest }, ref) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
    const listboxId = useId();
    const [mention, setMention] = useState<MentionQuery | null>(null);
    const [active, setActive] = useState(0);
    // Set after the user dismisses the popup with Escape; cleared by the next edit.
    const dismissedAt = useRef<number | null>(null);

    const suggestions = useMemo(
      () => (mention ? filterMentionUsers(users, mention.query) : []),
      [mention, users],
    );
    const open = mention !== null && suggestions.length > 0;

    // Escape closes the popup first, then cancels. Radix dialogs listen for Escape
    // on the document in the capture phase, i.e. before the textarea sees it, so
    // intercept earlier (window capture) or the whole modal would close.
    const escapeState = useRef({ open, mentionStart: mention?.start ?? null, onCancel });
    escapeState.current = { open, mentionStart: mention?.start ?? null, onCancel };
    useEffect(() => {
      const onEscape = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.target !== innerRef.current || e.isComposing) return;
        const st = escapeState.current;
        if (!st.open && !st.onCancel) return;
        e.preventDefault();
        e.stopPropagation();
        if (st.open) {
          dismissedAt.current = st.mentionStart;
          setMention(null);
        } else {
          st.onCancel?.();
        }
      };
      window.addEventListener("keydown", onEscape, true);
      return () => window.removeEventListener("keydown", onEscape, true);
    }, []);

    // Place the popup against the textarea in viewport coordinates: above it when
    // there is room (like Teams), otherwise below, never taller than the space
    // available, so it can't be clipped by a modal's overflow or cover the input.
    const [pos, setPos] = useState<{
      left: number;
      width: number;
      maxHeight: number;
      edge: number;
      placement: "above" | "below";
    } | null>(null);

    useLayoutEffect(() => {
      if (!open) {
        setPos(null);
        return;
      }
      const place = () => {
        const el = innerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 4;
        const margin = 8;
        const spaceAbove = r.top - margin - gap;
        const spaceBelow = vh - r.bottom - margin - gap;
        const wanted = Math.min(POPUP_MAX_HEIGHT, 40 + suggestions.length * 36);
        const placement = spaceAbove >= wanted || spaceAbove >= spaceBelow ? "above" : "below";
        const space = placement === "above" ? spaceAbove : spaceBelow;
        const width = Math.min(Math.max(r.width, 260), 340, vw - margin * 2);
        setPos({
          left: Math.min(Math.max(r.left, margin), vw - width - margin),
          width,
          maxHeight: Math.max(96, Math.min(POPUP_MAX_HEIGHT, space)),
          edge: placement === "above" ? vh - r.top + gap : r.bottom + gap,
          placement,
        });
      };
      place();
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true); // capture: also scrolling modal panels
      return () => {
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
      };
    }, [open, suggestions.length]);

    useEffect(() => {
      setActive(0);
    }, [mention?.query, mention?.start]);

    useEffect(() => {
      if (!open) return;
      document.getElementById(`${listboxId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
    }, [active, open, listboxId]);

    const syncMention = useCallback((text: string, caret: number) => {
      const q = getMentionQuery(text, caret);
      if (q && dismissedAt.current === q.start) {
        setMention(null);
        return;
      }
      if (!q) dismissedAt.current = null;
      setMention(q);
    }, []);

    const select = (user: MentionUser) => {
      const el = innerRef.current;
      if (!mention || !el) return;
      const caret = el.selectionStart ?? value.length;
      const next = insertMention(value, mention, caret, user);
      onValueChange(next.text);
      setMention(null);
      dismissedAt.current = null;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          select(suggestions[active] ?? suggestions[0]);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && onSubmit) {
        e.preventDefault();
        onSubmit();
        return;
      }
    };

    return (
      <div className="relative">
        <Textarea
          {...rest}
          ref={innerRef}
          value={value}
          className={className}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-${active}` : undefined}
          onChange={(e) => {
            onValueChange(e.target.value);
            syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          // Only typing opens the popup; moving the caret elsewhere closes it, so
          // clicking into a finished @Name doesn't pop the list back up.
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) setMention(null);
          }}
          onClick={() => setMention(null)}
          onBlur={(e) => {
            rest.onBlur?.(e);
            setMention(null);
          }}
        />
        {open && pos && createPortal(
          <div
            id={listboxId}
            role="listbox"
            aria-label="Mention a user"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.placement === "above" ? { bottom: pos.edge } : { top: pos.edge }),
              // Radix dialogs set pointer-events:none on <body>; the portal sits outside the dialog.
              pointerEvents: "auto",
            }}
            // Keep Radix from treating a click in the portal as an "outside" click that closes the modal.
            onPointerDown={(e) => e.stopPropagation()}
            // Radix's scroll lock swallows wheel/touch scrolling on anything outside the dialog.
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            // Pressing the scrollbar / dragging the list must not steal focus from the
            // textarea (blur closes the popup). Scrollbar dragging still works.
            onMouseDown={(e) => e.preventDefault()}
            className="z-[100] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl custom-scrollbar"
          >
            <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suggestions
            </div>
            {suggestions.map((u, i) => (
              <div
                key={u.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === active}
                // click (not mousedown) so pressing and dragging to scroll doesn't pick a user
                onClick={() => select(u)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <Avatar className="h-6 w-6">
                  {u.avatar_url && <AvatarImage src={u.avatar_url} alt="" />}
                  <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                    {initials(u.display_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium leading-tight">{u.display_name}</div>
                  {u.email && (
                    <div className="truncate text-[10px] leading-tight text-muted-foreground">{u.email}</div>
                  )}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
      </div>
    );
  },
);
