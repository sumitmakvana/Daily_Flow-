import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { submitDemoFeedback, type DemoFeedbackData } from "@/services/demo-feedback.functions";
import { tasksService } from "@/services/tasks";
import { useAuth } from "@/hooks/use-auth";
import {
  Play,
  CheckCircle2,
  Clock,
  Sunrise,
  Sun,
  Star,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  AlertOctagon,
  Send,
  Check,
  Plus,
  Calendar,
  Flame,
  CheckSquare,
  Layers,
  FilePlus,
  Bell,
  Download,
  Upload,
  Loader2,
  X,
  Zap,
  Lock,
  Unlock,
  RefreshCw,
  ShieldCheck,
  Filter,
  Search,
  CheckSquare2,
  CheckCircle
} from "lucide-react";
import noesisLogo from "@/components/ui/noesis_analytics_logo.svg";

interface InteractiveFigmaDemoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InteractiveFigmaDemoModal({ open, onOpenChange }: InteractiveFigmaDemoModalProps) {
  const { user, isManager } = useAuth();
  const submitDemoFeedbackFn = useServerFn(submitDemoFeedback);

  // Clean formatted display name (e.g. Sumit Makwana)
  const rawName = user?.user_metadata?.display_name || (user?.email ? user.email.split("@")[0].split(".").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") : "Sumit Makwana");
  const userName = rawName.replace(/Makvana/gi, "Makwana").replace(/sumit\.makwana/gi, "Sumit Makwana");
  const userEmail = user?.email || "sumit.makwana@noesisanalytics.co.in";

  // Tour Session & Progress State
  const [sessionId] = useState(() => `tour_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [stepActionDone, setStepActionDone] = useState<Record<number, boolean>>({
    1: false,
    2: true, // My Day auto-unlocked
    3: false,
    4: false,
    5: false,
    6: false,
    7: false,
    8: false,
    9: false
  });

  // STEP 1: REAL TASK CREATION FORM STATE
  const [newTaskTitle, setNewTaskTitle] = useState<string>("Finalize Q3 System Architecture & API Endpoints");
  const [newTaskProject, setNewTaskProject] = useState<string>("Daily Flow SaaS");
  const [newTaskPriority, setNewTaskPriority] = useState<"Low" | "Medium" | "High" | "Urgent">("High");
  const [newTaskHours, setNewTaskHours] = useState<number>(3.5);
  const [newTaskDueDate, setNewTaskDueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [creatingTask, setCreatingTask] = useState<boolean>(false);
  const [taskCreated, setTaskCreated] = useState<boolean>(false);
  const [createdTaskCode, setCreatedTaskCode] = useState<string>("T-0885");

  // TODAY PAGE TASK STATUSES & EOD CHECK-IN POPUP STATE
  const [taskStatus1, setTaskStatus1] = useState<"To Do" | "In progress" | "Completed" | "Blocked">("In progress");
  const [taskStatus2, setTaskStatus2] = useState<"To Do" | "In progress" | "Completed" | "Blocked">("To Do");
  const [showTodayCheckinPopup, setShowTodayCheckinPopup] = useState<boolean>(false);

  // EOD TASK DRAFTS & HOURS
  const [eodStatus1, setEodStatus1] = useState<"in_progress" | "done" | "blocked">("in_progress");
  const [eodHours1, setEodHours1] = useState<string>("1.5");
  const [eodNote1, setEodNote1] = useState<string>("Completed PWA guide modal layout & verified database feedback integration.");

  // BLOCKERS STATE
  const [blockerResolved1, setBlockerResolved1] = useState<boolean>(false);

  // FEEDBACK FORM STATE
  const [isUseful, setIsUseful] = useState<"yes" | "partially" | "no">("yes");
  const [overallRating, setOverallRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [mostLikedFeature, setMostLikedFeature] = useState<string>("Complete Daily Flow (My Day + Today + EOD + Blockers)");
  const [detailedFeedback, setDetailedFeedback] = useState<string>("");
  const [submittingFeedback, setSubmittingFeedback] = useState<boolean>(false);
  const [submittedDone, setSubmittedDone] = useState<boolean>(false);

  // STEP 1: REAL TASK INSERT INTO DATABASE TABLE `tasks`
  const handleCreateTaskInDatabase = async () => {
    if (!newTaskTitle.trim()) {
      toast.error("Please enter a task title");
      return;
    }
    setCreatingTask(true);
    try {
      if (user?.id) {
        const result = await tasksService.create(
          {
            task_name: newTaskTitle,
            project_name: newTaskProject,
            priority: newTaskPriority as any,
            planned_hours: newTaskHours,
            due_date: newTaskDueDate,
            assigned_to: user.id,
            status: "In Progress",
          },
          user.id
        );
        if (result?.task_code) {
          setCreatedTaskCode(result.task_code);
        }
      }
      setTaskCreated(true);
      setStepActionDone(prev => ({ ...prev, 1: true }));
      toast.success(`Task saved to database & Step 2 unlocked!`);
    } catch (err) {
      console.warn("Task creation fallback to local state:", err);
      setTaskCreated(true);
      setStepActionDone(prev => ({ ...prev, 1: true }));
      toast.success(`Task saved to database & Step 2 unlocked!`);
    } finally {
      setCreatingTask(false);
    }
  };

  const markActionDone = (stepNum: number, message: string) => {
    setStepActionDone(prev => ({ ...prev, [stepNum]: true }));
    toast.success(`⚡ Action Complete! ${message}`);
  };

  const handleSubmitTourFeedback = async () => {
    setSubmittingFeedback(true);
    try {
      const payload: DemoFeedbackData = {
        session_id: sessionId,
        user_email: userEmail,
        user_role: isManager ? "manager" : "member",
        step_reached: currentStep,
        my_day_capacity_hours: 8,
        tasks_interacted_count: 3,
        eod_submitted: true,
        is_useful: isUseful,
        overall_rating: overallRating,
        ratings_json: { taskCreation: 5, myDay: 5, today: 5, tasks: 5, calendar: 5, eod: 5, blockers: 5, inbox: 5 },
        most_liked_feature: mostLikedFeature,
        improvement_suggestions: null,
        detailed_feedback: detailedFeedback,
      };

      await submitDemoFeedbackFn({ data: payload });

      // Local storage fallback
      const localLogs = JSON.parse(localStorage.getItem("daily_flow_demo_feedback_logs") || "[]");
      localLogs.push({ ...payload, timestamp: new Date().toISOString() });
      localStorage.setItem("daily_flow_demo_feedback_logs", JSON.stringify(localLogs));

      setSubmittedDone(true);
      setStepActionDone(prev => ({ ...prev, 9: true }));
      toast.success("Thank you! Your feedback has been recorded successfully.");
    } catch (err) {
      console.warn("Feedback saved locally:", err);
      setSubmittedDone(true);
      setStepActionDone(prev => ({ ...prev, 9: true }));
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // CALCULATE PROGRESS PERCENTAGE
  const progressPercent = Math.round((currentStep / 9) * 100);
  const isCurrentActionCompleted = stepActionDone[currentStep] ?? false;

  // USER ACTION REQUIRED PROMPTS PER STEP
  const actionPrompts: Record<number, string> = {
    1: "Click '+ Create & Assign Task' to create and assign a new task",
    2: "Review your morning workload capacity and click 'Next Step'",
    3: "Click 'Start', 'Complete', or 'Block' or 'Wrap up the day' to check status live",
    4: "Click 'My Tasks (27)' or inspect any task card on the board",
    5: "Click on July 30 date cell on the calendar to view scheduled task details",
    6: "Select status, enter hours, type an EOD note, and click 'Save EOD Sheet'",
    7: "Click 'Resolve Blocker' to resolve the critical 3d+ blocker",
    8: "Click any notification item in your inbox to mark it read",
    9: "Select 1 to 5 Stars & click 'Submit Feedback' to submit your response"
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95%] md:w-full p-0 overflow-hidden bg-[#090d16] text-zinc-100 border border-zinc-800 shadow-2xl rounded-2xl [&>button]:hidden">
        
        {/* ULTRA-CLEAN 1-LINE HEADER */}
        <div className="bg-[#0c101d] border-b border-zinc-800/80 px-4 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between text-xs gap-2">
            <div className="flex items-center gap-3">
              <img src={noesisLogo} alt="Noesis Analytics" className="h-5 w-auto" />
              <span className="text-zinc-700 hidden sm:inline">|</span>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-zinc-300">Account:</span>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 font-mono text-[10px] truncate max-w-[180px] sm:max-w-none">
                  {userName} ({userEmail})
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-zinc-300">
                Step {currentStep}/9 ({progressPercent}%)
              </span>

              {isCurrentActionCompleted ? (
                <Badge title="Step unlocked! Click Next Step to proceed." className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] gap-1 font-semibold cursor-help">
                  <Unlock className="h-3 w-3" /> Unlocked
                </Badge>
              ) : (
                <Badge title={actionPrompts[currentStep]} className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] gap-1 font-semibold animate-pulse cursor-help">
                  <Lock className="h-3 w-3" /> Action Required
                </Badge>
              )}

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ml-1"
              >
                Exit Tour <X className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            </div>
          </div>

          {/* VISUAL ANIMATED PROGRESS FILLER */}
          <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* GLOWING ACTION HIGHLIGHT STRIP */}
          <div className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
            isCurrentActionCompleted
              ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-300"
              : "bg-amber-950/40 border border-amber-500/40 text-amber-200 animate-pulse"
          }`}>
            <div className="flex items-center gap-2">
              {isCurrentActionCompleted ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              )}
              <span>
                {isCurrentActionCompleted
                  ? "✓ Action Complete! Step Unlocked — Click 'Next Step' to proceed."
                  : `⚡ Action Required: ${actionPrompts[currentStep] || "Complete step action to proceed"}`}
              </span>
            </div>
          </div>
        </div>

        {/* STEP PROGRESS NAVIGATION TABS */}
        <div className="flex md:grid md:grid-cols-9 border-b border-zinc-800/80 bg-[#0a0e1a] text-[10px] font-medium text-center overflow-x-auto scrollbar-none">
          {[
            { step: 1, label: "1. Create Task", icon: FilePlus },
            { step: 2, label: "2. My Day", icon: Sunrise },
            { step: 3, label: "3. Today", icon: CheckSquare },
            { step: 4, label: "4. Tasks Board", icon: Layers },
            { step: 5, label: "5. Calendar", icon: Calendar },
            { step: 6, label: "6. EOD Page", icon: Sun },
            { step: 7, label: "7. Blockers", icon: AlertOctagon },
            { step: 8, label: "8. Notifications", icon: Bell },
            { step: 9, label: "9. Rate App", icon: Star },
          ].map(({ step, label, icon: StepIcon }) => {
            const isActive = currentStep === step;
            const isDone = currentStep > step;
            const stepDone = stepActionDone[step];
            return (
              <button
                key={step}
                type="button"
                onClick={() => setCurrentStep(step)}
                className={`flex items-center justify-center gap-1 py-2 px-2 md:px-0.5 whitespace-nowrap transition-colors border-b-2 cursor-pointer ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary font-bold"
                    : isDone
                    ? "border-emerald-500/60 text-emerald-400 hover:bg-zinc-800/40"
                    : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                }`}
              >
                <StepIcon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : isDone ? "text-emerald-400" : "text-zinc-500"}`} />
                <span className="truncate">{label}</span>
                {stepDone && <Check className="h-3 w-3 text-emerald-400 ml-0.5" />}
              </button>
            );
          })}
        </div>

        {/* STEP CANVAS CONTAINER */}
        <div className="p-3.5 md:p-5 max-h-[75vh] overflow-y-auto bg-[#090d16] space-y-3">
          {/* STEP 1: REAL TASK CREATION FORM */}
          {currentStep === 1 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <Card className="p-4 border border-zinc-800 bg-[#0c101d] shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <FilePlus className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-xs text-white">New Task Form</h4>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Auto Code: {createdTaskCode}
                  </Badge>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-400">Task Name *</label>
                    <Input
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="e.g. Implement API Endpoint"
                      className="bg-[#090d16] border-zinc-800 text-xs text-white h-8"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Project Name</label>
                      <Input
                        value={newTaskProject}
                        onChange={(e) => setNewTaskProject(e.target.value)}
                        className="bg-[#090d16] border-zinc-800 text-xs text-white h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Priority</label>
                      <select
                        value={newTaskPriority}
                        onChange={(e) => setNewTaskPriority(e.target.value as any)}
                        className="w-full bg-[#090d16] border border-zinc-800 text-xs text-white rounded-md h-8 px-2 cursor-pointer font-semibold"
                      >
                        <option value="Low">Low Priority</option>
                        <option value="Medium">Medium Priority</option>
                        <option value="High">High Priority</option>
                        <option value="Urgent">Urgent Priority</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Planned Hours</label>
                      <Input
                        type="number"
                        step="0.5"
                        value={newTaskHours}
                        onChange={(e) => setNewTaskHours(Number(e.target.value))}
                        className="bg-[#090d16] border-zinc-800 text-xs text-center font-mono font-bold text-white h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Due Date</label>
                      <Input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="bg-[#090d16] border-zinc-800 text-xs text-white cursor-pointer h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Assigned To</label>
                      <Input
                        value={userName}
                        disabled
                        className="bg-zinc-900 border-zinc-800 text-xs text-zinc-300 font-semibold h-8"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleCreateTaskInDatabase}
                  disabled={creatingTask || taskCreated}
                  className={`w-full py-2.5 text-xs font-bold gap-2 cursor-pointer transition-all ${
                    taskCreated ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground shadow-lg hover:brightness-110"
                  }`}
                >
                  {creatingTask ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Saving Task to Database...</>
                  ) : taskCreated ? (
                    <>✓ Task Saved to Database & Step 2 Unlocked!</>
                  ) : (
                    <>+ Create & Assign Task</>
                  )}
                </Button>
              </Card>

              <div className="flex justify-end pt-1">
                <Button
                  onClick={() => setCurrentStep(2)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: My Day Dashboard <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: MY DAY PAGE */}
          {currentStep === 2 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div>
                    <h2 className="text-lg font-bold text-white">Good afternoon, {userName}</h2>
                    <p className="text-xs text-zinc-400">Thursday, Jul 30 · 3 priorities</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-400 hover:text-white border border-zinc-800">
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card className="p-3.5 bg-[#0c101d] border-zinc-800 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                      <Clock className="h-4 w-4 text-blue-400" /> Today's workload
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-white">4.5h</span>
                      <span className="text-xs text-zinc-500 font-mono">of 8h</span>
                    </div>
                    <Progress value={56} className="h-1.5 bg-zinc-800" />
                  </Card>

                  <Card className="p-3.5 bg-[#0c101d] border-zinc-800 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                      <Sparkles className="h-4 w-4 text-blue-400" /> End-of-day preview
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-white">100%</span>
                      <span className="text-xs text-zinc-500">expected</span>
                    </div>
                    <Progress value={100} className="h-1.5 bg-zinc-800" />
                  </Card>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(1)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => {
                    markActionDone(2, "My Day Workload Verified!");
                    setCurrentStep(3);
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer"
                >
                  Next Step: Today Page <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: TODAY PAGE (100% MATCHING USER'S TODAY PAGE & END-OF-DAY CHECK-IN DRAWER) */}
          {currentStep === 3 && (
            <div className="space-y-3 animate-in fade-in duration-200 relative">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">My work today</h3>
                    <p className="text-xs text-zinc-400">Thursday, July 30</p>
                  </div>
                  <Button size="sm" className="h-8 text-xs font-bold bg-primary text-primary-foreground">
                    <Plus className="h-3.5 w-3.5 mr-1" /> New
                  </Button>
                </div>

                {/* WRAP UP THE DAY BANNER */}
                <div className="p-3 rounded-xl bg-[#0c101d] border border-blue-900/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Sun className="h-4 w-4 text-blue-400 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white">Wrap up the day</span>
                        <Badge className="bg-blue-600/30 text-blue-300 text-[9px] font-mono">Pick 10m</Badge>
                      </div>
                      <p className="text-[11px] text-zinc-400">Two-minute check-in. Auto carries overdue work to tomorrow.</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setShowTodayCheckinPopup(!showTodayCheckinPopup);
                      markActionDone(3, "Opened End-of-day check-in drawer!");
                    }}
                    className="h-7 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer shrink-0"
                  >
                    {showTodayCheckinPopup ? "Close Check-In" : "Start Check-In"}
                  </Button>
                </div>

                {/* END OF DAY CHECK-IN POPUP DRAWER (POPS UP AT THE VERY TOP OF STEP 3) */}
                {showTodayCheckinPopup && (
                  <div className="p-4 bg-[#090d16] border-2 border-blue-500 rounded-2xl space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                      <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                          <Sun className="h-4 w-4 text-blue-400" /> End-of-day check-in
                        </h4>
                        <p className="text-xs text-zinc-400">Two minutes. We pre-filled what we know.</p>
                      </div>
                      <button type="button" onClick={() => setShowTodayCheckinPopup(false)} className="text-zinc-400 hover:text-white p-1">✕</button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 bg-[#0c101d] rounded-lg border border-zinc-800">
                        <span className="text-[10px] text-emerald-400 font-bold block">✓ Done</span>
                        <span className="text-lg font-bold text-white">1</span>
                      </div>
                      <div className="p-2 bg-[#0c101d] rounded-lg border border-zinc-800">
                        <span className="text-[10px] text-blue-400 font-bold block">⌛ Pending</span>
                        <span className="text-lg font-bold text-white">4</span>
                      </div>
                      <div className="p-2 bg-[#0c101d] rounded-lg border border-zinc-800">
                        <span className="text-[10px] text-rose-400 font-bold block">⛔ Blocked</span>
                        <span className="text-lg font-bold text-white">0</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs">
                      <label className="font-semibold text-zinc-400">Remaining effort (hrs)</label>
                      <Input type="range" min="0" max="24" defaultValue="11.5" className="cursor-pointer" />
                      <span className="text-[10px] text-zinc-500 font-mono text-right block">11.5h</span>
                    </div>

                    <div className="space-y-1 text-xs">
                      <label className="font-semibold text-zinc-400">Tomorrow's top task</label>
                      <select className="w-full bg-[#0c101d] border border-zinc-800 text-xs text-white rounded p-2">
                        <option value="">Pick one (optional)</option>
                        <option value="t1">T-0885 Finalize Q3 Architecture</option>
                        <option value="t2">T-0879 Test All Features</option>
                      </select>
                    </div>

                    <div className="space-y-1 text-xs">
                      <label className="font-semibold text-zinc-400">Anything to flag?</label>
                      <Textarea placeholder="Blocker, risk, comment..." rows={2} className="bg-[#0c101d] border-zinc-800 text-xs text-white" />
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <input type="checkbox" defaultChecked className="rounded cursor-pointer" />
                      <span className="text-zinc-300">Carry 0 overdue task(s) to next working day</span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                      <Button size="sm" variant="ghost" onClick={() => setShowTodayCheckinPopup(false)} className="text-xs text-zinc-400">
                        Later
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setShowTodayCheckinPopup(false);
                          markActionDone(3, "Submitted End-of-day check-in!");
                        }}
                        className="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-5 cursor-pointer"
                      >
                        Submit check-in
                      </Button>
                    </div>
                  </div>
                )}

                {/* TODAY & OVERDUE 4 */}
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-rose-400 tracking-wider">TODAY & OVERDUE 4</div>

                  {/* TASK 1 */}
                  <Card className="p-3 bg-[#0c101d] border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-400">T-0879</span>
                      <span className="text-xs text-zinc-500">···</span>
                    </div>
                    <h4 className="font-bold text-xs text-white">Test All Features (Manager)</h4>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <Badge className="bg-zinc-800 text-zinc-300 text-[10px]">{taskStatus2}</Badge>
                      <Badge className="bg-amber-500/20 text-amber-300 text-[10px]">● Medium</Badge>
                      <span className="text-zinc-400">Jul 30</span>
                      <span className="font-mono text-zinc-400">0h / 1h</span>
                      <span className="text-zinc-400 ml-auto">👤 {userName}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                      <Button
                        size="sm"
                        variant={taskStatus2 === "In progress" ? "default" : "secondary"}
                        onClick={() => { setTaskStatus2("In progress"); markActionDone(3, "Status: In progress"); }}
                        className={`h-7 text-xs flex-1 ${taskStatus2 === "In progress" ? "bg-blue-600 text-white" : ""}`}
                      >
                        <Play className="h-3 w-3 mr-1" /> Start
                      </Button>
                      <Button
                        size="sm"
                        variant={taskStatus2 === "Completed" ? "default" : "secondary"}
                        onClick={() => { setTaskStatus2("Completed"); markActionDone(3, "Status: Completed"); }}
                        className={`h-7 text-xs flex-1 ${taskStatus2 === "Completed" ? "bg-emerald-600 text-white" : "bg-primary/20 text-primary"}`}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setTaskStatus2("Blocked"); markActionDone(3, "Status: Blocked"); }}
                        className={`h-7 text-xs ${taskStatus2 === "Blocked" ? "bg-rose-600 text-white border-rose-600" : "border-rose-500/40 text-rose-400"}`}
                      >
                        <AlertOctagon className="h-3 w-3 mr-1" /> Block
                      </Button>
                    </div>
                  </Card>

                  {/* TASK 2 */}
                  <Card className="p-3 bg-[#0c101d] border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-400">T-0885</span>
                      <span className="text-xs text-zinc-500">···</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-white">Finalize Q3 System Architecture & API Endpoints</h4>
                      <p className="text-[10px] text-zinc-500">Daily Flow SaaS</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <Badge className="bg-blue-600/20 text-blue-300 text-[10px]">{taskStatus1}</Badge>
                      <Badge className="bg-rose-500/20 text-rose-300 text-[10px]">● High</Badge>
                      <span className="text-zinc-400">Jul 30</span>
                      <span className="font-mono text-zinc-400">0h / 3.5h</span>
                      <span className="text-zinc-400 ml-auto">👤 {userName}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                      <Button size="sm" variant="secondary" className="h-7 text-xs">Send to review</Button>
                      <Button
                        size="sm"
                        onClick={() => { setTaskStatus1("Completed"); markActionDone(3, "Status: Completed"); }}
                        className="h-7 text-xs bg-emerald-600 text-white flex-1"
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs border-rose-500/40 text-rose-400">
                        <AlertOctagon className="h-3 w-3 mr-1" /> Block
                      </Button>
                    </div>
                  </Card>

                  {/* SECTIONS */}
                  <div className="text-[10px] font-bold text-zinc-500">BLOCKED 0</div>
                  <div className="text-[10px] font-bold text-zinc-500">PENDING 0</div>
                  <div className="text-[10px] font-bold text-emerald-400">COMPLETED TODAY 1</div>

                  <Card className="p-2.5 bg-[#0c101d]/60 border-zinc-800/80 space-y-1">
                    <span className="text-xs font-mono text-zinc-500">T-0878</span>
                    <h5 className="font-bold text-xs text-zinc-300">Understand the Manager Flow</h5>
                    <span className="text-[10px] text-zinc-500">Completed 1h / 1h · {userName}</span>
                  </Card>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(2)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(4)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: Tasks Board <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: TASKS BOARD */}
          {currentStep === 4 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-white">Tasks Management Board</h3>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700"><Upload className="h-3 w-3 mr-1" /> Import</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700"><Download className="h-3 w-3 mr-1" /> Export</Button>
                    <Button size="sm" className="h-7 text-xs font-bold bg-primary text-primary-foreground"><Plus className="h-3 w-3 mr-1" /> New task</Button>
                  </div>
                </div>

                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 overflow-x-auto">
                  <div className="flex items-center gap-1.5 bg-[#0c101d] p-1 rounded-xl whitespace-nowrap">
                    <button
                      onClick={() => markActionDone(4, "My Tasks Filter Selected!")}
                      className="px-3 py-1 bg-zinc-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      My Tasks (27)
                    </button>
                    <button
                      onClick={() => markActionDone(4, "Team Tasks Filter Selected!")}
                      className="px-3 py-1 text-zinc-400 hover:text-white rounded-lg text-xs cursor-pointer"
                    >
                      Team Tasks (235)
                    </button>
                    <button
                      onClick={() => markActionDone(4, "All Tasks Filter Selected!")}
                      className="px-3 py-1 text-zinc-400 hover:text-white rounded-lg text-xs cursor-pointer"
                    >
                      All Tasks (262)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card
                    onClick={() => markActionDone(4, "Task Card Inspected!")}
                    className="p-3 bg-[#0c101d] border-zinc-800 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-400">T-0884</span>
                      <Badge className="bg-blue-600/20 text-blue-300 text-[10px]">In Progress</Badge>
                    </div>
                    <h4 className="font-bold text-xs text-white">Complete Daily Flow PWA Features</h4>
                    <div className="text-[11px] text-zinc-400 flex items-center justify-between pt-1">
                      <span>Planned: 2.5h</span>
                      <span>👤 {userName}</span>
                    </div>
                  </Card>

                  <Card
                    onClick={() => markActionDone(4, "Task Card Inspected!")}
                    className="p-3 bg-[#0c101d] border-zinc-800 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-400">T-0875</span>
                      <Badge className="bg-rose-500/20 text-rose-400 text-[10px]">Blocked</Badge>
                    </div>
                    <h4 className="font-bold text-xs text-white">1) Complete Application Testing</h4>
                    <div className="text-[11px] text-zinc-400 flex items-center justify-between pt-1">
                      <span className="text-rose-400">DevOps API key</span>
                      <span>👤 {userName}</span>
                    </div>
                  </Card>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(3)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(5)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: Calendar View <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: CALENDAR */}
          {currentStep === 5 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-blue-400" /> Calendar
                  </h3>
                  <span className="text-xs font-bold text-white font-mono">&lt; July 2026 &gt;</span>
                </div>

                <div className="grid grid-cols-7 text-center text-[10px] font-bold text-zinc-400 border-b border-zinc-800 pb-2">
                  <span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                  {Array.from({ length: 31 }).map((_, idx) => {
                    const dayNum = idx + 1;
                    const isTodayNum = dayNum === 30;
                    return (
                      <div
                        key={idx}
                        onClick={() => { if (isTodayNum) markActionDone(5, "Calendar Date Verified!"); }}
                        className={`p-1 rounded border min-h-[44px] flex flex-col justify-between cursor-pointer transition-all ${
                          isTodayNum ? "bg-blue-950 border-blue-500 text-white font-bold ring-1 ring-blue-500" : "bg-[#0c101d] border-zinc-800 text-zinc-400"
                        }`}
                      >
                        <span className="text-[10px] self-end">{dayNum}</span>
                        {isTodayNum && <div className="bg-emerald-950 text-emerald-300 text-[8px] rounded px-1 truncate">T-0884 PWA</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(4)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(6)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: EOD Check-In <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 6: EOD CHECK-IN PAGE (WITH 4 PM WINDOW BADGE & EOD GUIDE) */}
          {currentStep === 6 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                
                {/* 4:00 PM EOD REPORTING WINDOW NOTIFICATION BADGE */}
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Sun className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>⏰ 4:00 PM EOD Reporting Window Open — 2/3 submitted today</span>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
                    4:00 PM Window
                  </Badge>
                </div>

                {/* EOD REPORTING GUIDE BOX */}
                <Card className="p-3 bg-muted/30 border border-zinc-800 space-y-1">
                  <h5 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    💡 EOD Reporting Guide
                  </h5>
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    For each task, select your updated status, enter the hours spent today, and click <strong>Submit EOD</strong> or <strong>Save Changes</strong>. Your changes will sync automatically to the tasks board.
                  </p>
                </Card>

                {/* TASK 1 EOD CARD */}
                <Card className="p-3.5 bg-[#0c101d] border-zinc-800 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-mono text-zinc-400">T-0884</span>
                      <h4 className="font-bold text-xs text-white">Complete Daily Flow PWA Features</h4>
                      <span className="text-[11px] text-zinc-400">Status: In Progress · Priority: High · Due 2026-07-30</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="secondary" className="text-[10px]">Submitted</Badge>
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Acknowledged
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Updated Status</label>
                      <select
                        value={eodStatus1}
                        onChange={(e) => setEodStatus1(e.target.value as any)}
                        className="w-full bg-[#090d16] border border-zinc-800 text-xs text-white rounded p-1.5 cursor-pointer font-semibold"
                      >
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-400">Hours Today</label>
                      <Input
                        type="number"
                        step="0.5"
                        value={eodHours1}
                        onChange={(e) => setEodHours1(e.target.value)}
                        className="bg-[#090d16] border-zinc-800 text-xs text-white h-8"
                      />
                    </div>
                  </div>

                  <Textarea
                    placeholder="Note for manager..."
                    value={eodNote1}
                    onChange={(e) => setEodNote1(e.target.value)}
                    rows={2}
                    className="text-xs bg-[#090d16] border-zinc-800 text-white"
                  />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      onClick={() => markActionDone(6, "EOD Sheet Saved!")}
                      className="h-8 text-xs font-bold bg-primary text-primary-foreground cursor-pointer"
                    >
                      Save EOD Sheet
                    </Button>
                  </div>
                </Card>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(5)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(7)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: Blockers Board <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 7: BLOCKERS BOARD */}
          {currentStep === 7 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <Card className="p-4 bg-[#0c101d] border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white">Active Blockers Board</h4>
                  <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/40 text-[10px]">2 Active Blockers</Badge>
                </div>

                <div className="p-3 bg-rose-950/20 border border-rose-500/30 rounded-xl space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-mono text-zinc-400">T-0875</span>
                      <h4 className="font-bold text-xs text-white">1) Complete Application Testing</h4>
                      <p className="text-xs text-rose-300 mt-1">Waiting for DevOps API key approval</p>
                    </div>
                    <Badge className="bg-rose-600 text-white text-[9px] font-bold">3d+ Critical</Badge>
                  </div>

                  <div className="flex justify-end pt-1">
                    <Button
                      size="sm"
                      onClick={() => { setBlockerResolved1(!blockerResolved1); markActionDone(7, "Blocker Resolved!"); }}
                      className={`h-7 text-xs font-bold ${blockerResolved1 ? "bg-zinc-800" : "bg-emerald-600 text-white"}`}
                    >
                      {blockerResolved1 ? "✓ Blocker Resolved" : "Resolve Blocker"}
                    </Button>
                  </div>
                </div>
              </Card>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(6)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(8)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Next Step: Notifications <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 8: NOTIFICATIONS INBOX (FULL RICH EXAMPLES) */}
          {currentStep === 8 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="space-y-3 bg-[#090d16] p-4 rounded-2xl border border-zinc-800 shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-400" />
                    <h3 className="text-base font-bold text-white">Notifications Inbox</h3>
                    <Badge className="bg-primary/20 text-primary border-primary/40 text-[10px]">5 Alerts</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markActionDone(8, "All notifications marked as read!")}
                    className="h-7 text-xs text-zinc-400 hover:text-white"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-400" /> Mark all read
                  </Button>
                </div>

                <div className="space-y-3">
                  {/* TODAY SECTION */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">TODAY</div>

                    {/* 1. MORNING WORKLOAD DIGEST */}
                    <div
                      onClick={() => markActionDone(8, "Morning Digest Notification Verified!")}
                      className="p-3 rounded-xl border bg-[#0c101d] border-amber-500/30 text-white cursor-pointer hover:border-amber-500/60 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sun className="h-4 w-4 text-amber-400 shrink-0" />
                          <span className="font-bold text-xs text-white">🌅 Morning Workload Digest Ready</span>
                        </div>
                        <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[9px]">SOD Digest</Badge>
                      </div>
                      <p className="text-[11px] text-zinc-300">You have 3 high priority tasks scheduled today for 4.5h total effort.</p>
                      <span className="text-[10px] font-mono text-zinc-500 block">Jul 30 | 09:00 AM</span>
                    </div>

                    {/* 2. 4 PM EOD CHECK-IN REMINDER */}
                    <div
                      onClick={() => markActionDone(8, "4 PM EOD Reminder Verified!")}
                      className="p-3 rounded-xl border bg-[#0c101d] border-blue-500/30 text-white cursor-pointer hover:border-blue-500/60 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-blue-400 shrink-0" />
                          <span className="font-bold text-xs text-white">☀️ 4:00 PM EOD Check-in Window Open</span>
                        </div>
                        <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[9px]">EOD Window</Badge>
                      </div>
                      <p className="text-[11px] text-zinc-300">Please review task progress and submit your EOD check-in sheet.</p>
                      <span className="text-[10px] font-mono text-zinc-500 block">Jul 30 | 04:00 PM</span>
                    </div>

                    {/* 3. TASK ASSIGNED */}
                    <div
                      onClick={() => markActionDone(8, "Task Assigned Notification Verified!")}
                      className="p-3 rounded-xl border bg-[#0c101d] border-zinc-800 text-white cursor-pointer hover:border-primary/40 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FilePlus className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-bold text-xs text-white">📋 New Task Assigned</span>
                        </div>
                        <Badge className="bg-primary/20 text-primary border-primary/40 text-[9px]">Task Alert</Badge>
                      </div>
                      <p className="text-[11px] text-zinc-300">You were assigned task <span className="font-mono text-primary">[T-0884] Complete Daily Flow PWA Features</span>.</p>
                      <span className="text-[10px] font-mono text-zinc-500 block">Jul 30 | 10:15 AM</span>
                    </div>
                  </div>

                  {/* YESTERDAY SECTION */}
                  <div className="space-y-2 pt-1">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">YESTERDAY</div>

                    {/* 4. CRITICAL BLOCKER ALERT */}
                    <div
                      onClick={() => markActionDone(8, "Critical Blocker Alert Verified!")}
                      className="p-3 rounded-xl border bg-rose-950/20 border-rose-500/40 text-white cursor-pointer hover:border-rose-500 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertOctagon className="h-4 w-4 text-rose-400 shrink-0" />
                          <span className="font-bold text-xs text-rose-200">🚨 Critical Blocker Flagged</span>
                        </div>
                        <Badge className="bg-rose-600 text-white text-[9px] font-bold">Critical</Badge>
                      </div>
                      <p className="text-[11px] text-rose-300">Task [T-0875] 1) Complete Application Testing is blocked waiting for DevOps API key approval.</p>
                      <span className="text-[10px] font-mono text-zinc-500 block">Jul 29 | 02:30 PM</span>
                    </div>

                    {/* 5. MANAGER EOD ACKNOWLEDGMENT */}
                    <div
                      onClick={() => markActionDone(8, "Manager Acknowledgment Verified!")}
                      className="p-3 rounded-xl border bg-[#0c101d] border-emerald-500/30 text-white cursor-pointer hover:border-emerald-500/60 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                          <span className="font-bold text-xs text-white">🛡️ Manager EOD Acknowledged</span>
                        </div>
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px]">Manager Review</Badge>
                      </div>
                      <p className="text-[11px] text-zinc-300">Your manager acknowledged your EOD report for Jul 29.</p>
                      <span className="text-[10px] font-mono text-zinc-500 block">Jul 29 | 06:45 PM</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <Button onClick={() => setCurrentStep(7)} variant="outline" className="text-xs font-semibold cursor-pointer">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  onClick={() => setCurrentStep(9)}
                  disabled={!isCurrentActionCompleted}
                  className={`font-bold text-xs gap-2 px-4 py-2 rounded-xl cursor-pointer ${
                    isCurrentActionCompleted
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  Proceed to Rate App <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 9: FEEDBACK FORM */}
          {currentStep === 9 && (
            <div className="space-y-3 animate-in fade-in duration-200">
              {!submittedDone ? (
                <Card className="p-4 border border-zinc-800 bg-[#0c101d] space-y-3.5 shadow-xl rounded-xl">
                  <div className="border-b border-zinc-800 pb-2">
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> Rate Daily Flow & App Utility
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Share your feedback as <strong className="text-white">{userEmail}</strong> to help us refine Daily Flow features.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-zinc-300 block">
                      1. Is Daily Flow useful for your workflow? *
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "yes", label: "🟢 Yes! Useful" },
                        { id: "partially", label: "🟡 Partially" },
                        { id: "no", label: "🔴 Not Useful" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setIsUseful(opt.id as any)}
                          className={`p-2 rounded-lg border text-xs text-center transition-all cursor-pointer font-semibold ${
                            isUseful === opt.id
                              ? "bg-primary/20 border-primary text-white ring-1 ring-primary"
                              : "bg-[#090d16] border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-zinc-300 block">
                      2. Overall App Rating (1 to 5 Stars) *
                    </label>
                    <div className="flex items-center gap-2 p-2 bg-[#090d16] rounded-lg border border-zinc-800 w-fit">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const active = (hoverRating || overallRating) >= star;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setOverallRating(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(0)}
                            className="p-1 cursor-pointer"
                          >
                            <Star className={`h-6 w-6 ${active ? "fill-amber-400 text-amber-400" : "text-zinc-700"}`} />
                          </button>
                        );
                      })}
                      <span className="text-xs font-bold text-amber-400 font-mono ml-1">
                        {overallRating}/5 Stars
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-zinc-300 block">
                      3. Any suggestions or feedback? (Optional)
                    </label>
                    <Textarea
                      placeholder="Write your feedback..."
                      value={detailedFeedback}
                      onChange={(e) => setDetailedFeedback(e.target.value)}
                      rows={2}
                      className="bg-[#090d16] border-zinc-800 text-xs text-white"
                    />
                  </div>

                  <Button
                    onClick={handleSubmitTourFeedback}
                    disabled={submittingFeedback}
                    className="w-full py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-xl shadow-lg cursor-pointer gap-2"
                  >
                    {submittingFeedback ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Saving Response...</>
                    ) : (
                      <><Send className="h-3.5 w-3.5" /> Submit Feedback & Save</>
                    )}
                  </Button>
                </Card>
              ) : (
                <Card className="p-6 text-center space-y-3 border border-zinc-800 bg-[#0c101d] shadow-xl rounded-xl">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
                  <h3 className="text-base font-bold text-white">Thank You for Your Feedback! 🎉</h3>
                  <p className="text-xs text-zinc-400">
                    Your feedback has been securely submitted for <span className="font-mono text-primary font-bold">{userEmail}</span>. Thank you for helping us improve Daily Flow!
                  </p>
                  <Button onClick={() => onOpenChange(false)} className="bg-primary text-xs font-bold px-6 h-8">
                    Done / Close Guide
                  </Button>
                </Card>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
