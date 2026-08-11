import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";
import { tasksService } from "@/services/tasks";
import { 
  Upload, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  AlertCircle, 
  Eye, 
  Users, 
  FileSpreadsheet, 
  Settings, 
  Loader2 
} from "lucide-react";
import * as XLSX from "xlsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const DB_FIELDS = [
  { key: "task_name", label: "Task Name", required: true, keywords: ["task", "plan", "what i'll work on", "morning plan", "name", "summary", "todo", "title"] },
  { key: "assigned_to", label: "Assignee / Employee", required: false, keywords: ["employee", "assignee", "user", "member", "assigned", "name"] },
  { key: "client", label: "Client", required: false, keywords: ["client"] },
  { key: "project_name", label: "Project Name", required: false, keywords: ["project", "proj"] },
  { key: "status", label: "Status", required: false, keywords: ["status", "done", "state"] },
  { key: "remarks", label: "Remarks", required: false, keywords: ["remarks", "comment", "note"] },
  { key: "due_date", label: "Due Date / Date", required: false, keywords: ["due", "date"] },
  { key: "task_code", label: "Task Code", required: false, keywords: ["code", "id", "ticket"] },
  { key: "priority", label: "Priority", required: false, keywords: ["priority", "level"] },
  { key: "reviewer", label: "Reviewer", required: false, keywords: ["reviewer"] },
  { key: "planned_hours", label: "Planned Hours", required: false, keywords: ["hours", "planned", "time", "est"] },
  { key: "sprint_week", label: "Sprint Week", required: false, keywords: ["sprint", "week"] },
];

type Step = "upload" | "mapping" | "users" | "preview";

function parseRawCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, field = "", row: string[] = [], inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const nonBriefCells = row.filter(cell => cell.length > 0);
    if (nonBriefCells.length >= 3) {
      const joined = row.join(" ").toLowerCase();
      if (
        joined.includes("name") ||
        joined.includes("task") ||
        joined.includes("client") ||
        joined.includes("project") ||
        joined.includes("date") ||
        joined.includes("plan")
      ) {
        return i;
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].filter(cell => cell.length > 0).length >= 3) {
      return i;
    }
  }
  return 0;
}

function suggestMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  for (const field of DB_FIELDS) {
    let bestHeader = "";
    let bestScore = 0;

    for (const h of headers) {
      const hNorm = h.toLowerCase().trim();
      if (usedHeaders.has(hNorm)) continue;

      for (const kw of field.keywords) {
        if (hNorm === kw) {
          bestHeader = h;
          bestScore = 100;
          break;
        } else if (hNorm.includes(kw)) {
          const score = kw.length / hNorm.length;
          if (score > bestScore) {
            bestHeader = h;
            bestScore = score;
          }
        }
      }
    }

    if (bestHeader) {
      mapping[field.key] = bestHeader;
      usedHeaders.add(bestHeader.toLowerCase().trim());
    } else {
      mapping[field.key] = "";
    }
  }

  return mapping;
}

function suggestProfileMatch(csvName: string, profiles: Profile[]): string {
  const normCSV = csvName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let bestProfileId = "";
  let bestScore = 0;

  for (const p of profiles) {
    const normDisplayName = p.display_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normCSV === normDisplayName) {
      return p.id;
    }
    if (normCSV.includes(normDisplayName) || normDisplayName.includes(normCSV)) {
      const score = Math.min(normCSV.length, normDisplayName.length) / Math.max(normCSV.length, normDisplayName.length);
      if (score > bestScore) {
        bestProfileId = p.id;
        bestScore = score;
      }
    }
  }
  return bestProfileId;
}

function parseCSVDate(dateStr: string): string | null {
  if (!dateStr) return null;
  dateStr = dateStr.trim();
  
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const monthStr = parts[1].toLowerCase();
    const year = parseInt(parts[2], 10);

    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    let month = -1;
    for (const key of Object.keys(months)) {
      if (monthStr.startsWith(key)) {
        month = months[key];
        break;
      }
    }

    if (!isNaN(day) && month !== -1 && !isNaN(year)) {
      const date = new Date(year, month, day);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function normalizeStatus(val: string): "To Do" | "In Progress" | "In Review" | "Blocked" | "On Hold" | "Completed" {
  const s = val.toLowerCase().trim();
  if (s.includes("done") || s.includes("completed") || s.includes("finish") || s === "☑" || s === "yes" || s === "true" || s === "1") {
    return "Completed";
  }
  if (s.includes("progress") || s.includes("ongoing") || s.includes("doing") || s.includes("work")) {
    return "In Progress";
  }
  if (s.includes("review") || s.includes("test") || s.includes("qa")) {
    return "In Review";
  }
  if (s.includes("block") || s.includes("wait") || s.includes("pending")) {
    return "Blocked";
  }
  if (s.includes("hold") || s.includes("pause")) {
    return "On Hold";
  }
  return "To Do";
}

export function CSVImportDialog({
  open, onOpenChange, profiles, userId, onDone, isManager = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profiles: Profile[];
  userId: string;
  onDone: () => void;
  isManager?: boolean;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [headerIndex, setHeaderIndex] = useState<number>(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [uniqueNames, setUniqueNames] = useState<string[]>([]);
  const [userMapping, setUserMapping] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [existingTasks, setExistingTasks] = useState<any[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update" | "new">("skip");
  
  // Custom states for leaves/assigner/reviewer/tabs/pagination
  const [previewTab, setPreviewTab] = useState<"tasks" | "leaves">("tasks");
  const [defaultCreatedBy, setDefaultCreatedBy] = useState<string>(userId);
  const [defaultReviewer, setDefaultReviewer] = useState<string>("");
  const [tasksPage, setTasksPage] = useState(1);
  const [leavesPage, setLeavesPage] = useState(1);
  const tasksPageSize = 25;
  const leavesPageSize = 25;

  useEffect(() => {
    if (step === "preview") {
      setTasksPage(1);
      setLeavesPage(1);
    }
  }, [step]);

  const renderPagination = (currentPage: number, totalPages: number, onPageChange: (p: number) => void) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between border-t border-border px-4 py-2 bg-muted/40 text-[10px] sm:text-xs shrink-0 select-none">
        <span className="text-muted-foreground font-medium">
          Page <strong className="text-foreground">{currentPage}</strong> of <strong className="text-foreground">{totalPages}</strong>
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="h-6 px-2 text-[10px] cursor-pointer"
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="h-6 px-2 text-[10px] cursor-pointer"
          >
            Next
          </Button>
        </div>
      </div>
    );
  };

  // Load emails once opened to help users map names to actual system user accounts
  useEffect(() => {
    if (open) {
      setStep("upload");
      setFileName("");
      setRawRows([]);
      setColumnMapping({});
      setUniqueNames([]);
      setUserMapping({});
      setDuplicateStrategy("skip");
      setPreviewTab("tasks");
      setDefaultCreatedBy(userId);
      setDefaultReviewer("");
      
      const fetchEmails = async () => {
        const { data } = await supabase.from("profile_emails" as never).select("id,email");
        if (data) {
          const map: Record<string, string> = {};
          for (const row of (data as Array<{ id: string; email: string }>)) {
            map[row.id] = row.email;
          }
          setEmails(map);
        }
      };
      fetchEmails();

      const fetchExistingTasks = async () => {
        const { data } = await supabase.from("tasks").select("id, task_code, task_name, assigned_to, due_date, version");
        if (data) {
          setExistingTasks(data);
        }
      };
      fetchExistingTasks();
    }
  }, [open]);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    
    try {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const parsed = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false, defval: "" });
          
          const cleanedRows = parsed
            .map(row => Array.isArray(row) ? row.map(cell => String(cell ?? "").trim()) : [])
            .filter(row => row.some(cell => cell.length > 0));

          if (cleanedRows.length === 0) {
            toast.error("The file is empty or invalid.");
            return;
          }
          setRawRows(cleanedRows);
          
          // Auto detect headers
          const detected = detectHeaderRow(cleanedRows);
          setHeaderIndex(detected);
          const csvHeaders = cleanedRows[detected] || [];
          setHeaders(csvHeaders);
          
          // Auto suggest mapping
          const mapping = suggestMapping(csvHeaders);
          setColumnMapping(mapping);
          
          setStep("mapping");
        } catch (err) {
          toast.error("Failed to parse file: " + (err as Error).message);
        }
      };
      reader.readAsArrayBuffer(f);
    } catch (err) {
      toast.error("Failed to read file: " + (err as Error).message);
    }
  };

  // When header index changes, we re-parse headers and re-suggest column mappings
  const handleHeaderIndexChange = (index: number) => {
    setHeaderIndex(index);
    const csvHeaders = rawRows[index] || [];
    setHeaders(csvHeaders);
    const mapping = suggestMapping(csvHeaders);
    setColumnMapping(mapping);
  };

  const handleColumnMapChange = (dbKey: string, csvCol: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [dbKey]: csvCol
    }));
  };

  const proceedToUserMapping = () => {
    if (!columnMapping.task_name) {
      toast.error("You must map the required field: Task Name");
      return;
    }

    const assigneeColName = columnMapping.assigned_to;
    if (!assigneeColName) {
      // No assignee column mapped - skip user mapping step
      setStep("preview");
      return;
    }

    // Extract unique assignee names
    const csvHeaders = rawRows[headerIndex] || [];
    const colIdx = csvHeaders.indexOf(assigneeColName);
    if (colIdx === -1) {
      setStep("preview");
      return;
    }

    const names = new Set<string>();
    // Look at data rows after the header
    for (let i = headerIndex + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      // Skip empty or divider rows
      const nonBlank = row.filter(c => c.trim().length > 0);
      if (nonBlank.length < 2) continue;
      
      const firstCell = (row[0] ?? "").trim();
      if (firstCell.startsWith("📅") || (firstCell.includes(",") && firstCell.split(" ").length > 2)) {
        continue;
      }

      const val = (row[colIdx] ?? "").trim();
      if (val && val.length < 50) {
        names.add(val);
      }
    }

    const nameList = Array.from(names).sort();
    setUniqueNames(nameList);

    // Initial suggest mappings
    const suggested: Record<string, string> = {};
    for (const name of nameList) {
      suggested[name] = suggestProfileMatch(name, profiles);
    }
    setUserMapping(suggested);
    setStep("users");
  };

  // Retrieve valid data rows
  const getDataRows = () => {
    return rawRows.slice(headerIndex + 1).filter(row => {
      const nonBlank = row.filter(c => c.trim().length > 0);
      if (nonBlank.length < 2) return false;
      
      const firstCell = (row[0] ?? "").trim();
      if (firstCell.startsWith("📅") || (firstCell.includes(",") && firstCell.split(" ").length > 2)) {
        return false;
      }
      return true;
    });
  };

  const isLeaveValue = (val: string) => {
    const norm = val.toLowerCase().trim();
    return norm === "on leave" || norm === "on-leave" || norm === "leave" || norm === "absent";
  };

  const detectMultipleTasks = (val: string): boolean => {
    if (!val) return false;

    const lines = val.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      // Check for numbered list (1... and 2...)
      const hasOne = lines.some(l => /^(1[\)\.]|\[1\])/.test(l));
      const hasTwo = lines.some(l => /^(2[\)\.]|\[2\])/.test(l));
      if (hasOne && hasTwo) return true;

      // Check for bullet list (at least two lines starting with bullet character)
      const bulletCount = lines.filter(l => /^[-*•☐]\s+/.test(l)).length;
      if (bulletCount >= 2) return true;
    }

    // Check for inline numbered list (e.g., "1) Task A 2) Task B" or "1. Task A 2. Task B")
    if (/(?:^|\s+)1[\)\.]\s+.*?(?:\s+)2[\)\.]\s+/.test(val)) {
      return true;
    }

    return false;
  };

  const splitCellValues = (val: string, taskDelimiter: boolean = false): string[] => {
    if (!val) return [];
    val = val.trim();

    if (taskDelimiter) {
      // For tasks, split only if strict numbering/bullet patterns are matched
      if (detectMultipleTasks(val)) {
        let items: string[] = [];
        if (val.includes("\n")) {
          items = val.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        } else {
          // Split inline numbers "1) ... 2) ... 3) ..."
          items = val.split(/(?:^|\s+)(?=\d+[\)\.]\s+)/).map(p => p.trim()).filter(Boolean);
        }
        // Clean up list markers
        return items.map(p => p.replace(/^(?:\d+[\)\.]|[-*•☐])\s*/, "").trim()).filter(Boolean);
      }
      // Otherwise, return as a single task
      return [val];
    } else {
      // For projects/clients, split by newline or pipe '|' or comma ','
      let parts = val.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 1) {
        if (val.includes("|")) {
          parts = val.split("|").map(p => p.trim()).filter(Boolean);
        } else if (val.includes(",")) {
          parts = val.split(",").map(p => p.trim()).filter(Boolean);
        }
      }
      return parts;
    }
  };

  const getMappedTasksAndLeaves = () => {
    const dataRows = getDataRows();
    const tasks: any[] = [];
    const leaves: any[] = [];

    dataRows.forEach(row => {
      const getValue = (fieldKey: string): string => {
        const colName = columnMapping[fieldKey];
        if (!colName) return "";
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) return "";
        return (row[colIdx] ?? "").trim();
      };

      const rawProjectName = getValue("project_name");
      const projectNames = splitCellValues(rawProjectName, false);

      const rawTaskName = getValue("task_name");
      if (!rawTaskName) {
        return;
      }

      const taskNames = splitCellValues(rawTaskName, true);
      if (taskNames.length === 0) {
        return;
      }

      const rawClient = getValue("client");
      const clients = splitCellValues(rawClient, false);

      const rawAssignee = getValue("assigned_to");
      let assigned_to = rawAssignee ? (userMapping[rawAssignee] || null) : null;

      // Handle leave rows
      if (taskNames.some(tn => isLeaveValue(tn))) {
        leaves.push({
          date: parseCSVDate(getValue("due_date")),
          employeeName: rawAssignee || "Unknown",
          assignedToId: assigned_to,
          type: taskNames.find(tn => isLeaveValue(tn)) || "On Leave"
        });
        return;
      }

      const rawReviewer = getValue("reviewer");
      let reviewer = null;
      if (rawReviewer) {
        if (rawReviewer.includes("@")) {
          const match = profiles.find(p => emails[p.id]?.toLowerCase() === rawReviewer.toLowerCase());
          reviewer = match ? match.id : null;
        } else {
          reviewer = userMapping[rawReviewer] || suggestProfileMatch(rawReviewer, profiles) || null;
        }
      }
      if (!reviewer && defaultReviewer) {
        reviewer = defaultReviewer;
      }

      const statusVal = getValue("status");
      const status = statusVal ? normalizeStatus(statusVal) : "To Do";

      const priorityVal = getValue("priority");
      let priority: "High" | "Medium" | "Low" = "Medium";
      if (priorityVal) {
        const pNorm = priorityVal.toLowerCase();
        if (pNorm.includes("high") || pNorm === "1") priority = "High";
        else if (pNorm.includes("low") || pNorm === "3") priority = "Low";
      }

      taskNames.forEach((taskName, idx) => {
        // Match project by index
        let project_name = null;
        if (taskNames.length === 1) {
          project_name = rawProjectName || null;
        } else if (projectNames.length > 0) {
          project_name = projectNames[idx] || projectNames[projectNames.length - 1];
        }

        // Match client by index
        let client = null;
        if (taskNames.length === 1) {
          client = rawClient || null;
        } else if (clients.length > 0) {
          client = clients[idx] || clients[clients.length - 1];
        }

        tasks.push({
          task_code: getValue("task_code") || undefined,
          task_name: taskName,
          client,
          project_name,
          priority,
          status,
          assigned_to,
          reviewer,
          due_date: parseCSVDate(getValue("due_date")),
          planned_hours: getValue("planned_hours") ? Number(getValue("planned_hours")) : 0,
          sprint_week: getValue("sprint_week") || null,
          remarks: getValue("remarks") || null,
          created_by: defaultCreatedBy || userId,
          updated_by: userId,
        });
      });
    });

    return { tasks, leaves };
  };

  const findDuplicateTask = (task: any) => {
    return existingTasks.find(et => {
      // 1. If both have task_code, compare task_code (case-insensitive)
      if (task.task_code && et.task_code) {
        return task.task_code.trim().toLowerCase() === et.task_code.trim().toLowerCase();
      }
      
      // 2. If no task_code, check for matching task_name, assigned_to, and due_date
      const nameMatch = (task.task_name || "").trim().toLowerCase() === (et.task_name || "").trim().toLowerCase();
      const assigneeMatch = task.assigned_to === et.assigned_to;
      const dateMatch = (task.due_date || null) === (et.due_date || null);
      
      return nameMatch && assigneeMatch && dateMatch;
    });
  };

  const { previewTasks, previewLeaves } = useMemo(() => {
    if (step !== "preview") return { previewTasks: [], previewLeaves: [] };
    const { tasks, leaves } = getMappedTasksAndLeaves();
    return { previewTasks: tasks, previewLeaves: leaves };
  }, [step, rawRows, columnMapping, userMapping, headerIndex, existingTasks, defaultCreatedBy, defaultReviewer]);

  const duplicateCount = useMemo(() => {
    if (step !== "preview") return 0;
    return previewTasks.filter(t => findDuplicateTask(t) !== undefined).length;
  }, [previewTasks, existingTasks]);

  const totalTasksPages = Math.ceil(previewTasks.length / tasksPageSize);
  const paginatedTasks = useMemo(() => {
    return previewTasks.slice((tasksPage - 1) * tasksPageSize, tasksPage * tasksPageSize);
  }, [previewTasks, tasksPage, tasksPageSize]);

  const totalLeavesPages = Math.ceil(previewLeaves.length / leavesPageSize);
  const paginatedLeaves = useMemo(() => {
    return previewLeaves.slice((leavesPage - 1) * leavesPageSize, leavesPage * leavesPageSize);
  }, [previewLeaves, leavesPage, leavesPageSize]);

  const doImport = async () => {
    const { tasks: payload } = getMappedTasksAndLeaves();
    console.log("doImport debug: userId =", userId, "isManager =", isManager);
    console.log("doImport debug: payload =", payload);
    if (!payload.length) return;
    setBusy(true);

    try {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let rejected = 0;

      // Automatically sync all unique project names from CSV into projects master table
      const uniqueProjects = new Map<string, { name: string; client: string | null }>();
      payload.forEach((t) => {
        if (t.project_name?.trim()) {
          const key = t.project_name.trim().toLowerCase();
          if (!uniqueProjects.has(key)) {
            uniqueProjects.set(key, { name: t.project_name.trim(), client: t.client?.trim() || null });
          }
        }
      });

      for (const { name: projName, client: projClient } of uniqueProjects.values()) {
        try {
          const { data: existing } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", projName)
            .maybeSingle();

          if (!existing) {
            await supabase.from("projects").insert({
              name: projName,
              client: projClient,
              status: "active",
              sla_days: 3,
            });
          }
        } catch (e) {
          console.warn("Auto-creation of master project from CSV skipped:", projName, e);
        }
      }

      const promises = payload.map(async (task) => {
        try {
          const duplicateOf = findDuplicateTask(task);
          if (duplicateOf) {
            if (duplicateStrategy === "skip") {
              skipped++;
              return;
            } else if (duplicateStrategy === "update") {
              await tasksService.update(duplicateOf as Task, task as Partial<Task>, userId);
              updated++;
              return;
            } else if (duplicateStrategy === "new") {
              task.task_name = `${task.task_name} (Duplicate)`;
            }
          }
          await tasksService.create(task as any, userId);
          inserted++;
        } catch (err) {
          rejected++;
          console.error("Task import failed for:", task.task_name, err);
        }
      });

      await Promise.all(promises);

      let msg = "Import completed.";
      if (inserted > 0) msg += ` Created ${inserted} new tasks.`;
      if (updated > 0) msg += ` Updated ${updated} tasks.`;
      if (skipped > 0) msg += ` Skipped ${skipped} duplicates.`;
      if (rejected > 0) msg += ` Failed to import ${rejected} tasks.`;

      if (rejected > 0) {
        toast.warning(msg);
      } else {
        toast.success(msg);
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        
        {/* Wizard Header */}
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Tasks from CSV
          </DialogTitle>
          
          {/* Progress Indicators */}
          <div className="flex items-center gap-2 mt-4">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step === "upload" ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${step === "upload" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>1</span>
              Upload
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step === "mapping" ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${step === "mapping" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>2</span>
              Columns
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step === "users" ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${step === "users" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>3</span>
              Users
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step === "preview" ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${step === "preview" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>4</span>
              Preview
            </div>
          </div>
        </DialogHeader>

        {/* Wizard Steps Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          
          {/* Step 1: Upload */}
          {step === "upload" && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3 bg-muted/10 hover:bg-muted/20 transition-all relative">
                <Upload className="h-10 w-10 text-muted-foreground animate-pulse" />
                <div>
                  <p className="text-sm font-medium">Drag & drop your daily tracker CSV file here</p>
                  <p className="text-xs text-muted-foreground mt-1">Accepts CSV and Excel (.xlsx, .xls) formats</p>
                </div>
                <input 
                  type="file" 
                  accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" 
                  onChange={onFileSelected} 
                  className="absolute inset-0 opacity-0 cursor-pointer z-50 w-full h-full"
                />
                <Button size="sm" variant="secondary" className="mt-2 pointer-events-none">
                  Select CSV File
                </Button>
              </div>

              <div className="bg-muted/40 p-4 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  Supports Custom Headers & Formats
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You can upload any CSV or excel-exported sheet. Our system will automatically search for the header row and allow you to map your columns (e.g. <strong>Morning Plan</strong> to <strong>Task Name</strong>, <strong>Employee Name</strong> to <strong>Assignee</strong>).
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === "mapping" && (
            <div className="space-y-4">
              {/* Header Selector */}
              <div className="bg-muted/30 p-3 rounded-lg flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="font-semibold block text-foreground">Select Header Row</span>
                    <span className="text-muted-foreground">Select which row in the CSV contains column labels</span>
                  </div>
                </div>
                <select
                  value={headerIndex}
                  onChange={(e) => handleHeaderIndexChange(Number(e.target.value))}
                  className="bg-background border border-border rounded px-3 py-1.5 font-medium outline-none text-xs focus:ring-1 focus:ring-primary min-w-[200px]"
                >
                  {rawRows.slice(0, 15).map((row, idx) => {
                    const preview = row.slice(0, 3).filter(Boolean).join(", ");
                    return (
                      <option key={idx} value={idx}>
                        Line {idx + 1}: {preview ? `${preview}...` : "(Empty Line)"}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Mapping Form */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold">Database Field</th>
                      <th className="text-left px-3 py-2.5 font-semibold">CSV Column (Header)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {DB_FIELDS.map((field) => (
                      <tr key={field.key} className="hover:bg-muted/10">
                        <td className="px-3 py-2.5 font-medium">
                          {field.label}
                          {field.required && <span className="text-destructive ml-0.5">*</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={columnMapping[field.key] || ""}
                            onChange={(e) => handleColumnMapChange(field.key, e.target.value)}
                            className="w-full bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">(Not Mapped / Empty)</option>
                            {headers.map((h, i) => (
                              <option key={i} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: User Mapping */}
          {step === "users" && (
            <div className="space-y-4">
              <div className="bg-muted/30 p-3.5 rounded-lg flex items-start gap-2.5 text-xs">
                <Users className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <span className="font-semibold block text-foreground">Map Employee Names to System Users</span>
                  <span className="text-muted-foreground leading-relaxed">
                    We found unique names in your CSV's <strong>{columnMapping.assigned_to}</strong> column. Map them to actual registered team profiles.
                  </span>
                </div>
              </div>

              {!isManager && (
                <div className="bg-primary/10 border border-primary/20 text-primary p-3 rounded-lg flex items-start gap-2.5 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Importing Assignments</span>
                    <span>Tasks will be imported and assigned directly to the mapped team profiles.</span>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden max-h-[350px] overflow-y-auto bg-card">
                <table className="w-full table-fixed text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr className="border-b border-border bg-muted">
                      <th className="text-left px-3 py-2.5 font-semibold w-1/2 sticky top-0 bg-muted/95 backdrop-blur-sm">CSV Employee Name</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-1/2 sticky top-0 bg-muted/95 backdrop-blur-sm">System Profile / User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {uniqueNames.map((name) => (
                      <tr key={name} className="hover:bg-muted/10">
                        <td className="px-3 py-2.5 font-medium truncate" title={name}>
                          {name}
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={userMapping[name] || ""}
                            onChange={(e) => setUserMapping(prev => ({ ...prev, [name]: e.target.value }))}
                            className="w-full bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">(Unassigned / Empty)</option>
                            {profiles.map((p) => {
                              const email = emails[p.id] ? ` (${emails[p.id]})` : "";
                              return (
                                <option key={p.id} value={p.id}>
                                  {p.display_name}{email}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4: Preview */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Eye className="h-4 w-4 text-primary" />
                  Ready to import <strong className="text-foreground">{previewTasks.length}</strong> tasks from <span className="font-semibold text-foreground">{fileName}</span>.
                </div>
              </div>

              {/* Duplicate Strategy Option Card UI */}
              <div className="bg-muted/40 p-3.5 rounded-xl border border-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    Duplicate Tasks Strategy
                  </div>
                  {duplicateCount > 0 && (
                    <span className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 px-2 py-0.5 rounded text-[10px] font-semibold">
                      {duplicateCount} duplicates detected
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDuplicateStrategy("skip")}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all text-center flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                      duplicateStrategy === "skip"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold text-foreground">Skip Duplicates</span>
                    <span className="text-[9px] text-muted-foreground leading-none">Skip duplicate rows</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuplicateStrategy("update")}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all text-center flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                      duplicateStrategy === "update"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold text-foreground">Overwrite</span>
                    <span className="text-[9px] text-muted-foreground leading-none">Update existing tasks</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuplicateStrategy("new")}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all text-center flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                      duplicateStrategy === "new"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold text-foreground">Import All</span>
                    <span className="text-[9px] text-muted-foreground leading-none">Create new duplicate tasks</span>
                  </button>
                </div>
              </div>

              {!isManager && (
                <div className="bg-primary/10 border border-primary/20 text-primary p-3 rounded-lg flex items-start gap-2.5 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Preview Assignment</span>
                    <span>Tasks will be imported and assigned directly to the mapped team profiles.</span>
                  </div>
                </div>
              )}

              {/* Import settings: Default Assigner and Default Reviewer */}
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-3.5 rounded-xl border border-border">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Default Assigner (Created By)</label>
                  <select
                    value={defaultCreatedBy}
                    onChange={(e) => setDefaultCreatedBy(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2.5 py-1.5 outline-none text-xs focus:ring-1 focus:ring-primary focus:border-primary"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Default Reviewer</label>
                  <select
                    value={defaultReviewer}
                    onChange={(e) => setDefaultReviewer(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2.5 py-1.5 outline-none text-xs focus:ring-1 focus:ring-primary focus:border-primary"
                  >
                    <option value="">(None)</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tabs selector */}
              <div className="flex gap-2 border-b border-border pb-1">
                <button
                  type="button"
                  onClick={() => setPreviewTab("tasks")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    previewTab === "tasks"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  Tasks to Import ({previewTasks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("leaves")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    previewTab === "leaves"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  Leaves / Absent ({previewLeaves.length})
                </button>
              </div>

              {previewTab === "tasks" ? (
                <div className="border border-border rounded-lg overflow-hidden bg-card flex flex-col">
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full table-fixed text-[11px]">
                      <thead className="bg-muted sticky top-0 z-10">
                        <tr className="border-b border-border bg-muted">
                          <th className="text-left px-2 py-2 font-semibold w-[25%] sticky top-0 bg-muted/95 backdrop-blur-sm">Task Name</th>
                          <th className="text-left px-2 py-2 font-semibold w-[15%] sticky top-0 bg-muted/95 backdrop-blur-sm">Assignee</th>
                          <th className="text-left px-2 py-2 font-semibold w-[15%] sticky top-0 bg-muted/95 backdrop-blur-sm">Assigned By</th>
                          <th className="text-left px-2 py-2 font-semibold w-[12%] sticky top-0 bg-muted/95 backdrop-blur-sm">Client</th>
                          <th className="text-left px-2 py-2 font-semibold w-[13%] sticky top-0 bg-muted/95 backdrop-blur-sm">Project</th>
                          <th className="text-left px-2 py-2 font-semibold w-[10%] sticky top-0 bg-muted/95 backdrop-blur-sm">Status</th>
                          <th className="text-left px-2 py-2 font-semibold w-[10%] sticky top-0 bg-muted/95 backdrop-blur-sm">Due Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {paginatedTasks.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground font-medium bg-muted/5">
                              No tasks found to import.
                            </td>
                          </tr>
                        ) : (
                          paginatedTasks.map((task, idx) => {
                            const assigneeProfile = profiles.find(p => p.id === task.assigned_to);
                            const assignerProfile = profiles.find(p => p.id === task.created_by);
                            const duplicateOf = findDuplicateTask(task);
                            return (
                              <tr key={idx} className={`hover:bg-muted/5 ${duplicateOf ? "bg-yellow-500/5" : ""}`}>
                                <td className="px-2 py-2 font-medium truncate" title={task.task_name}>
                                  <div className="flex items-center gap-1.5">
                                    {duplicateOf && (
                                      <span className="shrink-0 bg-yellow-500/15 text-yellow-700 dark:text-yellow-500 px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider">
                                        Dup
                                      </span>
                                    )}
                                    <span className="truncate">{task.task_name}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-muted-foreground truncate">
                                  {assigneeProfile?.display_name || "—"}
                                </td>
                                <td className="px-2 py-2 text-muted-foreground truncate">
                                  {assignerProfile?.display_name || "—"}
                                </td>
                                <td className="px-2 py-2 text-muted-foreground truncate">
                                  {task.client || "—"}
                                </td>
                                 <td className="px-2 py-2 text-muted-foreground truncate">
                                   <div className="flex items-center gap-1.5">
                                     <span className="truncate">{task.project_name || "—"}</span>
                                     {task.project_name?.includes("|") && (
                                       <TooltipProvider delayDuration={100}>
                                         <Tooltip>
                                           <TooltipTrigger asChild>
                                             <span className="shrink-0 text-amber-500 cursor-help select-none font-bold text-xs">
                                               ⚠️
                                             </span>
                                           </TooltipTrigger>
                                           <TooltipContent className="bg-amber-600 text-white border-none text-[10px] font-semibold py-1 px-2 rounded-md shadow-md">
                                             Split Needed
                                           </TooltipContent>
                                         </Tooltip>
                                       </TooltipProvider>
                                     )}
                                   </div>
                                 </td>
                                <td className="px-2 py-2">
                                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    task.status === "Completed" ? "bg-green-500/10 text-green-600" :
                                    task.status === "In Progress" ? "bg-blue-500/10 text-blue-600" :
                                    "bg-muted text-muted-foreground"
                                  }`}>
                                    {task.status}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-muted-foreground">
                                  {task.due_date || "—"}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {renderPagination(tasksPage, totalTasksPages, setTasksPage)}
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden bg-card flex flex-col">
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full table-fixed text-[11px]">
                      <thead className="bg-muted sticky top-0 z-10">
                        <tr className="border-b border-border bg-muted">
                          <th className="text-left px-2 py-2 font-semibold w-[40%] sticky top-0 bg-muted/95 backdrop-blur-sm">Employee Name</th>
                          <th className="text-left px-2 py-2 font-semibold w-[30%] sticky top-0 bg-muted/95 backdrop-blur-sm">Date</th>
                          <th className="text-left px-2 py-2 font-semibold w-[30%] sticky top-0 bg-muted/95 backdrop-blur-sm">Plan / Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {paginatedLeaves.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="text-center py-8 text-muted-foreground font-medium bg-muted/5">
                              No leave records found in this sheet.
                            </td>
                          </tr>
                        ) : (
                          paginatedLeaves.map((leave, idx) => {
                            const assigneeProfile = profiles.find(p => p.id === leave.assignedToId);
                            return (
                              <tr key={idx} className="hover:bg-muted/5">
                                <td className="px-2 py-2 font-medium truncate" title={leave.employeeName}>
                                  {assigneeProfile?.display_name || leave.employeeName}
                                </td>
                                <td className="px-2 py-2 text-muted-foreground">
                                  {leave.date || "—"}
                                </td>
                                <td className="px-2 py-2 text-destructive font-semibold">
                                  {leave.type}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {renderPagination(leavesPage, totalLeavesPages, setLeavesPage)}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Wizard Footer */}
        <DialogFooter className="pt-4 border-t border-border flex items-center justify-between w-full">
          <div>
            {step !== "upload" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === "mapping") setStep("upload");
                  else if (step === "users") setStep("mapping");
                  else if (step === "preview") {
                    if (columnMapping.assigned_to) setStep("users");
                    else setStep("mapping");
                  }
                }}
                disabled={busy}
                className="gap-1 text-xs"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </Button>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="text-xs"
            >
              Cancel
            </Button>
            
            {step === "mapping" && (
              <Button
                size="sm"
                onClick={proceedToUserMapping}
                className="gap-1 text-xs"
              >
                Next <ArrowRight className="h-3 w-3" />
              </Button>
            )}

            {step === "users" && (
              <Button
                size="sm"
                onClick={() => setStep("preview")}
                className="gap-1 text-xs"
              >
                Next <ArrowRight className="h-3 w-3" />
              </Button>
            )}

            {step === "preview" && (
              <Button
                size="sm"
                onClick={doImport}
                disabled={busy}
                className="gap-1 text-xs"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" /> Import {previewTasks.length} Tasks
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
