/** Parse a new-hire roster CSV into rows the map API can consume. */

const HEADER_ALIASES = {
  employee_id: ['employee_id', 'employeeid', 'emp_id', 'empid', 'id'],
  name: ['name', 'employee_name', 'full_name', 'fullname'],
  role: ['role', 'job_role', 'title'],
  location: ['location', 'site', 'city'],
  class_reference: ['class_reference', 'class_ref', 'class', 'class_name', 'classname'],
  hire_date: ['hire_date', 'start_date', 'date'],
  fte: ['fte', 'hc', 'headcount', 'hours_fte'],
};

function normKey(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function mapHeaders(rawHeaders) {
  const mapped = {};
  const norms = rawHeaders.map(normKey);
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norms.findIndex((h) => aliases.includes(h));
    if (idx >= 0) mapped[canon] = idx;
  }
  return mapped;
}

/**
 * @param {string} text
 * @returns {{ rows: object[], totalFte: number, classRefs: string[], errors: string[] }}
 */
export function parseRosterCsv(text) {
  const errors = [];
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], totalFte: 0, classRefs: [], errors: ['CSV needs a header row and at least one employee.'] };
  }

  const headers = splitCsvLine(lines[0]);
  const col = mapHeaders(headers);
  if (col.employee_id == null && col.name == null) {
    errors.push('Need an employee_id or name column.');
  }

  const rows = [];
  const classRefs = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (!cells.some((c) => c)) continue;

    const employee_id =
      (col.employee_id != null ? cells[col.employee_id] : '') ||
      `ROW-${i}`;
    const name = col.name != null ? cells[col.name] : '';
    const role = col.role != null ? cells[col.role] : 'Agent';
    const location = col.location != null ? cells[col.location] : '';
    const class_reference = col.class_reference != null ? cells[col.class_reference] : '';
    const hire_date = col.hire_date != null ? cells[col.hire_date] : '';
    let fte = 1;
    if (col.fte != null && cells[col.fte] !== '') {
      const n = Number(String(cells[col.fte]).replace(/%/g, ''));
      if (Number.isFinite(n) && n >= 0) fte = n;
      else errors.push(`Row ${i + 1}: bad FTE "${cells[col.fte]}"`);
    }

    if (class_reference) classRefs.add(class_reference);
    rows.push({
      employee_id: String(employee_id).trim(),
      name: String(name || '').trim() || null,
      role: String(role || 'Agent').trim(),
      location: String(location || '').trim() || null,
      class_reference: String(class_reference || '').trim() || null,
      hire_date: String(hire_date || '').trim() || null,
      fte,
    });
  }

  if (!rows.length) errors.push('No employee rows found.');

  const totalFte = rows.reduce((s, r) => s + (Number(r.fte) || 0), 0);
  return { rows, totalFte, classRefs: [...classRefs], errors };
}

export async function readRosterFile(file) {
  const text = await file.text();
  const parsed = parseRosterCsv(text);
  return { ...parsed, filename: file.name || 'roster.csv' };
}
