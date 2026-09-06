/**
 * MILESTONE 3N — export/import.
 *
 * Minimal, dependency-free CSV encode/decode. Handles the cases that
 * actually come up in this app's data (commas, quotes, and newlines
 * inside a field — prospect evidence/fit_reason text can contain all
 * three) without pulling in a library for something this contained.
 */

export function toCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(toCsvField).join(",");
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)];
  // \r\n line endings and a leading BOM: both make Excel (the most likely
  // destination for these files) open the file correctly rather than
  // mangling special characters or treating it as one giant column.
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Parses a CSV into an array of objects keyed by the header row.
 * Deliberately simple (no streaming, no huge-file support) — this is for
 * a person exporting/importing a few hundred to a few thousand prospects
 * via a spreadsheet, not a data pipeline.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const cleaned = text.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(cleaned);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== "")).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
