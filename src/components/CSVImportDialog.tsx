import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile } from "@/lib/types";
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
      return d.toISOString().split("T")[0];
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

  // Load emails once opened to help users map names to actual system user accounts
  useEffect(() => {
    if (open) {
      setStep("upload");
      setFileName("");
      setRawRows([]);
      setColumnMapping({});
      setUniqueNames([]);
      setUserMapping({});
      
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
    }
  }, [open]);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    
    try {
      const text = await f.text();
      const parsed = parseRawCSV(text);
      if (parsed.length === 0) {
        toast.error("The CSV file is empty.");
        return;
      }
      setRawRows(parsed);
      
      // Auto detect headers
      const detected = detectHeaderRow(parsed);
      setHeaderIndex(detected);
      const csvHeaders = parsed[detected] || [];
      setHeaders(csvHeaders);
      
      // Auto suggest mapping
      const mapping = suggestMapping(csvHeaders);
      setColumnMapping(mapping);
      
      setStep("mapping");
    } catch (err) {
      toast.error("Failed to parse CSV file: " + (err as Error).message);
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

  const getMappedTasks = () => {
    const dataRows = getDataRows();
    return dataRows.map(row => {
      const getValue = (fieldKey: string): string => {
        const colName = columnMapping[fieldKey];
        if (!colName) return "";
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) return "";
        return (row[colIdx] ?? "").trim();
      };

      const rawAssignee = getValue("assigned_to");
      let assigned_to = rawAssignee ? (userMapping[rawAssignee] || null) : null;
      if (!isManager && assigned_to !== userId) {
        assigned_to = null;
      }

      const rawReviewer = getValue("reviewer");
      let reviewer = null;
      if (rawReviewer) {
        // Resolve reviewer by email, map name, or fuzzy match
        if (rawReviewer.includes("@")) {
          const match = profiles.find(p => emails[p.id]?.toLowerCase() === rawReviewer.toLowerCase());
          reviewer = match ? match.id : null;
        } else {
          reviewer = userMapping[rawReviewer] || suggestProfileMatch(rawReviewer, profiles) || null;
        }
      }
      if (!isManager && reviewer !== userId) {
        reviewer = null;
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

      return {
        task_code: getValue("task_code") || undefined,
        task_name: getValue("task_name") || "(untitled)",
        client: getValue("client") || null,
        project_name: getValue("project_name") || null,
        priority,
        status,
        assigned_to,
        reviewer,
        due_date: parseCSVDate(getValue("due_date")),
        planned_hours: getValue("planned_hours") ? Number(getValue("planned_hours")) : 0,
        sprint_week: getValue("sprint_week") || null,
        remarks: getValue("remarks") || null,
        created_by: userId,
        updated_by: userId,
      };
    });
  };

  const doImport = async () => {
    const payload = getMappedTasks();
    console.log("doImport debug: userId =", userId, "isManager =", isManager);
    console.log("doImport debug: payload =", payload);
    if (!payload.length) return;
    setBusy(true);

    try {
      let inserted = 0;
      let rejected = 0;

      const promises = payload.map(async (task) => {
        try {
          await tasksService.create(task as any, userId);
          inserted++;
        } catch (err) {
          rejected++;
          console.error("Task import failed for:", task.task_name, err);
        }
      });

      await Promise.all(promises);

      if (rejected > 0) {
        toast.warning(`Imported ${inserted} tasks, rejected ${rejected} (Permission denied or invalid fields)`);
      } else {
        toast.success(`Successfully imported ${inserted} tasks!`);
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const previewTasks = step === "preview" ? getMappedTasks() : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        
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
                  <p className="text-xs text-muted-foreground mt-1">Accepts .csv format (UTF-8 encoding)</p>
                </div>
                <input 
                  type="file" 
                  accept=".csv,text/csv" 
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
                <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 p-3 rounded-lg flex items-start gap-2.5 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Member Import Restriction</span>
                    <span>Because you are a team member (not a manager), you can only import tasks assigned to yourself. Tasks mapped to other members will automatically be imported as <strong>Unassigned</strong>.</span>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden max-h-[350px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b border-border sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold w-1/2">CSV Employee Name</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-1/2">System Profile / User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {uniqueNames.map((name) => (
                      <tr key={name} className="hover:bg-muted/10">
                        <td className="px-3 py-2.5 font-medium truncate max-w-[200px]" title={name}>
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

              {!isManager && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 p-3 rounded-lg flex items-start gap-2.5 text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Preview notice for Member Role</span>
                    <span>Tasks belonging to other employees will be imported as <strong>Unassigned</strong>, while tasks belonging to you will remain assigned to you.</span>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden max-h-[350px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50 border-b border-border sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold">Task Name</th>
                      <th className="text-left px-2 py-2 font-semibold">Assignee</th>
                      <th className="text-left px-2 py-2 font-semibold">Client</th>
                      <th className="text-left px-2 py-2 font-semibold">Project</th>
                      <th className="text-left px-2 py-2 font-semibold">Status</th>
                      <th className="text-left px-2 py-2 font-semibold">Due Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewTasks.slice(0, 100).map((task, idx) => {
                      const assigneeProfile = profiles.find(p => p.id === task.assigned_to);
                      return (
                        <tr key={idx} className="hover:bg-muted/5">
                          <td className="px-2 py-2 font-medium truncate max-w-[180px]" title={task.task_name}>
                            {task.task_name}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground truncate max-w-[100px]">
                            {assigneeProfile?.display_name || "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground truncate max-w-[80px]">
                            {task.client || "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground truncate max-w-[100px]">
                            {task.project_name || "—"}
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
                    })}
                    {previewTasks.length > 100 && (
                      <tr>
                        <td colSpan={6} className="text-center py-2 text-muted-foreground font-medium bg-muted/10">
                          ... and {previewTasks.length - 100} more tasks
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
