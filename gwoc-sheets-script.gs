/**
 * GWOC Timesheet System — Google Sheets Sync Script  v5
 * ======================================================
 * Paste this entire file into Apps Script (Extensions → Apps Script).
 * Replace any existing code completely, save, then create a
 * NEW deployment (Deploy → New deployment).
 *
 * DEPLOY SETTINGS:
 *   Execute as:      Me
 *   Who has access:  Anyone
 *
 * SYNC MODES
 *   append  — adds only rows not already in the sheet, matched on
 *             Name + Date + Start + End. Safe to run repeatedly
 *             without creating duplicates.
 *   replace — clears the sheet and rewrites everything from scratch.
 */

var SHEET_TAB = 'Timesheets';

// Columns used to identify a unique shift (duplicate detection)
// These must match the header array sent from GWOC exactly.
var UNIQUE_KEYS = ['Name', 'Date', 'Start', 'End'];

// ── GET: ping only ────────────────────────────────────────────────
function doGet(e) {
  var action = (e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
  if (action === 'ping') {
    return jsonResponse({ ok: true, message: 'GWOC Sheets Script v5 is running', version: 'v5' });
  }
  return jsonResponse({ ok: false, error: 'Use POST for sync.' });
}

// ── POST: sync ────────────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'No POST body received.' });
    }

    var payload = JSON.parse(e.postData.contents);
    if (payload.action !== 'syncTimesheets') {
      return jsonResponse({ ok: false, error: 'Unknown action: ' + payload.action });
    }

    var header  = payload.header;
    var rows    = payload.rows;
    var mode    = payload.mode || 'append';

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ ok: false, error: 'No data rows received.' });
    }

    var result = mode === 'replace'
      ? replaceSheet(header, rows)
      : appendSheet(header, rows);

    return jsonResponse({ ok: true, mode: mode, written: result.written, skipped: result.skipped });

  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Replace mode: clear and rewrite everything ────────────────────
function replaceSheet(header, rows) {
  var sheet = getOrCreateSheet();
  sheet.clearContents();
  sheet.clearFormats();

  var allRows = header ? [header].concat(rows) : rows;
  sheet.getRange(1, 1, allRows.length, allRows[0].length).setValues(allRows);
  applyHeaderStyle(sheet, allRows[0].length);
  applyRowShading(sheet, 2, allRows.length, allRows[0].length);
  sheet.autoResizeColumns(1, allRows[0].length);
  writeLastSynced(sheet, allRows.length);

  return { written: rows.length, skipped: 0 };
}

// ── Append mode: add only rows not already present ────────────────
function appendSheet(header, newRows) {
  var sheet    = getOrCreateSheet();
  var lastRow  = sheet.getLastRow();
  var lastCol  = Math.max(sheet.getLastColumn(), (header ? header.length : newRows[0].length));

  // If sheet is empty, write header first
  if (lastRow === 0) {
    if (header) {
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
      applyHeaderStyle(sheet, header.length);
      sheet.setFrozenRows(1);
      lastRow = 1;
    }
  }

  // Build a set of existing shift fingerprints for dedup
  var existing = {};
  if (lastRow > 1) {
    // Read existing header to find column indices
    var existingHeader = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var keyIdxs = UNIQUE_KEYS.map(function(k) { return existingHeader.indexOf(k); });
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    dataRange.forEach(function(row) {
      var key = keyIdxs.map(function(i) { return i >= 0 ? String(row[i]) : ''; }).join('|');
      existing[key] = true;
    });
  }

  // Determine column indices from incoming header for dedup
  var incomingKeyIdxs = header
    ? UNIQUE_KEYS.map(function(k) { return header.indexOf(k); })
    : UNIQUE_KEYS.map(function(_, i) { return i; }); // fallback: first N cols

  // Filter to only new rows
  var toWrite = [];
  var skipped = 0;
  newRows.forEach(function(row) {
    var key = incomingKeyIdxs.map(function(i) { return i >= 0 ? String(row[i]) : ''; }).join('|');
    if (existing[key]) {
      skipped++;
    } else {
      toWrite.push(row);
    }
  });

  if (toWrite.length > 0) {
    var startRow = lastRow + 1;
    sheet.getRange(startRow, 1, toWrite.length, toWrite[0].length).setValues(toWrite);
    applyRowShading(sheet, startRow, startRow + toWrite.length - 1, toWrite[0].length);
    sheet.autoResizeColumns(1, toWrite[0].length);
  }

  // Update last-synced note (remove old one first)
  var totalRows = sheet.getLastRow();
  // Clear any previous note rows (scan last few rows)
  for (var r = totalRows; r > totalRows - 3 && r > 1; r--) {
    var cellVal = String(sheet.getRange(r, 1).getValue());
    if (cellVal.indexOf('Last synced:') === 0) {
      sheet.getRange(r, 1).clearContent();
    }
  }
  writeLastSynced(sheet, sheet.getLastRow() + 1);

  return { written: toWrite.length, skipped: skipped };
}

// ── Helpers ───────────────────────────────────────────────────────
function getOrCreateSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) sheet = ss.insertSheet(SHEET_TAB);
  return sheet;
}

function applyHeaderStyle(sheet, numCols) {
  var hdr = sheet.getRange(1, 1, 1, numCols);
  hdr.setFontWeight('bold');
  hdr.setBackground('#1b2b3a');
  hdr.setFontColor('#f0f4f8');
  hdr.setFontSize(10);
  sheet.setFrozenRows(1);
}

function applyRowShading(sheet, fromRow, toRow, numCols) {
  for (var i = fromRow; i <= toRow; i++) {
    sheet.getRange(i, 1, 1, numCols)
         .setBackground(i % 2 === 0 ? '#eaf0f6' : '#ffffff');
  }
}

function writeLastSynced(sheet, row) {
  var cell = sheet.getRange(row, 1);
  cell.setValue('Last synced: ' + new Date().toLocaleString('en-GB'));
  cell.setFontColor('#7a95aa').setFontSize(9);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
