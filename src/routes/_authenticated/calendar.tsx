import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { LeaveDialog } from "@/components/LeaveDialog";
import { leavesService } from "@/services/leaves";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskCard } from "@/components/TaskCard";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Calendar as CalendarIcon, User, Filter, Palmtree, Home, Check, X, Trash2, Pencil } from "lucide-react";
import type { Profile, Task, Leave } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getLocalHoliday, fetchIndianHolidays, toLocalISO, type Holiday } from "@/lib/format";
import { statusColor, leaveColor, leaveDot, priorityDot } from "@/lib/colors";




export const Route = createFileRoute("/_authenticated/calendar")({

  component: CalendarPage,
});

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

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Selection & Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<Leave | null>(null);

  
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
  const [myTasksOnly, setMyTasksOnly] = useState(!isManager);

  // Sync default filter whenever auth role resolves
  useEffect(() => {
    setMyTasksOnly(!isManager);
  }, [isManager]);

  const load = useCallback(async () => {
    const [{ data: t }, { data: p }, l] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
      leavesService.getLeaves().catch(() => [] as Leave[]),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
    setLeaves(l || []);
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

    return cells;
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
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      const cur = new Date(start);
      while (cur <= end) {
        const dStr = toLocalISO(cur);
        if (!map[dStr]) map[dStr] = [];
        map[dStr].push(l);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [leaves]);

  // Get tasks and leaves for selected date
  const selectedDateStr = selectedDate ? toLocalISO(selectedDate) : "";
  const selectedDateTasks = useMemo(() => {
    return tasksByDate[selectedDateStr] || [];
  }, [selectedDateStr, tasksByDate]);

  const selectedDateLeaves = useMemo(() => {
    return leavesByDate[selectedDateStr] || [];
  }, [selectedDateStr, leavesByDate]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Calendar Header with Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b sm:border-b border-border pb-0 sm:pb-4">
        <div className="hidden sm:block">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">Manage schedule, tasks, leaves, and team availability.</p>
        </div>
        
        {/* Navigation Controls (Sticky on mobile below AppShell header) */}
        <div className="sticky top-12 sm:relative sm:top-auto z-20 bg-background/95 backdrop-blur py-2 sm:py-0 border-b sm:border-b-0 border-border flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto px-4 -mx-4 sm:px-0 sm:mx-0">
          <Button variant="outline" size="sm" onClick={handleToday} className="text-xs">
            Today
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8 cursor-pointer" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            {/* Custom Month-Year Popover Picker */}
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="h-8 text-xs font-semibold px-2 flex items-center gap-1 hover:bg-accent/50 cursor-pointer">
                  {MONTHS[month]} {year} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-3 bg-card border border-border rounded-xl shadow-lg z-50">
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

            <Button variant="outline" size="icon" className="h-8 w-8 cursor-pointer" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Filter panel */}
      <div className="flex flex-wrap items-center gap-3 bg-muted/20 p-3.5 rounded-xl border border-border">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider mr-2">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-32 text-xs bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
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
          <SelectTrigger className="h-8 w-32 text-xs bg-background"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Priority</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs bg-background"><SelectValue placeholder="Assignee" /></SelectTrigger>
          <SelectContent>
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
      </div>

      {/* Grid Layout of Calendar */}
      <div className="border border-border rounded-2xl overflow-hidden shadow-sm bg-card">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 bg-muted/40 border-b border-border text-center py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {WEEKDAYS.map((day, idx) => (
            <div key={day}>
              <span className="hidden sm:inline">{day}</span>
              <span className="inline sm:hidden">{WEEKDAYS_SHORT[idx]}</span>
            </div>
          ))}
        </div>

        {/* Day Cells */}
        <div className="grid grid-cols-7 divide-x divide-y divide-border border-t border-border">
          {calendarCells.map(({ date, isCurrentMonth }, idx) => {
            const dateStr = toLocalISO(date);
            const dayTasks = tasksByDate[dateStr] || [];
            const dayLeaves = leavesByDate[dateStr] || [];
            const isToday = toLocalISO(new Date()) === dateStr;
            const holiday = getLocalHoliday(date, apiHolidays);

            return (
              <div
                key={idx}
                onClick={() => {
                  setSelectedDate(date);
                  setSheetOpen(true);
                }}
                className={cn(
                  "min-h-[68px] sm:min-h-[115px] p-1.5 sm:p-2 flex flex-col justify-between transition-colors hover:bg-accent/40 cursor-pointer select-none group relative",
                  !isCurrentMonth && "bg-muted/10 text-muted-foreground/40",
                  isToday && "bg-primary/5 ring-1 ring-primary/30",
                  holiday && holiday.isHoliday && "bg-amber-500/5 hover:bg-amber-500/10"
                )}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[10px] sm:text-xs font-semibold h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center transition-all",
                      isToday && "bg-primary text-primary-foreground font-bold shadow-xs"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  
                  <div className="flex items-center gap-1">
                    {dayLeaves.length > 0 && (
                      <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.2 rounded-md border border-border/40 flex items-center gap-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-status-review/80 shrink-0" />
                        {dayLeaves.length} away
                      </span>
                    )}
                    {dayTasks.length > 0 && (
                      <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.2 rounded-md border border-border/40 group-hover:border-border transition-colors">
                        {dayTasks.length}
                      </span>
                    )}
                  </div>
                </div>

                {holiday && (
                  <div className="absolute bottom-1 right-1 sm:right-1.5 flex items-center gap-0.5 text-[8px] sm:text-[9px] font-medium text-status-hold bg-status-hold/10 border border-status-hold/25 px-1 py-0.5 rounded shadow-xs max-w-[90%] truncate">
                    <span>{holiday.emoji}</span>
                    <span className="hidden sm:inline truncate">{holiday.name}</span>
                  </div>
                )}

                {/* Leaves & Tasks Preview List */}
                <div className="mt-1 flex-1 flex flex-col justify-end space-y-1">
                  {/* Desktop Preview: Badges */}
                  <div className="hidden sm:block space-y-1">
                    {/* Leaves & WFH pills */}
                    {dayLeaves.slice(0, 2).map((l) => {
                      const empName = l.user_name || profiles.find((p) => p.id === l.user_id)?.display_name || "Member";
                      const dotClass = leaveDot[l.leave_type] || leaveDot.casual;
                      return (
                        <div
                          key={l.id}
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-medium truncate border border-border/80 bg-card hover:bg-muted/60 text-foreground flex items-center gap-1.5 shadow-xs transition-colors"
                          title={`${empName}: ${l.leave_type} (${l.reason})`}
                        >
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass)} />
                          <span className="truncate text-foreground font-normal">{empName.split(" ")[0]}</span>
                          <span className="text-[9px] text-muted-foreground/80 ml-auto uppercase font-semibold">
                            {l.leave_type === "wfh" ? "WFH" : "Leave"}
                          </span>
                        </div>
                      );
                    })}
                    {dayLeaves.length > 2 && (
                      <div className="text-[9px] font-medium text-muted-foreground pl-1">
                        +{dayLeaves.length - 2} more away
                      </div>
                    )}


                    {/* Tasks items */}
                    {dayTasks.slice(0, 2).map((task) => (
                      <div
                        key={task.id}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium truncate border shadow-xs",
                          statusColor[task.status] || "bg-muted/50 text-foreground/80 border-border"
                        )}
                      >
                        {task.task_name}
                      </div>
                    ))}
                    {dayTasks.length > 2 && (
                      <div className="text-[9px] font-medium text-muted-foreground pl-1.5 pt-0.5">
                        + {dayTasks.length - 2} more tasks
                      </div>
                    )}
                  </div>

                  {/* Mobile Preview: Clean Status Dot Indicators */}
                  <div className="flex sm:hidden flex-wrap gap-1 justify-center mt-1">
                    {dayLeaves.map((l) => (
                      <span
                        key={l.id}
                        className={cn("h-1.5 w-1.5 rounded-full shadow-xs", leaveDot[l.leave_type] || leaveDot.casual)}
                        title={l.user_name || "Member"}
                      />
                    ))}
                    {dayTasks.slice(0, 3).map((task) => (
                      <span
                        key={task.id}
                        className={cn("h-1.5 w-1.5 rounded-full shadow-xs", priorityDot[task.priority] || "bg-muted-foreground")}
                        title={task.task_name}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sheet showing tasks & leaves for a specific date */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto bg-card border-border">
          <SheetHeader className="border-b border-border pb-4">
            <SheetTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
              <CalendarIcon className="h-5 w-5 text-primary" />
              {selectedDate && selectedDate.toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {selectedDateTasks.length} tasks and {selectedDateLeaves.length} leave/WFH records for this date.
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
    </div>
  );

}

