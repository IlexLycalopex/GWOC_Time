# GWOC Timesheet System

A self-contained, browser-based timesheet application for logging casual staff hours across multiple locations. No server, no database, no installation. All data is stored in the browser's `localStorage` with optional backup sync to Google Sheets.

---

## Table of Contents

1. [Overview](#overview)
2. [Files in this Repository](#files-in-this-repository)
3. [Deployment](#deployment)
4. [First-Time Setup](#first-time-setup)
5. [Feature Reference](#feature-reference)
   - [Dashboard](#dashboard)
   - [Timesheets](#timesheets)
   - [Staff](#staff)
   - [Locations](#locations)
   - [Admin](#admin)
6. [Break Rule Logic](#break-rule-logic)
7. [Data Storage](#data-storage)
8. [Google Sheets Sync](#google-sheets-sync)
   - [Apps Script Setup](#apps-script-setup)
   - [Sync Modes](#sync-modes)
   - [How the Sync Works Technically](#how-the-sync-works-technically)
9. [Admin Security Model](#admin-security-model)
10. [Key Constants](#key-constants)
11. [Function Reference](#function-reference)
12. [Known Limitations](#known-limitations)
13. [Potential Enhancements](#potential-enhancements)

---

## Overview

GWOC Timesheet System is a single HTML file (`gwoc-timesheet.html`) that runs entirely in the browser. It is designed for small teams logging casual or hourly staff shifts across named locations. Key characteristics:

- **No backend required.** The app is a single `.html` file with all CSS and JavaScript inline.
- **Data persists in `localStorage`.** Data survives page refresh but is tied to the browser and device it was entered on.
- **Google Sheets backup** is available via a companion Google Apps Script, allowing periodic push-sync of timesheet records.
- **Password-protected Admin** controls access to destructive actions (clear data, delete records) and configuration (sync URL, password change).
- **Break compliance** is calculated automatically against a configurable rule set.

---

## Files in this Repository

| File | Purpose |
|---|---|
| `gwoc-timesheet.html` | The complete application. All pages, styles, and logic in one file. |
| `gwoc-sheets-script.gs` | Google Apps Script to paste into Google Sheets. Handles the server-side sync endpoint. |
| `README.md` | This document. |

---

## Deployment

The app can be opened directly as a local file or hosted on any static file host.

**Option A — Local file**
Open `gwoc-timesheet.html` directly in a browser. Google Sheets sync will not work from a `file://` context due to browser security restrictions. All other features work fully.

**Option B — Static hosting (recommended)**
Upload `gwoc-timesheet.html` to any static host:

- GitHub Pages
- Netlify (drag-and-drop deploy)
- Any web server capable of serving static files

No build step, no dependencies, no configuration files are needed. The file is self-contained.

**External dependency:** The app loads two font families from Google Fonts at runtime (`Playfair Display` and `DM Sans`). If the device is offline, the browser falls back to system sans-serif fonts. All functionality remains intact without the fonts.

---

## First-Time Setup

1. Deploy or open the file.
2. Navigate to **Admin** in the top navigation.
3. Enter the default password: `admin1234`
4. **Immediately change the password** using the Change Password card.
5. Navigate to **Locations** and add your site names.
6. Navigate to **Staff** and add your team members (or use CSV upload in Admin).
7. Begin logging shifts on the **Timesheets** page.

---

## Feature Reference

### Dashboard

The default landing page. Provides a summary of timesheet data for a selected period.

**Filters**
- Date range: From / To date pickers
- Location: filter all charts to a single site
- Quick-select buttons: This Week, This Month, All Time

**KPI Cards**
- Total Net Hours (sum of all net hours in period)
- Active Staff (distinct staff names in period)
- Average Shift Length (net hours per shift)
- Break Violations (count of shifts with a break compliance flag)

**Charts** (horizontal bar, rendered in HTML/CSS — no chart library dependency)
- Hours by Employee
- Hours by Location
- Hours by Day of Week (Mon–Sun)
- Break Violations list (name, date, times, location, break taken vs required)

**Staff Summary Table**
Columns: Name, Shifts, Total Hours, Avg Shift, Locations, Violations.
Sorted by total hours descending.

---

### Timesheets

**Log Shifts panel**

The staff name field uses an autocomplete dropdown driven by the Staff list. Names can also be typed freely (not all names need to be in the directory).

Each shift row contains:

| Field | Input type | Notes |
|---|---|---|
| Date | Date picker | Defaults to today |
| Start | Select (15-min increments, 00:00–23:45) | Defaults to 09:00 |
| End | Select (15-min increments, 00:00–23:45) | Defaults to 17:00 |
| Location | Select (from Locations list) | Optional |
| Break Taken | Select (0–90 min in 15-min steps) | See Break Rule Logic |
| Net Hours | Calculated, read-only | Updates on any change |
| Status | Calculated badge | OK / warning / error |

Multiple shift rows can be added to a single submission (e.g. logging a full week at once). Each row is an independent shift record.

Clicking **Save Timesheet** stores the entry. The form resets. If any row has a break violation, the toast message flags it.

**Timesheet Records panel**

Displays all saved entries in a filterable table. Filters: Staff name (text search), Location (dropdown), From date, To date.

Summary bar shows: entry count, total net hours, violation count.

Delete buttons (✕) are visible on each row but are **disabled unless Admin is unlocked**. When locked they appear at 35% opacity and show a toast if clicked.

---

### Staff

Add, view, and remove staff members.

**Fields:** First Name, Last Name, Role (optional).

Staff are stored as `{ id, name, role }` objects, sorted alphabetically. The `name` field is a concatenation of first and last name and is what appears in autocomplete and all records.

**Avatar colours** are deterministically assigned from a palette of 8 colours based on a hash of the name. The same name will always produce the same colour.

**CSV Upload** (available in Admin) accepts files with either:
- A `name` column (plus optional `role`)
- `first_name` and `last_name` columns (plus optional `role`)

Duplicates (matched case-insensitively on name) are skipped. The import reports how many were added and how many skipped.

---

### Locations

Add and remove named locations. Each location is stored as `{ id, name }`.

Locations populate the dropdown on each shift row and the filter dropdowns on Timesheets and Dashboard. Adding or removing a location immediately updates all dropdowns in the interface.

Locations are sorted alphabetically.

---

### Admin

Password-protected. The lock screen is shown on every visit to the Admin tab until the correct password is entered. The unlocked state is held in a session variable (`adminUnlocked`) and is lost on page reload.

**Actions available in Admin:**

| Card | Action |
|---|---|
| Google Sheets Backup Sync | Test connection, set sync mode, trigger sync |
| Export Timesheets | Downloads all records as CSV |
| Export Staff List | Downloads staff directory as CSV |
| Upload Staff (CSV) | Bulk-import staff from a CSV file |
| Clear Timesheet Data | Deletes all timesheet records (confirmation required) |
| Clear All Data | Deletes timesheets, staff, and locations (confirmation required) |
| Change Password | Updates the admin password (minimum 6 characters) |

**CSV export columns (timesheets):**
`Name, Location, Date, Start, End, Break Taken (mins), Break Required (mins), Net Hours, Break Violation, Saved At`

---

## Break Rule Logic

The break requirement is calculated as **15 minutes per complete 6-hour block** worked.

```
requiredBreak(grossMins) = floor(grossMins / 360) * 15
```

Examples:

| Gross shift | Required break |
|---|---|
| Under 6h | 0 min |
| 6h – 11h 59m | 15 min |
| 12h – 17h 59m | 30 min |
| 18h – 23h 59m | 45 min |

**Maximum break that can be logged:** 90 minutes (controlled by the `MAX_BREAK` constant).

**Net hours calculation:**

```
deduction = max(breakTaken, requiredBreak)
netHours  = (grossMins - deduction) / 60
```

The deduction is always at least the required break, even if the user logged less. This prevents over-counting hours where breaks were not taken.

**Status badges:**

| Badge | Condition |
|---|---|
| ✓ OK (green) | Requirement met, or no break required |
| ⚠ Need Xm (amber) | Break logged but less than required |
| ⚠ Xm req. (red) | Break required but none logged |

---

## Data Storage

All data is stored in `localStorage` under the following keys:

| Key | Contents |
|---|---|
| `gwoc_records` | Array of timesheet entry objects |
| `gwoc_staff` | Array of staff objects |
| `gwoc_locations` | Array of location objects |
| `gwoc_admin_pw` | Admin password string |
| `gwoc_sheets_url` | Apps Script Web App URL |
| `gwoc_sheets_mode` | Sync mode (`append` or `replace`) |
| `gwoc_sheets_last_sync` | Timestamp of last sync attempt |
| `gwoc_sheets_last_status` | `success` or `error` |

**Timesheet record structure:**
```json
{
  "id": 1700000000000,
  "name": "Sarah Mitchell",
  "savedAt": "2025-11-01T09:32:00.000Z",
  "shifts": [
    {
      "date": "2025-11-01",
      "start": "09:00",
      "end": "17:00",
      "location": "High Street",
      "breakMins": 30,
      "requiredBreak": 15,
      "netHours": 7.5,
      "breakWarning": false
    }
  ]
}
```

**Important:** `localStorage` is browser- and device-specific. Data entered on one device does not appear on another unless synced via Google Sheets. Clearing browser data or using a different browser profile will lose all data. The Google Sheets sync and CSV export are the only backup mechanisms.

---

## Google Sheets Sync

### Apps Script Setup

This is a one-time process per Google account.

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something recognisable (e.g. `GWOC Timesheets`).
2. In the spreadsheet: **Extensions → Apps Script**.
3. Delete all existing code in the editor. Paste the entire contents of `gwoc-sheets-script.gs`.
4. Click **Save** (💾).
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**. Authorise the permissions when prompted.
7. Copy the **Web App URL** (ends in `/exec`).
8. In GWOC: go to **Admin → unlock → paste the URL** into the Sync URL field.
9. Click **Test Connection** — the status panel should turn green and show `v5`.
10. Click **Sync Now**.

**Re-deploying after code changes:** editing the script and saving does not update a deployed web app. You must click **Deploy → New deployment** each time the script code changes. This generates a new URL which must be re-pasted into GWOC Admin.

**Verifying the script is live:** visit the `/exec` URL directly in a browser. A live deployment returns:
```json
{"ok":true,"message":"GWOC Sheets Script v5 is running","version":"v5"}
```

If you see a Google login page, the deployment access was not set to **Anyone**. Redeploy.

### Sync Modes

The sync mode dropdown in Admin offers two options:

**Append new rows (default)**
Reads all existing rows in the Google Sheet, computes a fingerprint for each shift using `Name + Date + Start + End`, and writes only rows whose fingerprint does not already exist. Safe to run repeatedly — no duplicates will be created.

**Replace all**
Clears the Timesheets tab completely and rewrites all records from scratch. Use this after a Clear Timesheet Data operation to reset the sheet to match local data, or if the append mode has produced inconsistencies.

### How the Sync Works Technically

- **Test / ping:** a `GET` request to `{url}?action=ping`. Apps Script reads `e.parameter.action` and returns a JSON status object. This request is a simple CORS request (no preflight) and the response is readable because Apps Script sets `Access-Control-Allow-Origin: *` on GET responses.

- **Sync:** a `POST` request with `Content-Type: text/plain` and a JSON body. `text/plain` is a CORS "simple request" — no preflight is needed. Apps Script reads the body from `e.postData.contents` in the `doPost()` function, parses the JSON, and writes to the sheet.

- The sync sends the entire local dataset in a single POST. There is no chunking. For very large datasets (thousands of rows), this may approach URL or payload limits, though in practice casual staff timesheet volumes are well within bounds.

- The Google Sheet tab is always named `Timesheets`. This is set by the `SHEET_TAB` variable at the top of `gwoc-sheets-script.gs` and can be changed there if needed.

---

## Admin Security Model

The admin password is stored in `localStorage` as plain text. It is not encrypted. This is intentional — the system is designed for internal use on trusted devices, not as a secure authentication layer.

**What the admin lock controls:**
- Access to export, import, clear, and sync functions
- Ability to delete individual timesheet records (delete buttons are disabled when admin is locked)

**What it does not control:**
- Read access to any data — all records, staff, and locations are always visible
- Adding new staff, locations, or timesheet entries — these are always available

**Session behaviour:** the unlocked state (`adminUnlocked`) is a JavaScript variable. It resets to `false` on every page reload. There is no persistent session. Locking and unlocking triggers a re-render of the records table to update delete button states.

**Default password:** `admin1234`. This must be changed before the system goes into use.

---

## Key Constants

These are defined at the top of the `<script>` block in `gwoc-timesheet.html` and can be adjusted without affecting any other logic:

| Constant | Default | Purpose |
|---|---|---|
| `ADMIN_PW_KEY` | `'gwoc_admin_pw'` | localStorage key for the admin password |
| `DEFAULT_PW` | `'admin1234'` | Fallback password if none is set in localStorage |
| `MAX_BREAK` | `90` | Maximum break duration (minutes) available in the shift row dropdown |

In `gwoc-sheets-script.gs`:

| Constant | Default | Purpose |
|---|---|---|
| `SHEET_TAB` | `'Timesheets'` | Name of the Google Sheet tab written to |
| `UNIQUE_KEYS` | `['Name','Date','Start','End']` | Columns used to fingerprint shifts in append-mode deduplication |

---

## Function Reference

### Navigation
| Function | Description |
|---|---|
| `switchPage(p)` | Shows the named page (`dashboard`, `timesheets`, `staff`, `locations`, `admin`) and triggers any page-specific render |

### Admin
| Function | Description |
|---|---|
| `checkAdminPw()` | Validates the password input and sets `adminUnlocked = true` on success |
| `lockAdmin()` | Resets `adminUnlocked` and returns to the lock screen |
| `changePassword()` | Validates and saves a new admin password to localStorage |

### Staff
| Function | Description |
|---|---|
| `addStaff()` | Reads the First/Last/Role fields, validates, and appends to the staff list |
| `deleteStaff(id)` | Removes a staff member by id after confirmation |
| `renderStaffGrid()` | Re-renders the staff card grid |
| `importStaffCSV(event)` | Parses a CSV file input and bulk-adds staff, skipping duplicates |

### Locations
| Function | Description |
|---|---|
| `addLocation()` | Reads the location name field, validates, and appends |
| `deleteLocation(id)` | Removes a location by id after confirmation |
| `renderLocGrid()` | Re-renders the location card grid |
| `rebuildLocSelects()` | Rebuilds all location dropdowns across the app (shift rows, filters) |

### Break Calculation
| Function | Description |
|---|---|
| `requiredBreak(grossMins)` | Returns required break in minutes for a given gross shift duration |
| `calcNetHours(start, end, breakMins)` | Returns net hours as a float |
| `breakStatus(start, end, breakMins)` | Returns `{type, label, tip}` for the status badge |

### Timesheets
| Function | Description |
|---|---|
| `addShiftRow(data)` | Appends a new shift row to the log form, optionally pre-populated |
| `updateRow(id)` | Recalculates net hours and status badge for a given row |
| `getRowData()` | Reads all shift rows from the form and returns an array of shift objects |
| `saveEntry()` | Validates and saves the current form as a timesheet entry |
| `deleteRecord(id)` | Deletes a record by id — requires `adminUnlocked` |
| `renderRecords()` | Applies current filters and re-renders the records table |

### Dashboard
| Function | Description |
|---|---|
| `renderDashboard()` | Reads filters, computes all metrics, and renders all dashboard panels |
| `getDashShifts()` | Returns filtered flat array of shift objects for the dashboard |
| `setDashPeriod(period)` | Sets the date range filter to `week`, `month`, or `all` |
| `drawBars(containerId, data, colorFn)` | Renders a horizontal bar chart into a container element |

### Google Sheets Sync
| Function | Description |
|---|---|
| `testConnection()` | Sends a GET ping to the Apps Script URL and reports the result |
| `syncToSheets()` | Builds the row payload and POST it to the Apps Script endpoint |
| `saveSyncUrl()` | Persists the URL field value to localStorage |
| `saveSyncMode()` | Persists the sync mode dropdown value to localStorage |
| `loadSyncUrl()` | Restores URL and mode from localStorage on admin panel load |
| `setSyncStatus(type, msg)` | Updates the status indicator panel (`idle`, `syncing`, `success`, `error`) |

### Export
| Function | Description |
|---|---|
| `exportCSV()` | Generates and downloads a CSV of all timesheet records |
| `exportStaffCSV()` | Generates and downloads a CSV of the staff list |

---

## Known Limitations

- **Single-device only.** `localStorage` does not sync across devices or browsers. The Google Sheets sync is push-only — it cannot pull data back into GWOC.
- **No user authentication.** The admin password is plain text in localStorage. It is a deterrent, not a security control.
- **No overnight shifts.** The net hours calculation assumes end time is after start time on the same day. A shift from 22:00 to 06:00 will produce a negative gross duration and show `--`.
- **localStorage limits.** Browsers typically allow 5–10 MB per origin. Very large datasets accumulated over many months could approach this. Regular CSV export or Google Sheets sync mitigates this risk.
- **No edit functionality.** Saved timesheet entries cannot be edited — only deleted (by an admin) and re-entered.
- **Font dependency.** The app loads fonts from Google Fonts. On networks that block Google Fonts, the app falls back to system fonts gracefully.

---

## Potential Enhancements

The following features were noted during development as useful next steps:

- **Overnight shift support** — detect when end time is before start time and add 24 hours to the gross calculation
- **Edit saved entries** — allow correction of records without delete-and-reenter
- **Pay period summary** — generate a per-employee hours summary for a defined pay period, formatted for payroll
- **Notes field** — free-text field per shift for logging anomalies
- **Print / PDF export** — formatted single-employee timesheet for signing
- **Two-way sync** — pull data from Google Sheets back into GWOC (would require a backend or service worker)
- **Multi-device support** — replace localStorage with a cloud store (Supabase, Firebase, or a simple REST API) to allow multiple users on different devices

---

## Maintenance Notes

**Changing the break rule:** modify `requiredBreak()` in `gwoc-timesheet.html`. The current formula is `floor(grossMins / 360) * 15`. Also update the explanatory note in the break-rule-note div on the Timesheets page to match.

**Changing the max break:** change the `MAX_BREAK` constant. The break dropdown options are generated from this value automatically.

**Changing the sheet tab name:** update `SHEET_TAB` in `gwoc-sheets-script.gs`, save, and create a new deployment. The existing tab in the Google Sheet must be renamed to match, or the script will create a new tab with the new name.

**Migrating to a new Google account:** create a new Google Sheet, paste `gwoc-sheets-script.gs` into a new Apps Script project in that sheet, deploy as a Web App, and paste the new URL into GWOC Admin. No changes to the HTML file are needed.

**Adding a new column to the export:** update the header array and the row-building loop in both `exportCSV()` (in the HTML) and `doPost()` / `writeSheet()` (in the Apps Script) to keep them consistent.
