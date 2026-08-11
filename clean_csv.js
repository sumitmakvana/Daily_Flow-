import fs from 'fs';

const INPUT_CSV = "C:\\Users\\sumit\\Downloads\\Daily Flow Postgres\\excel\\Team_Daily_Tracker_2026(July - Daily Tracker (2)) (1).csv";
const OUTPUT_CSV = "C:\\Users\\sumit\\Downloads\\Daily Flow Postgres\\excel\\Cleaned_Team_Daily_Tracker.csv";

// Project Mappings
const PROJECT_MAPPING = {
  "tickettape": "TicketTape",
  "tickit tape": "TicketTape",
  "terracognita | tickettape": "TicketTape",
  "terra cognita": "TerraCognita",
  "terracognita": "TerraCognita",
  "beat plan": "TerraCognita",
  "beatplan": "TerraCognita",
  "terracognita | eris": "TerraCognita",
  "terracognita | mrf_tms": "TerraCognita",
  "mrf | terracognita": "TerraCognita",
  "daily flow": "Daily Flow",
  "daily_flow": "Daily Flow",
  "daiy flow": "Daily Flow",
  "gst recon": "GST Recon",
  "eris gst recon": "GST Recon",
  "terracognita gst recon": "GST Recon",
  "netherland intelligence": "Netherlands Intelligence",
  "netherlands intelligence": "Netherlands Intelligence",
  "netherland": "Netherlands Intelligence",
  "recon": "Recon",
  "mtc": "Recon",
  "mtc recon": "Recon",
  "aequitas(recon) | mrf_tms": "Recon",
  "mrf_tms | eris |daily tracker | recon": "Recon",
  "eris": "Eris",
  "tms | eris": "Eris",
  "eris | tms_mrf": "Eris",
  "mrf": "TMS",
  "tms": "TMS",
};

// Client Mappings
const CLIENT_MAPPING = {
  "product": "Product",
  "xpro ai": "XPro AI",
  "xpro": "XPro AI",
  "mrf": "MRF",
  "eris": "Eris",
  "terra cognita": "TerraCognita",
  "terracognita": "TerraCognita",
  "mtc": "Product",
};

// Employee Name Standardizer
const EMPLOYEE_MAPPING = {
  "miraj shah": "Miraj Shah",
  "milan patel": "Milan Patel",
  "krupali joshi": "Krupali Joshi",
  "riddhi patel": "Riddhi Patel",
  "aaditya desai": "Aaditya Desai",
  "het gohel": "Het Gohel",
  "sumit makwana": "Sumit Makwana",
  "mann shah": "Mann Shah",
  "meet patel": "Meet Patel",
  "dharmesh chauhan": "Dharmesh Chauhan",
  "vishwa saraiya": "Vishwa Saraiya",
  "naresh parmar": "Naresh Parmar",
  "nirav thakkar": "Nirav Thakkar",
};

function cleanProject(val) {
  if (!val) return "";
  const clean = val.replace(/[^\w\s|_-]/g, "").trim();
  const key = clean.toLowerCase();
  if (PROJECT_MAPPING[key]) return PROJECT_MAPPING[key];
  if (clean.includes("|")) {
    const parts = clean.split("|").map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (PROJECT_MAPPING[p.toLowerCase()]) return PROJECT_MAPPING[p.toLowerCase()];
    }
    return parts[0];
  }
  if (key.includes("tickettape") || key.includes("tickit")) return "TicketTape";
  if (key.includes("terra") && key.includes("cognita")) return "TerraCognita";
  if (key.includes("beat")) return "TerraCognita";
  if (key.includes("daily") && key.includes("flow")) return "Daily Flow";
  if (key.includes("gst") && key.includes("recon")) return "GST Recon";
  if (key.includes("netherland")) return "Netherlands Intelligence";
  if (key.includes("mtc")) return "Recon";
  return clean;
}

function cleanClient(val) {
  if (!val) return "";
  const clean = val.trim();
  const key = clean.toLowerCase();
  if (key.includes("leave")) return "";
  if (CLIENT_MAPPING[key]) return CLIENT_MAPPING[key];
  return clean;
}

function cleanEmployee(val) {
  if (!val) return "";
  const clean = val.trim();
  const key = clean.toLowerCase();
  if (EMPLOYEE_MAPPING[key]) return EMPLOYEE_MAPPING[key];
  return clean;
}

function parseDate(dateStr) {
  if (!dateStr) return "";
  const clean = dateStr.trim();
  const match = clean.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    const month = months[match[2].toLowerCase()] || '07';
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  return clean;
}

function cleanTaskDescription(text) {
  if (!text) return "";
  return text
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFullCSV() {
  console.log("Reading raw CSV content...");
  let raw = fs.readFileSync(INPUT_CSV, "utf-8");

  // Remove non-ASCII question mark characters
  raw = raw.replace(/\?\?/g, "");

  const lines = raw.split(/\r?\n/);
  const records = [];
  let buffer = "";
  let insideQuotes = false;

  for (const line of lines) {
    if (!line.trim() && !insideQuotes) continue;

    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      insideQuotes = !insideQuotes;
    }

    if (buffer) {
      buffer += " " + line.trim();
    } else {
      buffer = line.trim();
    }

    if (!insideQuotes) {
      records.push(buffer);
      buffer = "";
    }
  }

  const cleanedRows = [];
  const STANDARD_HEADER = [
    "Date", "Day", "Employee Name", "Client", "Project Name", 
    "Morning Plan (What I'll work on today)", "Done", "Git Pushed", 
    "EOD Status", "Tasks Completed", "Pending / Carry Forward", "Remarks"
  ];
  cleanedRows.push(STANDARD_HEADER);

  for (const rec of records) {
    if (rec.includes("DAILY TASK TRACKER") || rec.includes("Team members log") || rec.startsWith('" Wednesday') || rec.startsWith('" Thursday') || rec.startsWith('" Friday') || rec.startsWith('" Monday') || rec.startsWith('" Tuesday') || rec.startsWith('" Saturday') || rec.startsWith('" Sunday')) {
      continue;
    }

    const parts = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < rec.length; i++) {
      const c = rec[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === ',' && !inQ) {
        parts.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    parts.push(cur.trim());

    if (parts.some(p => p.toLowerCase() === "employee name" || p.toLowerCase() === "morning plan")) {
      continue;
    }

    const dateStr = parseDate(parts[0] || "");
    const day = parts[1] || "";
    const empName = cleanEmployee(parts[2] || "");
    let client = cleanClient(parts[3] || "");
    let project = cleanProject(parts[4] || "");
    let morningPlan = cleanTaskDescription(parts[5] || "");

    const isLeave = (
      morningPlan.toLowerCase().includes("leave") ||
      (parts[3] && parts[3].toLowerCase().includes("leave")) ||
      (parts[4] && parts[4].toLowerCase().includes("leave"))
    );

    if (isLeave) {
      client = client.toLowerCase().includes("leave") ? "" : client;
      project = project.toLowerCase().includes("leave") ? "" : project;
      morningPlan = "On Leave";
    }

    const done = isLeave ? "" : "Yes";
    const gitPushed = parts[7] || "";
    const eodStatus = isLeave ? "In Progress" : "Completed";
    const tasksCompleted = cleanTaskDescription(parts[9] || "");
    const pendingCarry = cleanTaskDescription(parts[10] || "");
    const remarks = cleanTaskDescription(parts[11] || "");

    function splitSubTasks(text) {
      if (!text) return [""];

      // 1. Multiline split
      let items = [text];
      if (text.includes("\n")) {
        items = text.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
      }

      // 2. Split project sub-headers e.g. "TerraCognita V1 : ... TerraCognita V2 : ..." or "GST Recon : ... MTC Recon : ..."
      let splitByHeader = [];
      items.forEach(item => {
        if (/(?:TerraCognita|Eris|GST|MTC|Recon|TicketTape|TMS|Daily Flow)\s*(?:V\d+)?\s*\:/i.test(item)) {
          const parts = item.split(/(?=(?:TerraCognita|Eris|GST|MTC|Recon|TicketTape|TMS|Daily Flow)\s*(?:V\d+)?\s*\:)/i).map(p => p.trim()).filter(Boolean);
          splitByHeader.push(...parts);
        } else {
          splitByHeader.push(item);
        }
      });
      items = splitByHeader;

      // 3. Inline numbered split (e.g., 1. ... 2. ... OR 3. ... 4. ...)
      let finalSubTasks = [];
      items.forEach(item => {
        const hasMultipleNumbers = /(?:^|\s+)(?:\d+[\)\.\:\-]+\s*|\(\d+\)\s*|\[\d+\]\s*).*?(?:\s+)(?:\d+[\)\.\:\-]+\s*|\(\d+\)\s*|\[\d+\]\s*)/.test(item);
        if (hasMultipleNumbers) {
          const parts = item.split(/(?:^|\s+)(?=(?:\d+[\)\.\:\-]+\s*|\(\d+\)\s*|\[\d+\]\s*))/).map(p => p.trim()).filter(Boolean);
          finalSubTasks.push(...parts);
        } else {
          finalSubTasks.push(item);
        }
      });

      // 4. Clean up prefix numbers, bullets and list markers
      return finalSubTasks.map(p => p.replace(/^(?:(?:\d+[\)\.\:\-\s]+|\(\d+\)\s*|\[\d+\]\s*)|[-*•☐]\s*)/, "").trim()).filter(Boolean);
    }

    const subTasks = splitSubTasks(morningPlan);
    const completedSubTasks = splitSubTasks(tasksCompleted);

    subTasks.forEach((subTask, idx) => {
      let currentCompleted = "";
      if (!isLeave && tasksCompleted) {
        if (completedSubTasks.length === subTasks.length && completedSubTasks[idx]) {
          currentCompleted = completedSubTasks[idx];
        } else {
          currentCompleted = tasksCompleted;
        }
      }

      cleanedRows.push([
        dateStr, day, empName, client, project, 
        subTask, done, gitPushed, eodStatus, 
        currentCompleted, isLeave ? "" : pendingCarry, remarks
      ]);
    });
  }

  const csvContent = cleanedRows.map(row => 
    row.map(cell => {
      if (cell.includes(",") || cell.includes('"')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",")
  ).join("\n");

  try {
    fs.writeFileSync(OUTPUT_CSV, csvContent, "utf-8");
    console.log(`\n==================================================`);
    console.log(`SUCCESS! 100% Fully Cleaned & Task-Split CSV generated at:`);
    console.log(OUTPUT_CSV);
    console.log(`Total Cleaned Rows: ${cleanedRows.length - 1}`);
    console.log(`==================================================\n`);
  } catch (e) {
    const ALT_OUTPUT = "C:\\Users\\sumit\\Downloads\\Daily Flow Postgres\\excel\\Cleaned_Team_Daily_Tracker_Final.csv";
    fs.writeFileSync(ALT_OUTPUT, csvContent, "utf-8");
    console.log(`\n==================================================`);
    console.log(`SUCCESS! (Main file locked in Excel, wrote to final file):`);
    console.log(ALT_OUTPUT);
    console.log(`Total Cleaned Rows: ${cleanedRows.length - 1}`);
    console.log(`==================================================\n`);
  }
}

cleanFullCSV();
