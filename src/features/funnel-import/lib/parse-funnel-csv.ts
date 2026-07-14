import type { FunnelStep } from "../../../entities/measurement/model.ts";

const MAX_FILE_SIZE = 1_048_576;
const MAX_STEPS = 100;
const EXPECTED_HEADERS = ["step_id", "step_name", "users"];
const ALLOWED_MEDIA_TYPES = new Set(["", "text/csv", "application/vnd.ms-excel"]);

export type FunnelCsvIssueCode =
  | "invalid_file_type"
  | "file_too_large"
  | "empty_file"
  | "malformed_csv"
  | "invalid_header"
  | "invalid_column_count"
  | "too_many_steps"
  | "insufficient_steps"
  | "empty_step_id"
  | "empty_label"
  | "invalid_users"
  | "duplicate_step"
  | "zero_baseline"
  | "non_monotonic_funnel";

export type FunnelCsvIssue = {
  code: FunnelCsvIssueCode;
  row?: number;
  column?: string;
  message: string;
};

export type FunnelCsvInput = {
  fileName: string;
  mediaType: string;
  size: number;
  text: string;
};

export type FunnelCsvResult =
  | { ok: true; steps: FunnelStep[] }
  | { ok: false; issues: FunnelCsvIssue[] };

type RowParseResult =
  | { ok: true; rows: string[][] }
  | { ok: false; issue: FunnelCsvIssue };

function columnName(index: number): string {
  return EXPECTED_HEADERS[index] ?? "row";
}

function malformedIssue(row: number, column: number, message: string): RowParseResult {
  return { ok: false, issue: { code: "malformed_csv", row, column: columnName(column), message } };
}

function parseRows(text: string): RowParseResult {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let rowNumber = 1;
  let quoteRow = 1;
  let quoteColumn = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character !== '"') {
        field += character;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      inQuotes = false;
      quoteClosed = true;
      continue;
    }

    if (character === '"') {
      if (field.length > 0 || quoteClosed) return malformedIssue(rowNumber, currentRow.length, "따옴표 위치가 올바르지 않습니다.");
      inQuotes = true;
      quoteRow = rowNumber;
      quoteColumn = currentRow.length;
      continue;
    }
    if (character === ",") {
      currentRow.push(field);
      field = "";
      quoteClosed = false;
      continue;
    }
    if (character === "\n" || character === "\r") {
      currentRow.push(field);
      rows.push(currentRow);
      currentRow = [];
      field = "";
      quoteClosed = false;
      rowNumber += 1;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    if (quoteClosed && character.trim().length > 0) {
      return malformedIssue(rowNumber, currentRow.length, "닫힌 따옴표 뒤에 허용되지 않은 문자가 있습니다.");
    }
    field += character;
  }

  if (inQuotes) return malformedIssue(quoteRow, quoteColumn, "닫히지 않은 따옴표가 있습니다.");
  currentRow.push(field);
  rows.push(currentRow);
  return { ok: true, rows: rows.filter((row) => row.some((cell) => cell.trim().length > 0)) };
}

export function validateFunnelCsvFile(input: Pick<FunnelCsvInput, "fileName" | "mediaType" | "size">): FunnelCsvIssue | null {
  if (!input.fileName.toLowerCase().endsWith(".csv") || !ALLOWED_MEDIA_TYPES.has(input.mediaType.toLowerCase())) {
    return { code: "invalid_file_type", message: "CSV 파일만 업로드할 수 있습니다." };
  }
  if (input.size > MAX_FILE_SIZE) return { code: "file_too_large", message: "CSV 파일은 1MB 이하여야 합니다." };
  return null;
}

function parseUsers(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value.trim())) return null;
  const users = Number(value);
  return Number.isSafeInteger(users) ? users : null;
}

function validateRows(rows: string[][]): FunnelCsvResult {
  const issues: FunnelCsvIssue[] = [];
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_STEPS) issues.push({ code: "too_many_steps", message: `퍼널 단계는 ${MAX_STEPS}개 이하여야 합니다.` });

  const steps: FunnelStep[] = [];
  const ids = new Set<string>();
  for (const [index, row] of dataRows.entries()) {
    const rowNumber = index + 2;
    if (row.length !== EXPECTED_HEADERS.length) {
      issues.push({ code: "invalid_column_count", row: rowNumber, column: "row", message: "각 행은 3개 열이어야 합니다." });
      continue;
    }
    const id = row[0].trim();
    const label = row[1].trim();
    const users = parseUsers(row[2]);
    if (!id) issues.push({ code: "empty_step_id", row: rowNumber, column: "step_id", message: "단계 ID를 입력하세요." });
    if (!label) issues.push({ code: "empty_label", row: rowNumber, column: "step_name", message: "단계 이름을 입력하세요." });
    if (users === null) issues.push({ code: "invalid_users", row: rowNumber, column: "users", message: "사용자 수는 0 이상의 안전한 정수여야 합니다." });
    if (id && ids.has(id)) issues.push({ code: "duplicate_step", row: rowNumber, column: "step_id", message: "단계 ID는 중복될 수 없습니다." });
    if (!id || !label || users === null || ids.has(id)) continue;
    ids.add(id);
    steps.push({ id, label, users });
  }

  if (issues.length === 0 && steps.length < 2) issues.push({ code: "insufficient_steps", message: "퍼널은 최소 2개 단계가 필요합니다." });
  if (issues.length === 0 && steps[0].users === 0) {
    issues.push({ code: "zero_baseline", row: 2, column: "users", message: "첫 단계 사용자 수는 0보다 커야 합니다." });
  }
  if (issues.length === 0) {
    for (let index = 1; index < steps.length; index += 1) {
      if (steps[index].users <= steps[index - 1].users) continue;
      issues.push({ code: "non_monotonic_funnel", row: index + 2, column: "users", message: "순차 퍼널의 사용자 수는 이전 단계보다 클 수 없습니다." });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, steps };
}

export function parseFunnelCsv(input: FunnelCsvInput): FunnelCsvResult {
  const fileIssue = validateFunnelCsvFile(input);
  if (fileIssue) return { ok: false, issues: [fileIssue] };
  if (input.text.trim().length === 0) return { ok: false, issues: [{ code: "empty_file", message: "CSV 파일이 비어 있습니다." }] };
  const parsed = parseRows(input.text);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
  if (parsed.rows.length === 0) return { ok: false, issues: [{ code: "empty_file", message: "CSV 파일이 비어 있습니다." }] };

  const headers = parsed.rows[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim());
  const validHeader = headers.length === EXPECTED_HEADERS.length && EXPECTED_HEADERS.every((header, index) => headers[index] === header);
  if (!validHeader) {
    return { ok: false, issues: [{ code: "invalid_header", row: 1, column: "header", message: `헤더는 ${EXPECTED_HEADERS.join(",")} 순서여야 합니다.` }] };
  }
  return validateRows([headers, ...parsed.rows.slice(1)]);
}
