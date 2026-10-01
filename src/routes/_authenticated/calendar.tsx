import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { LeaveDialog } from "@/components/LeaveDialog";
import { leavesService } from "@/services/leaves";
import { holidaysService } from "@/services/operations";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskCard } from "@/components/TaskCard";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Calendar as CalendarIcon, User, Filter, Palmtree, Home, Check, X, Trash2, Pencil, Building2, Search } from "lucide-react";
import type { Profile, Task, Leave, HolidayCalendar } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getLocalHoliday, fetchIndianHolidays, toLocalISO, getHolidayDateStr, getDayOff, parseLocalYYYYMMDD, type Holiday } from "@/lib/format";
import { statusColor, leaveColor, leaveDot, priorityDot } from "@/lib/colors";
import { toast } from "sonner";
import {
  CalendarSidebar,
  LayerToggles,
  MonthGrid,
  WeekView,
  DayView,
  ListView,
  MiniCalendar,
  TodayPanel,
  LegendPanel,
  layerOf,
  type CalEvent,
  type CalLayer,
  type NavKey,
} from "@/components/calendar/CalendarParts";




export const Route = createFileRoute("/_authenticated/calendar")({

  component: CalendarPage,
});

type ViewKey = "month" | "week" | "day" | "list";
const ALL = "__all";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function CalendarPage() {
  const { user, isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [apiHolidays, setApiHolidays] = useState<Record<string, Holiday>>({});
  const [customHolidays, setCustomHolidays] = useState<HolidayCalendar[]>([]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Selection & Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<Leave | null>(null);
  const [holidaysSheetOpen, setHolidaysSheetOpen] = useState(false);

  
  // Custom Month/Year Picker States
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"months" | "years">("months");
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [decadeStart, setDecadeStart] = useState(Math.floor(new Date().getFullYear() / 10) * 10);

  useEffect(() => {
    if (popoverOpen) {
      setPickerYear(year);
      setDecadeStart(Math.floor(year / 10) * 10);
      setPickerMode("months");
    }
  }, [popoverOpen, year]);

  // Filters state
  const [status, setStatus] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [assignee, setAssignee] = useState<string>(ALL);
  const [myTasksOnly, setMyTasksOnly] = useState(true);


  const load = useCallback(async () => {
    const [{ data: t }, { data: p }, l, h] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
      leavesService.getLeaves().catch(() => [] as Leave[]),
      holidaysService.list().catch(() => [] as HolidayCalendar[]),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
    setLeaves(l || []);
    setCustomHolidays(h || []);
  }, []);



  useEffect(() => {
    load();
  }, [load]);
  
  useRealtimeTasks(load, "calendar-rt");

  useEffect(() => {
    fetchIndianHolidays(year).then(setApiHolidays).catch(() => {});
  }, [year]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleApproveLeave = async (id: string) => {
    try {
      await leavesService.updateStatus(id, "approved");
      toast.success("Leave request approved!");
      load();
    } catch (err) {
      toast.error("Failed to approve: " + (err as Error).message);
    }
  };

  const handleRejectLeave = async (id: string) => {
    try {
      await leavesService.updateStatus(id, "rejected");
      toast.success("Leave request rejected.");
      load();
    } catch (err) {
      toast.error("Failed to reject: " + (err as Error).message);
    }
  };

  const handleCancelLeave = async (id: string) => {
    try {
      await leavesService.deleteLeave(id);
      toast.success("Leave cancelled.");
      load();
    } catch (err) {
      toast.error("Failed to cancel: " + (err as Error).message);
    }
  };

  // Filter tasks based on settings

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (status !== ALL && t.status !== status) return false;
      if (priority !== ALL && t.priority !== priority) return false;
      if (assignee !== ALL && t.assigned_to !== assignee) return false;
      if (myTasksOnly && t.assigned_to !== user?.id) return false;
      return true;
    });
  }, [tasks, status, priority, assignee, myTasksOnly, user]);

  // Construct month calendar cells
  const calendarCells = useMemo(() => {
    const cells = [];
    const firstDayIndex = new Date(year, month, 1).getDay();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const currentMonthDays = new Date(year, month + 1, 0).getDate();

    // Pad previous month days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthDays - i);
      cells.push({ date, isCurrentMonth: false });
    }

    // Add current month days
    for (let i = 1; i <= currentMonthDays; i++) {
      const date = new Date(year, month, i);
      cells.push({ date, isCurrentMonth: true });
    }

    // Pad next month days
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const date = new Date(year, month + 1, i);
      cells.push({ date, isCurrentMonth: false });
    }

    // Only as many weeks as the month needs (no empty trailing week)
    return cells.slice(0, Math.ceil((firstDayIndex + currentMonthDays) / 7) * 7);
  }, [year, month]);

  // Group tasks by date string (YYYY-MM-DD) for quick lookup
  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    filteredTasks.forEach((t) => {
      if (!t.due_date) return;
      const dStr = t.due_date; // YYYY-MM-DD
      if (!map[dStr]) map[dStr] = [];
      map[dStr].push(t);
    });
    return map;
  }, [filteredTasks]);

  // Group leaves by date string (YYYY-MM-DD)
  const leavesByDate = useMemo(() => {
    const map: Record<string, Leave[]> = {};
    leaves.forEach((l) => {
      if (l.status === "rejected" || l.status === "cancelled") return;
      const start = parseLocalYYYYMMDD(l.start_date.slice(0, 10));
      const end = parseLocalYYYYMMDD(l.end_date.slice(0, 10));
      if (!start || !end) return;
      const cur = new Date(start);
      while (cur <= end) {
        const dStr = toLocalISO(cur);
        // Leave / WFH only counts on working days (never weekends or Office Holidays)
        if (!getDayOff(dStr, customHolidays)) {
          if (!map[dStr]) map[dStr] = [];
          map[dStr].push(l);
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [leaves, customHolidays]);

  // Get tasks and leaves for selected date
  const selectedDateStr = selectedDate ? toLocalISO(selectedDate) : "";
  const selectedDateTasks = useMemo(() => {
    return tasksByDate[selectedDateStr] || [];
  }, [selectedDateStr, tasksByDate]);

  const selectedDateLeaves = useMemo(() => {
    return leavesByDate[selectedDateStr] || [];
  }, [selectedDateStr, leavesByDate]);

  const selectedDateLeaveSummary = useMemo(() => {
    const actualLeaves = selectedDateLeaves.filter((l) => l.leave_type !== "wfh");
    const wfhLeaves = selectedDateLeaves.filter((l) => l.leave_type === "wfh");
    const parts: string[] = [];
    if (actualLeaves.length > 0) parts.push(`${actualLeaves.length} leave${actualLeaves.length > 1 ? "s" : ""}`);
    if (wfhLeaves.length > 0) parts.push(`${wfhLeaves.length} WFH`);
    if (parts.length === 0) return "0 leave/WFH";
    return parts.join(" and ");
  }, [selectedDateLeaves]);

  // ---- View, layers and search ----
  const [view, setView] = useState<ViewKey>("month");
  const [layers, setLayers] = useState<Record<CalLayer, boolean>>({ my: true, team: true, leave: true, office: true, public: true });
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Team tasks layer is driven by the existing "My Tasks Only" filter
  const layerVisible = useMemo(() => ({ ...layers, team: !myTasksOnly }), [layers, myTasksOnly]);
  const handleToggleLayer = (l: CalLayer) => {
    if (l === "team") setMyTasksOnly((v) => !v);
    else setLayers((prev) => ({ ...prev, [l]: !prev[l] }));
  };

  const eventsFor = useCallback(
    (date: Date, all = false): CalEvent[] => {
      const dateStr = toLocalISO(date);
      const out: CalEvent[] = [];
      const h = getLocalHoliday(date, apiHolidays, customHolidays);
      if (h && h.isHoliday) {
        out.push({
          id: `h-${dateStr}`,
          kind: h.isCompanyHoliday ? "office" : "public",
          label: h.isCompanyHoliday ? `Office Holiday · ${h.name}` : h.name,
          emoji: h.emoji,
        });
      }
      (tasksByDate[dateStr] || []).forEach((t) =>
        out.push({ id: `t-${t.id}`, kind: t.assigned_to === user?.id ? "my" : "team", label: t.task_name, task: t })
      );
      (leavesByDate[dateStr] || []).forEach((l) => {
        const name = l.user_name || profiles.find((p) => p.id === l.user_id)?.display_name || "Member";
        const isWfh = l.leave_type === "wfh";
        out.push({ id: `l-${l.id}-${dateStr}`, kind: isWfh ? "wfh" : "leave", label: name, tag: isWfh ? "WFH" : "Leave", leave: l });
      });
      if (all) return out;
      const q = search.trim().toLowerCase();
      return out.filter(
        (e) =>
          layerVisible[layerOf(e.kind)] &&
          (!q || e.label.toLowerCase().includes(q) || e.task?.task_code?.toLowerCase().includes(q))
      );
    },
    [apiHolidays, customHolidays, tasksByDate, leavesByDate, profiles, user, search, layerVisible]
  );

  const weekDays = useMemo(() => {
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - currentDate.getDay());
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [currentDate]);

  const monthDays = useMemo(() => calendarCells.filter((c) => c.isCurrentMonth).map((c) => c.date), [calendarCells]);

  const viewTitle = useMemo(() => {
    if (view === "week") {
      const a = weekDays[0];
      const b = weekDays[6];
      const f = (d: Date, y = false) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(y ? { year: "numeric" } : {}) });
      return `${f(a)} – ${f(b, true)}`;
    }
    if (view === "day") {
      return currentDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
    return `${MONTHS[month]} ${year}`;
  }, [view, weekDays, currentDate, month, year]);

  const shift = (dir: 1 | -1) => {
    if (view === "week") setCurrentDate(new Date(year, month, currentDate.getDate() + 7 * dir));
    else if (view === "day") setCurrentDate(new Date(year, month, currentDate.getDate() + dir));
    else setCurrentDate(new Date(year, month + dir, 1));
  };

  // Clicking a date opens the day side panel directly
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);

  // Clicking a date opens the day side panel directly
  const handleDayClick = (d: Date) => {
    setSelectedDate(d);
    setSheetOpen(true);
  };

  // Open the same details the rest of the app uses for each event type
  const handleEventClick = (e: CalEvent, d: Date) => {
    if (e.task) {
      setDetailTask(e.task);
    } else if (e.leave) {
      handleDayClick(d);
    } else {
      setHolidaysSheetOpen(true);
    }
  };

  const handleSidebarNav = (k: NavKey) => {
    if (k === "calendar") setView("month");
    else if (k === "my") setMyTasksOnly(true);
    else if (k === "team") setMyTasksOnly(false);
    else if (k === "holidays") setHolidaysSheetOpen(true);
    else if (k === "leaves") {
      setEditingLeave(null);
      setLeaveDialogOpen(true);
    } else if (k === "filters") setFilterOpen((o) => !o);
  };

  return (
    <div className="max-w-[1800px] mx-auto px-4 pt-4 pb-24 lg:pb-14 overflow-x-hidden">
      {/* Desktop: all columns share one viewport-high row and scroll internally */}
      <div className="grid gap-4 lg:h-[calc(100dvh-14.5rem)] lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_230px] xl:grid-cols-[160px_minmax(0,1fr)_230px]">
        <CalendarSidebar active="calendar" onNav={handleSidebarNav} layers={layerVisible} onToggleLayer={handleToggleLayer} />

        {/* Main calendar */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-2.5 sm:p-3 lg:h-full">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => shift(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {view === "month" || view === "list" ? (
                <div className="flex items-center">
                  {/* Custom Month-Year Popover Picker */}
                  <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="h-9 text-sm sm:text-base font-bold px-2 flex items-center gap-1 hover:bg-accent/50 cursor-pointer">
                        {MONTHS[month]} {year} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-3 bg-card text-foreground border border-border rounded-xl shadow-lg z-50">
                      {/* Popover Header */}
                      <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                        <button
                          onClick={() => setPickerMode(pickerMode === "months" ? "years" : "months")}
                          className="text-xs font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {pickerMode === "months" ? (
                            <>
                              {pickerYear} <ChevronDown className="h-3 w-3" />
                            </>
                          ) : (
                            <>
                              {decadeStart} - {decadeStart + 9} <ChevronUp className="h-3 w-3" />
                            </>
                          )}
                        </button>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 cursor-pointer"
                            onClick={() => {
                              if (pickerMode === "months") {
                                setPickerYear(pickerYear - 1);
                              } else {
                                setDecadeStart(decadeStart - 10);
                              }
                            }}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 cursor-pointer"
                            onClick={() => {
                              if (pickerMode === "months") {
                                setPickerYear(pickerYear + 1);
                              } else {
                                setDecadeStart(decadeStart + 10);
                              }
                            }}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Popover Content Grid */}
                      {pickerMode === "months" ? (
                        // Months Grid: 4 columns x 4 rows
                        <div className="grid grid-cols-4 gap-1.5 text-center py-1">
                          {[
                            { name: "Jan", val: 0, yearOffset: 0, isCurrent: true },
                            { name: "Feb", val: 1, yearOffset: 0, isCurrent: true },
                            { name: "Mar", val: 2, yearOffset: 0, isCurrent: true },
                            { name: "Apr", val: 3, yearOffset: 0, isCurrent: true },
                            { name: "May", val: 4, yearOffset: 0, isCurrent: true },
                            { name: "Jun", val: 5, yearOffset: 0, isCurrent: true },
                            { name: "Jul", val: 6, yearOffset: 0, isCurrent: true },
                            { name: "Aug", val: 7, yearOffset: 0, isCurrent: true },
                            { name: "Sep", val: 8, yearOffset: 0, isCurrent: true },
                            { name: "Oct", val: 9, yearOffset: 0, isCurrent: true },
                            { name: "Nov", val: 10, yearOffset: 0, isCurrent: true },
                            { name: "Dec", val: 11, yearOffset: 0, isCurrent: true },
                            { name: "Jan", val: 0, yearOffset: 1, isCurrent: false },
                            { name: "Feb", val: 1, yearOffset: 1, isCurrent: false },
                            { name: "Mar", val: 2, yearOffset: 1, isCurrent: false },
                            { name: "Apr", val: 3, yearOffset: 1, isCurrent: false },
                          ].map((mObj, idx) => {
                            const targetYear = pickerYear + mObj.yearOffset;
                            const isActive = mObj.isCurrent && mObj.val === month && targetYear === year;
                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  setCurrentDate(new Date(targetYear, mObj.val, 1));
                                  setPopoverOpen(false);
                                }}
                                className={cn(
                                  "h-10 text-xs rounded-lg transition-all flex items-center justify-center font-medium cursor-pointer",
                                  isActive 
                                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                                    : mObj.isCurrent
                                      ? "hover:bg-accent text-foreground"
                                      : "text-muted-foreground/30 hover:bg-accent/40"
                                )}
                              >
                                {mObj.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        // Years Grid: 4 columns x 4 rows
                        <div className="grid grid-cols-4 gap-1.5 text-center py-1">
                          {Array.from({ length: 16 }, (_, i) => decadeStart - 2 + i).map((yVal) => {
                            const isActive = yVal === year;
                            const isOutOfDecade = yVal < decadeStart || yVal > decadeStart + 9;
                            return (
                              <button
                                key={yVal}
                                onClick={() => {
                                  setPickerYear(yVal);
                                  setDecadeStart(Math.floor(yVal / 10) * 10);
                                  setPickerMode("months");
                                }}
                                className={cn(
                                  "h-10 text-xs rounded-lg transition-all flex items-center justify-center font-medium cursor-pointer",
                                  isActive
                                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                                    : isOutOfDecade
                                      ? "text-muted-foreground/30 hover:bg-accent/40"
                                      : "hover:bg-accent text-foreground"
                                )}
                              >
                                {yVal}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <span className="px-2 text-base font-bold text-foreground whitespace-nowrap">{viewTitle}</span>
              )}
              <Button variant="outline" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => shift(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={handleToday} className="h-8 text-xs">
              Today
            </Button>

            <div className="flex items-center rounded-lg border border-border bg-background/60 p-0.5">
              {(["month", "week", "day", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "h-8 rounded-md px-2.5 text-xs font-medium capitalize transition-colors sm:px-3",
                    view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search in calendar..."
                  className="h-8 w-full rounded-lg border border-border bg-background/60 pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setFilterOpen((o) => !o)}
                className={cn("h-8 w-8 shrink-0 xl:hidden", filterOpen && "border-primary/50 bg-primary/10 text-primary")}
                title="Filters"
              >
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Filter panel */}
          {(
            <div className={cn("space-y-3 rounded-xl border border-border bg-muted/20 p-2.5", !filterOpen && "hidden")}>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 w-[calc(50%-0.25rem)] text-xs bg-background sm:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent className="bg-popover text-popover-foreground">
                    <SelectItem value={ALL}>All Status</SelectItem>
                    <SelectItem value="To Do">To Do</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="In Review">In Review</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Blocked">Blocked</SelectItem>
                    <SelectItem value="On Hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 w-[calc(50%-0.25rem)] text-xs bg-background sm:w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent className="bg-popover text-popover-foreground">
                    <SelectItem value={ALL}>All Priority</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="h-8 w-[calc(50%-0.25rem)] text-xs bg-background sm:w-40"><SelectValue placeholder="Assignee" /></SelectTrigger>
                  <SelectContent className="bg-popover text-popover-foreground">
                    <SelectItem value={ALL}>All Assignees</SelectItem>
                    {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setMyTasksOnly(!myTasksOnly)}
                  className={cn(
                    "h-8 px-3 rounded-md border text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5",
                    myTasksOnly
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-muted text-muted-foreground"
                  )}
                >
                  <User className="h-3.5 w-3.5" />
                  My Tasks Only
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHolidaysSheetOpen(true)}
                  className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 font-medium sm:ml-auto xl:hidden"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Office Holidays ({customHolidays.length})
                </Button>
              </div>
              {/* Calendar layers (mobile / tablet; desktop uses the sidebar) */}
              <div className="border-t border-border pt-3 xl:hidden">
                <LayerToggles layers={layerVisible} onToggle={handleToggleLayer} />
              </div>
            </div>
          )}

          {/* Active view (scrolls inside the card on desktop) */}
          <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          {view === "month" && <MonthGrid cells={calendarCells} eventsFor={eventsFor} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
          {view === "week" && <WeekView days={weekDays} eventsFor={eventsFor} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
          {view === "day" && (
            <DayView date={currentDate} events={eventsFor(currentDate)} onOpen={() => handleDayClick(currentDate)} onEventClick={handleEventClick} />
          )}
          {view === "list" && <ListView days={monthDays} eventsFor={eventsFor} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
          </div>
        </section>

        {/* Right panel */}
        <div className="grid min-w-0 gap-4 md:grid-cols-3 lg:h-full lg:grid-cols-1 lg:content-start lg:overflow-y-auto lg:pr-0.5">
          <MiniCalendar
            cells={calendarCells}
            title={`${MONTHS[month]} ${year}`}
            eventsFor={eventsFor}
            onPrev={() => setCurrentDate(new Date(year, month - 1, 1))}
            onNext={() => setCurrentDate(new Date(year, month + 1, 1))}
            onPick={(d) => {
              setCurrentDate(d);
              handleDayClick(d);
            }}
          />
          <TodayPanel date={new Date()} events={eventsFor(new Date())} onOpen={() => handleDayClick(new Date())} onEventClick={handleEventClick} />
          <LegendPanel layers={layerVisible} onToggleLayer={handleToggleLayer} />
        </div>
      </div>

      <TaskDetailModal
        task={detailTask}
        open={!!detailTask}
        onOpenChange={(o) => !o && setDetailTask(null)}
        assignedProfile={profiles.find((p) => p.id === detailTask?.assigned_to) ?? null}
        profiles={profiles}
        onEditTask={(t) => {
          setDetailTask(null);
          setTimeout(() => setEditTask(t), 150);
        }}
        onTaskUpdated={load}
      />

      {user && (
        <TaskFormDialog
          open={!!editTask}
          onOpenChange={(o) => !o && setEditTask(null)}
          initial={editTask}
          userId={user.id}
          onSaved={() => {
            setEditTask(null);
            load();
          }}
        />
      )}

      {/* Sheet showing tasks & leaves for a specific date */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto bg-card border-border">
          <SheetHeader className="border-b border-border pb-4">
            <SheetTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
              <CalendarIcon className="h-5 w-5 text-primary" />
              {selectedDate && selectedDate.toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {selectedDateTasks.length} task{selectedDateTasks.length === 1 ? "" : "s"} and {selectedDateLeaveSummary} for this date.
            </SheetDescription>
          </SheetHeader>

          {/* Team Availability Section */}
          <div className="py-3.5 border-b border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Palmtree className="h-4 w-4 text-primary" />
                Team Availability
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingLeave(null);
                  setLeaveDialogOpen(true);
                }}
                className="h-6 text-[11px] text-primary px-2 hover:bg-primary/10 cursor-pointer"
              >
                + Request Leave / WFH
              </Button>
            </div>

            {selectedDateLeaves.length > 0 ? (
              <div className="space-y-2">
                {selectedDateLeaves.map((l) => {
                  const empName = l.user_name || profiles.find((p) => p.id === l.user_id)?.display_name || "Member";
                  const dotClass = leaveDot[l.leave_type] || leaveDot.casual;
                  const canEditOrCancel = isManager || l.user_id === user?.id;

                  return (
                    <div
                      key={l.id}
                      className="p-3 rounded-xl border border-border bg-card/90 hover:bg-muted/30 text-xs flex items-start justify-between gap-3 shadow-xs transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />
                          <span className="font-semibold text-xs text-foreground truncate">{empName}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-muted text-muted-foreground border border-border/80 font-semibold uppercase tracking-wider">
                            {l.leave_type === "wfh" ? "WFH" : l.leave_type.replace("_", " ")}
                          </span>
                        </div>
                        {l.reason ? (
                          <p className="text-[11px] text-muted-foreground pl-4 leading-relaxed">{l.reason}</p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground/60 italic pl-4">No reason specified</p>
                        )}
                        {l.handover_note && (
                          <p className="text-[10px] text-muted-foreground/80 italic pl-4">Handover: {l.handover_note}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-medium text-muted-foreground px-2 py-0.5 rounded-md bg-muted/60 border border-border">
                          {l.days_count}d
                        </span>

                        {/* Edit Button for leave creator or manager/admin */}
                        {(l.user_id === user?.id || isManager) && (
                          <button
                            type="button"
                            title="Edit leave details"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLeave(l);

                              setLeaveDialogOpen(true);
                            }}
                            className="h-5 px-1.5 rounded bg-background/80 hover:bg-primary/20 hover:text-primary text-foreground text-[10px] flex items-center gap-0.5 border border-border cursor-pointer transition-colors"
                          >
                            <Pencil className="h-2.5 w-2.5" /> Edit
                          </button>
                        )}


                        {l.status === "pending" && isManager && (
                          <div className="flex items-center gap-1 ml-0.5">
                            <button
                              type="button"
                              title="Approve leave"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApproveLeave(l.id);
                              }}
                              className="h-5 px-1.5 rounded bg-status-completed/20 hover:bg-status-completed/30 text-status-completed text-[10px] font-semibold flex items-center gap-0.5 border border-status-completed/40 cursor-pointer transition-colors"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button
                              type="button"
                              title="Reject leave"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRejectLeave(l.id);
                              }}
                              className="h-5 px-1.5 rounded bg-status-blocked/20 hover:bg-status-blocked/30 text-status-blocked text-[10px] font-semibold flex items-center gap-0.5 border border-status-blocked/40 cursor-pointer transition-colors"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        )}

                        {canEditOrCancel && l.status === "approved" && (
                          <button
                            type="button"
                            title="Cancel leave"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelLeave(l.id);
                            }}
                            className="h-5 px-1.5 rounded bg-muted/80 hover:bg-destructive/20 hover:text-destructive text-muted-foreground text-[10px] flex items-center gap-0.5 border border-border cursor-pointer transition-colors"
                          >
                            <Trash2 className="h-3 w-3" /> Cancel
                          </button>
                        )}

                        {isManager && l.status === "rejected" && (
                          <button
                            type="button"
                            title="Re-approve leave"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproveLeave(l.id);
                            }}
                            className="h-5 px-1.5 rounded bg-status-completed/20 hover:bg-status-completed/30 text-status-completed text-[10px] font-semibold flex items-center gap-0.5 border border-status-completed/40 cursor-pointer transition-colors"
                          >
                            <Check className="h-3 w-3" /> Re-approve
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground bg-muted/20 p-2.5 rounded-md border border-border flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-status-completed" />
                All team members active on this day.
              </div>
            )}
          </div>


          {/* Create Task Button */}
          <div className="py-3 border-b border-border">
            <Button
              className="w-full text-xs gap-1.5 h-9"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add Task for this date
            </Button>
          </div>

          {/* List of Tasks */}
          <div className="py-4 space-y-3.5">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span>Scheduled Tasks ({selectedDateTasks.length})</span>
            </div>
            {selectedDateTasks.length > 0 ? (
              selectedDateTasks.map((t) => (
                <div key={t.id} className="relative">
                  <TaskCard
                    task={t}
                    assignee={profiles.find((p) => p.id === t.assigned_to)}
                    profiles={profiles}
                    userId={user?.id || ""}
                    canManage={isManager}
                    onChanged={load}
                    compact
                  />
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic text-center py-6">
                No tasks scheduled for this day.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Task Creation Dialog */}
      {selectedDate && (
        <TaskFormDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          initial={{
            due_date: toLocalISO(selectedDate),
            priority: "Medium",
            status: "To Do",
            custom_fields: {}
          }}
          userId={user?.id || ""}
          onSaved={() => {
            load();
            setCreateDialogOpen(false);
          }}
        />
      )}

      {/* Leave & WFH Creation Dialog */}
      <LeaveDialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          setLeaveDialogOpen(open);
          if (!open) setEditingLeave(null);
        }}
        initialDate={selectedDate}
        leaveToEdit={editingLeave}
        onSuccess={load}
      />

      {/* Office Holiday Schedule Sheet */}
      <Sheet open={holidaysSheetOpen} onOpenChange={setHolidaysSheetOpen}>
        <SheetContent className="w-[90vw] sm:max-w-xl p-6 bg-card border-l border-border space-y-4 overflow-y-auto">
          <SheetHeader className="border-b border-border pb-3">
            <SheetTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Building2 className="w-4.5 h-4.5" />
              </div>
              Office Holiday Schedule ({customHolidays.length})
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground leading-normal">
              Schedule of office closure dates. The office remains closed on these dates, task start dates skip these days, and SLA due dates deduct these days.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3 pt-2">
            {customHolidays.length > 0 ? (
              <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50 text-xs shadow-sm">
                <div className="grid grid-cols-12 bg-muted/40 px-3.5 py-2 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border/40">
                  <div className="col-span-4">Date</div>
                  <div className="col-span-3">Day</div>
                  <div className="col-span-5">Holiday Name</div>
                </div>
                <div className="divide-y divide-border/40">
                  {customHolidays.map((h) => {
                    let dayName = "";
                    const dateStr = getHolidayDateStr(h).slice(0, 10);
                    let formatted = dateStr;
                    try {
                      const [y, m, d] = dateStr.split("-").map(Number);
                      const dt = new Date(y, m - 1, d);
                      dayName = dt.toLocaleDateString("en-US", { weekday: "short" });
                      formatted = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    } catch (e) {}

                    return (
                      <div key={h.id} className="grid grid-cols-12 items-center px-3.5 py-2.5 hover:bg-accent/20 transition-colors">
                        <div className="col-span-4 font-mono font-medium text-foreground flex items-center gap-1.5">
                          <CalendarIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span>{formatted}</span>
                        </div>
                        <div className="col-span-3 text-muted-foreground font-medium">{dayName}</div>
                        <div className="col-span-5 font-semibold text-foreground flex items-center justify-between gap-1.5">
                          <span className="truncate">{h.label}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                            Office Closed
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center space-y-2 border border-dashed border-border rounded-xl bg-muted/10 p-6">
                <div className="w-10 h-10 rounded-full bg-muted/60 mx-auto flex items-center justify-center text-muted-foreground">
                  <Palmtree className="w-5 h-5 text-indigo-400" />
                </div>
                <p className="text-xs font-semibold text-foreground">No office holidays configured.</p>
                <p className="text-[11px] text-muted-foreground">Admins can configure official holidays in Settings ➔ Operations.</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

