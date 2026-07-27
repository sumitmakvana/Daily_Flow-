import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskCard } from "@/components/TaskCard";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Calendar as CalendarIcon, User, Filter } from "lucide-react";
import type { Profile, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getLocalHoliday, fetchIndianHolidays, toLocalISO, type Holiday } from "@/lib/format";

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
  const [currentDate, setCurrentDate] = useState(new Date());
  const [apiHolidays, setApiHolidays] = useState<Record<string, Holiday>>({});

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Selection & Form states
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
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
  const [myTasksOnly, setMyTasksOnly] = useState(false);

  const load = useCallback(async () => {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
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

  // Get tasks for selected date
  const selectedDateStr = selectedDate ? toLocalISO(selectedDate) : "";
  const selectedDateTasks = useMemo(() => {
    return tasksByDate[selectedDateStr] || [];
  }, [selectedDateStr, tasksByDate]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Calendar Header with Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b sm:border-b border-border pb-0 sm:pb-4">
        <div className="hidden sm:block">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">Manage and track your schedule and tasks dynamically.</p>
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
                  "min-h-[64px] sm:min-h-[110px] p-1.5 sm:p-2 flex flex-col justify-between transition-colors hover:bg-accent/40 cursor-pointer select-none group relative",
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
                      isToday && "bg-primary text-primary-foreground font-bold shadow-sm"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  
                  {dayTasks.length > 0 && (
                    <span className="text-[9px] sm:text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      {dayTasks.length}
                    </span>
                  )}
                </div>

                {holiday && (
                  <div className="absolute bottom-1 right-1 sm:right-1.5 flex items-center gap-0.5 text-[8px] sm:text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1 py-0.5 rounded shadow-sm max-w-[90%] truncate">
                    <span>{holiday.emoji}</span>
                    <span className="hidden sm:inline truncate">{holiday.name}</span>
                  </div>
                )}

                {/* Tasks Preview List */}
                <div className="mt-1 flex-1 flex flex-col justify-end">
                  {/* Desktop Preview: Text Labels */}
                  <div className="hidden sm:block space-y-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium truncate border shadow-sm",
                          task.status === "Completed" ? "bg-green-500/5 text-green-600 border-green-500/20" :
                          task.status === "Blocked" ? "bg-red-500/5 text-red-600 border-red-500/20" :
                          task.status === "In Progress" ? "bg-blue-500/5 text-blue-600 border-blue-500/20" :
                          "bg-muted/50 text-foreground/80 border-border"
                        )}
                      >
                        {task.task_name}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-[9px] font-semibold text-muted-foreground pl-1.5 pt-0.5">
                        + {dayTasks.length - 3} more
                      </div>
                    )}
                  </div>

                  {/* Mobile Preview: Clean Status Dot Indicators */}
                  <div className="flex sm:hidden flex-wrap gap-1 justify-center mt-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <span
                        key={task.id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shadow-sm",
                          task.status === "Completed" ? "bg-green-500" :
                          task.status === "Blocked" ? "bg-red-500" :
                          task.status === "In Progress" ? "bg-blue-500" :
                          "bg-muted-foreground/60"
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sheet showing tasks for a specific date */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto">
          <SheetHeader className="border-b border-border pb-4">
            <SheetTitle className="text-lg font-bold flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-primary" />
              {selectedDate && selectedDate.toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {selectedDateTasks.length} tasks scheduled for this date.
            </SheetDescription>
          </SheetHeader>

          {/* Create Task Button */}
          <div className="py-4 border-b border-border">
            <Button
              className="w-full text-xs gap-1.5 h-9"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add Task for this date
            </Button>
          </div>

          {/* List of Tasks */}
          <div className="py-4 space-y-3.5">
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
              <p className="text-sm text-muted-foreground italic text-center py-8">
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
    </div>
  );
}
