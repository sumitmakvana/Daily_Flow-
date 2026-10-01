import React from "react";
import {
  CalendarDays,
  ClipboardList,
  Users,
  Palmtree,
  Building2,
  Filter,
  ChevronLeft,
  ChevronRight,
  CalendarOff,
} from "lucide-react";
import type { Task, Leave } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toLocalISO } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Event model + pastel colour coding (light theme)                    */
/* ------------------------------------------------------------------ */

export type EventKind = "my" | "team" | "leave" | "wfh" | "office" | "public";
export type CalLayer = "my" | "team" | "leave" | "office" | "public";

export interface CalEvent {
  id: string;
  kind: EventKind;
  label: string;
  /** Short tag shown at the right of the chip (e.g. WFH / Leave). */
  tag?: string;
  emoji?: string;
  task?: Task;
  leave?: Leave;
}

export const KIND_META: Record<EventKind, { chip: string; dot: string; name: string }> = {
  my: { chip: "bg-blue-500/15 text-blue-200 border-blue-500/30", dot: "bg-blue-500", name: "My Task" },
  team: { chip: "bg-purple-500/15 text-purple-200 border-purple-500/30", dot: "bg-purple-500", name: "Team Task" },
  leave: { chip: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30", dot: "bg-emerald-500", name: "Leave" },
  wfh: { chip: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30", dot: "bg-cyan-500", name: "WFH" },
  office: { chip: "bg-rose-500/15 text-rose-200 border-rose-500/30", dot: "bg-rose-500", name: "Office Closed" },
  public: { chip: "bg-amber-500/15 text-amber-200 border-amber-500/30", dot: "bg-amber-500", name: "Public Holiday" },
};

export const LAYER_META: Array<{ key: CalLayer; label: string; dot: string }> = [
  { key: "my", label: "My Tasks", dot: "bg-blue-500" },
  { key: "team", label: "Team Tasks", dot: "bg-purple-500" },
  { key: "leave", label: "Leave & WFH", dot: "bg-emerald-500" },
  { key: "office", label: "Office Holidays", dot: "bg-rose-500" },
  { key: "public", label: "Public Holidays", dot: "bg-amber-500" },
];

export function layerOf(kind: EventKind): CalLayer {
  return kind === "wfh" ? "leave" : kind;
}

export type EventClickHandler = (event: CalEvent, date: Date) => void;

export function EventChip({
  event,
  full = false,
  uniform = false,
  onClick,
}: {
  event: CalEvent;
  /** uniform: fixed-size card (month cells) — 2-line clamp, equal height everywhere. */
  uniform?: boolean;
  /** full: allow wrapping so complete names are readable (week/day/list). */
  full?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const isTask = !!event.task;
  return (
    <div
      onClick={onClick}
      title={event.tag ? `${event.label} · ${event.tag}` : event.label}
      className={cn(
        "flex min-w-0 items-center gap-x-1.5 gap-y-0.5 rounded-md border px-1.5 font-medium",
        uniform ? "h-8 w-full flex-nowrap py-0 text-[10px] leading-[1.15]" : "flex-wrap py-1 text-[11px] leading-snug",
        onClick && "cursor-pointer transition-colors hover:brightness-125",
        KIND_META[event.kind].chip
      )}
    >
      {event.emoji && <span className="shrink-0">{event.emoji}</span>}
      <span className={cn("min-w-0", uniform ? "line-clamp-2 break-words" : full ? "break-words" : isTask ? "line-clamp-2 break-words" : "truncate")}>
        {event.label}
      </span>
      {event.tag && (
        <span className="ml-auto shrink-0 pl-1 text-[9px] font-semibold uppercase opacity-80">{event.tag}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export type NavKey = "calendar" | "my" | "team" | "holidays" | "leaves" | "filters";

export function CalendarSidebar({
  active,
  onNav,
  layers,
  onToggleLayer,
}: {
  active: NavKey;
  onNav: (k: NavKey) => void;
  layers: Record<CalLayer, boolean>;
  onToggleLayer: (l: CalLayer) => void;
}) {
  const items: Array<{ key: NavKey; label: string; icon: React.ElementType }> = [
    { key: "calendar", label: "Calendar", icon: CalendarDays },
    { key: "my", label: "My Tasks", icon: ClipboardList },
    { key: "team", label: "Team Calendar", icon: Users },
    { key: "holidays", label: "Office Holidays", icon: Building2 },
    { key: "leaves", label: "Leaves", icon: Palmtree },
    { key: "filters", label: "Filters", icon: Filter },
  ];
  return (
    <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-3 xl:flex xl:h-full">
      <nav className="space-y-0.5">
        {items.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onNav(key)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              active === key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Calendars</div>
        <LayerToggles layers={layers} onToggle={onToggleLayer} />
      </div>
    </aside>
  );
}

export function LayerToggles({
  layers,
  onToggle,
}: {
  layers: Record<CalLayer, boolean>;
  onToggle: (l: CalLayer) => void;
}) {
  return (
    <div className="space-y-1.5">
      {LAYER_META.map((l) => (
        <label key={l.key} className="flex cursor-pointer items-center gap-2.5 px-1 py-0.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={layers[l.key]}
            onChange={() => onToggle(l.key)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span className={cn("h-2.5 w-2.5 rounded-full", l.dot)} />
          {l.label}
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month grid                                                          */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

export function MonthGrid({
  cells,
  eventsFor,
  onDayClick,
  onEventClick,
}: {
  cells: Array<{ date: Date; isCurrentMonth: boolean }>;
  eventsFor: (date: Date) => CalEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: EventClickHandler;
}) {
  const todayStr = toLocalISO(new Date());
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={cn("py-2", i === 0 && "text-rose-400")}>
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {cells.map(({ date, isCurrentMonth }, idx) => {
          const dateStr = toLocalISO(date);
          const events = eventsFor(date);
          const isToday = dateStr === todayStr;
          const wfh = events.filter((e) => e.kind === "wfh").length;
          const leave = events.filter((e) => e.kind === "leave").length;
          const shown = events.slice(0, MAX_CHIPS);
          const more = events.length - shown.length;
          const hasOffice = events.some((e) => e.kind === "office");
          return (
            <div
              key={idx}
              onClick={() => onDayClick(date)}
              className={cn(
                "min-h-[64px] min-w-0 cursor-pointer overflow-hidden p-1 transition-colors hover:bg-accent/60 sm:min-h-[132px] sm:p-1.5",
                !isCurrentMonth && "bg-muted/60 opacity-60",
                hasOffice && "bg-rose-500/5",
                isToday && "bg-primary/10 ring-1 ring-inset ring-primary/70 hover:bg-primary/15"
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold sm:h-6 sm:min-w-6 sm:text-xs",
                    isToday ? "bg-primary text-primary-foreground" : idx % 7 === 0 ? "text-rose-400" : "text-foreground"
                  )}
                >
                  {date.getDate()}
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  {(date.getDay() === 0 || date.getDay() === 6) && (
                    <span className="text-[9px] font-medium text-muted-foreground">
                      {date.getDay() === 0 ? "Sunday" : "Saturday"}
                    </span>
                  )}
                  {leave > 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[9px] font-semibold text-emerald-300">
                      {leave} leave
                    </span>
                  )}
                  {wfh > 0 && (
                    <span className="rounded-full bg-cyan-500/15 px-1.5 text-[9px] font-semibold text-cyan-300">
                      {wfh} WFH
                    </span>
                  )}
                </span>
              </div>

              {/* Desktop chips */}
              <div className="hidden flex-col gap-1 sm:flex">
                {shown.map((e) => (
                  <EventChip
                    key={e.id}
                    event={e}
                    uniform
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEventClick(e, date);
                    }}
                  />
                ))}
                {more > 0 && <div className="h-4 truncate pl-1 text-[10px] font-semibold leading-4 text-primary">+{more} more</div>}
              </div>

              {/* Mobile dots */}
              <div className="flex flex-wrap justify-center gap-1 sm:hidden">
                {events.slice(0, 6).map((e) => (
                  <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", KIND_META[e.kind].dot)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week / Day / List views                                             */
/* ------------------------------------------------------------------ */

function fmtLong(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function WeekView({
  days,
  eventsFor,
  onDayClick,
  onEventClick,
}: {
  days: Date[];
  eventsFor: (date: Date) => CalEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: EventClickHandler;
}) {
  const todayStr = toLocalISO(new Date());
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((d) => {
        const events = eventsFor(d);
        const isToday = toLocalISO(d) === todayStr;
        return (
          <div
            key={d.toISOString()}
            onClick={() => onDayClick(d)}
            className={cn(
              "min-w-0 cursor-pointer rounded-xl border bg-card p-2 transition-colors hover:bg-accent/60 md:min-h-[320px]",
              isToday ? "border-primary/60" : "border-border"
            )}
          >
            <div className={cn("mb-2 text-xs font-semibold", isToday ? "text-primary" : "text-foreground")}>
              {fmtLong(d)}
            </div>
            <div className="flex flex-col gap-1.5">
              {events.length === 0 && <div className="text-[11px] text-muted-foreground">No events</div>}
              {events.map((e) => (
                <EventChip
                  key={e.id}
                  event={e}
                  full
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEventClick(e, d);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DayView({
  date,
  events,
  onOpen,
  onEventClick,
}: {
  date: Date;
  events: CalEvent[];
  onOpen: () => void;
  onEventClick: EventClickHandler;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </h3>
        <button onClick={onOpen} className="shrink-0 text-xs font-medium text-primary hover:underline">
          Open details
        </button>
      </div>
      {events.length === 0 ? (
        <EmptyState text="Nothing scheduled for this day." />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <EventChip key={e.id} event={e} full onClick={() => onEventClick(e, date)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ListView({
  days,
  eventsFor,
  onDayClick,
  onEventClick,
}: {
  days: Date[];
  eventsFor: (date: Date) => CalEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: EventClickHandler;
}) {
  const rows = days.map((d) => ({ d, events: eventsFor(d) })).filter((r) => r.events.length > 0);
  if (rows.length === 0) return <EmptyState text="No events in this month." />;
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map(({ d, events }) => (
        <div
          key={d.toISOString()}
          onClick={() => onDayClick(d)}
          className="grid cursor-pointer grid-cols-[84px_1fr] gap-3 p-3 transition-colors hover:bg-accent/60 sm:grid-cols-[110px_1fr]"
        >
          <div className="text-xs font-semibold text-foreground">{fmtLong(d)}</div>
          <div className="flex min-w-0 flex-col gap-1.5">
            {events.map((e) => (
              <EventChip
                key={e.id}
                event={e}
                full
                onClick={(ev) => {
                  ev.stopPropagation();
                  onEventClick(e, d);
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-xs text-muted-foreground">
      <CalendarOff className="h-5 w-5" />
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right panel: mini calendar, today, legend                           */
/* ------------------------------------------------------------------ */

export function MiniCalendar({
  cells,
  title,
  eventsFor,
  onPrev,
  onNext,
  onPick,
}: {
  cells: Array<{ date: Date; isCurrentMonth: boolean }>;
  title: string;
  eventsFor: (date: Date) => CalEvent[];
  onPrev: () => void;
  onNext: () => void;
  onPick: (d: Date) => void;
}) {
  const todayStr = toLocalISO(new Date());
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="flex items-center gap-1">
          <button onClick={onPrev} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={onNext} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] font-semibold text-muted-foreground">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map(({ date, isCurrentMonth }, i) => {
          const isToday = toLocalISO(date) === todayStr;
          const has = eventsFor(date).length > 0;
          return (
            <button
              key={i}
              onClick={() => onPick(date)}
              className={cn(
                "relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors",
                isToday ? "bg-primary font-bold text-primary-foreground" : "text-foreground hover:bg-accent",
                !isCurrentMonth && !isToday && "text-muted-foreground/50",
                isCurrentMonth && i % 7 === 0 && !isToday && "text-rose-400"
              )}
            >
              {date.getDate()}
              {has && !isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary/70" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TodayPanel({
  date,
  events,
  onOpen,
  onEventClick,
}: {
  date: Date;
  events: CalEvent[];
  onOpen: () => void;
  onEventClick: EventClickHandler;
}) {
  const wfh = events.filter((e) => e.kind === "wfh").length;
  const tasks = events.filter((e) => e.task).length;
  const summary = [wfh ? `${wfh} WFH` : "", tasks ? `${tasks} task${tasks > 1 ? "s" : ""}` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button onClick={onOpen} className="text-sm font-semibold text-foreground hover:text-primary">
          Today · {date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
        </button>
        {summary && <span className="text-[11px] font-medium text-primary">{summary}</span>}
      </div>
      {events.length === 0 ? (
        <div className="py-3 text-xs text-muted-foreground">Nothing scheduled today.</div>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <li
              key={e.id}
              onClick={() => onEventClick(e, date)}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 transition-colors hover:bg-accent/60"
            >
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", KIND_META[e.kind].dot)} />
              <div className="min-w-0">
                <div className="break-words text-xs font-medium text-foreground">{e.label}</div>
                <div className="text-[10px] text-muted-foreground">{KIND_META[e.kind].name}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Legend doubles as a quick layer toggle: click an entry to show/hide that kind. */
export function LegendPanel({
  layers,
  onToggleLayer,
}: {
  layers: Record<CalLayer, boolean>;
  onToggleLayer: (l: CalLayer) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 text-sm font-semibold text-foreground">Legend</div>
      <ul className="space-y-0.5">
        {(Object.keys(KIND_META) as EventKind[]).map((k) => {
          const layer = layerOf(k);
          const on = layers[layer];
          return (
            <li key={k}>
              <button
                type="button"
                onClick={() => onToggleLayer(layer)}
                title={on ? "Click to hide" : "Click to show"}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent",
                  on ? "text-foreground" : "text-muted-foreground line-through"
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", KIND_META[k].dot, !on && "opacity-30")} />
                {KIND_META[k].name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
