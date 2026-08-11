import csv
import os

# File paths
INPUT_CSV = r"C:\Users\sumit\Downloads\Daily Flow Postgres\excel\Team_Daily_Tracker_2026(July - Daily Tracker (2)) (1).csv"
OUTPUT_CSV = r"C:\Users\sumit\Downloads\Daily Flow Postgres\excel\Cleaned_Team_Daily_Tracker.csv"

# Project name standardization dictionary
PROJECT_MAPPING = {
    # TicketTape
    "tickettape": "TicketTape",
    "tickit tape": "TicketTape",
    "tickettape": "TicketTape",
    "terracognita | tickettape": "TicketTape",
    
    # TerraCognita
    "terra cognita": "TerraCognita",
    "terracognita": "TerraCognita",
    "terracognita | eris": "TerraCognita",
    "terracognita | mrf_tms": "TerraCognita",
    "mrf | terracognita": "TerraCognita",
    
    # Daily Flow
    "daily flow": "Daily Flow",
    "daily_flow": "Daily Flow",
    "daiy flow": "Daily Flow",
    
    # GST Recon
    "gst recon": "GST Recon",
    "eris gst recon": "GST Recon",
    "terracognita gst recon": "GST Recon",
    
    # Netherlands Intelligence
    "netherland intelligence": "Netherlands Intelligence",
    "netherlands intelligence": "Netherlands Intelligence",
    
    # Recon
    "recon": "Recon",
    "aequitas(recon) | mrf_tms": "Recon",
    "mrf_tms | eris |daily tracker | recon": "Recon",
    
    # Eris
    "eris": "Eris",
    "tms | eris": "Eris",
    "eris | tms_mrf": "Eris",
    
    # TMS / MRF
    "mrf": "TMS",
    "tms": "TMS",
}

def clean_project_name(name):
    if not name or not name.strip():
        return ""
    
    clean = name.strip()
    key = clean.lower()

    # Exact dictionary match
    if key in PROJECT_MAPPING:
        return PROJECT_MAPPING[key]

    # Handle pipe split
    if "|" in clean:
        parts = [p.strip() for p in clean.split("|") if p.strip()]
        for p in parts:
            p_key = p.lower()
            if p_key in PROJECT_MAPPING:
                return PROJECT_MAPPING[p_key]
        return parts[0]

    # Sub-string check for edge cases
    if "tickettape" in key or "tickit" in key:
        return "TicketTape"
    if "terra" in key and "cognita" in key:
        if "v2" in key:
            return "TerraCognita V2"
        if "eris" in key:
            return "TerraCognita ERIS"
        return "TerraCognita"
    if "daily" in key and "flow" in key:
        return "Daily Flow"
    if "gst" in key and "recon" in key:
        return "GST Recon"
    if "netherland" in key:
        return "Netherlands Intelligence"

    return clean

def main():
    if not os.path.exists(INPUT_CSV):
        print(f"Error: Input file not found: {INPUT_CSV}")
        return

    print("Cleaning CSV file...")
    with open(INPUT_CSV, "r", encoding="utf-8-sig", errors="replace") as f_in:
        reader = csv.reader(f_in)
        rows = list(reader)

    cleaned_rows = []
    header_found = False
    proj_idx = -1

    for row in rows:
        if not row:
            cleaned_rows.append(row)
            continue

        # Detect Header Row containing "Project Name"
        if not header_found:
            for idx, cell in enumerate(row):
                if "project" in cell.lower():
                    header_found = True
                    proj_idx = idx
                    break
            cleaned_rows.append(row)
            continue

        # Data rows: Clean Project Name column
        if proj_idx != -1 and len(row) > proj_idx:
            original_proj = row[proj_idx]
            row[proj_idx] = clean_project_name(original_proj)
        
        cleaned_rows.append(row)

    # Save cleaned CSV file
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f_out:
        writer = csv.writer(f_out)
        writer.writerows(cleaned_rows)

    print(f"SUCCESS! Cleaned file created at:\n{OUTPUT_CSV}")

if __name__ == "__main__":
    main()
