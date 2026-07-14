import assert from "node:assert/strict";
import test from "node:test";
import { parseFunnelCsv, validateFunnelCsvFile, type FunnelCsvIssueCode } from "./parse-funnel-csv.ts";

function csvInput(text: string, fileName = "funnel.csv") {
  return { fileName, mediaType: "text/csv", size: Buffer.byteLength(text), text };
}

function issueCodes(result: ReturnType<typeof parseFunnelCsv>): FunnelCsvIssueCode[] {
  assert.equal(result.ok, false);
  return result.issues.map((issue) => issue.code);
}

test("CSV-001 parses BOM, CRLF, Korean and a quoted comma", () => {
  const text = "\uFEFFstep_id,step_name,users\r\nlanding,랜딩 방문,2480\r\nstart,\"가입, 시작\",1590\r\nconnect,데이터 연결,842\r\nreport,첫 리포트,611\r\nretain,7일 재방문,421\r\n";
  const result = parseFunnelCsv(csvInput(text));

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, [
    { id: "landing", label: "랜딩 방문", users: 2480 },
    { id: "start", label: "가입, 시작", users: 1590 },
    { id: "connect", label: "데이터 연결", users: 842 },
    { id: "report", label: "첫 리포트", users: 611 },
    { id: "retain", label: "7일 재방문", users: 421 },
  ]);
});

test("CSV-002 rejects an empty file and a missing header", () => {
  assert.deepEqual(issueCodes(parseFunnelCsv(csvInput(""))), ["empty_file"]);
  assert.ok(issueCodes(parseFunnelCsv(csvInput("id,name,count\na,A,10"))).includes("invalid_header"));
});

test("CSV-003 reports malformed quotes with a row", () => {
  const result = parseFunnelCsv(csvInput("step_id,step_name,users\na,\"broken,10"));
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues[0], {
    code: "malformed_csv",
    row: 2,
    column: "step_name",
    message: "닫히지 않은 따옴표가 있습니다.",
  });
});

test("CSV-004 rejects invalid counts, duplicate ids and a non-monotonic funnel", () => {
  const invalidCount = parseFunnelCsv(csvInput("step_id,step_name,users\na,A,10\nb,B,ten"));
  assert.ok(issueCodes(invalidCount).includes("invalid_users"));

  const duplicate = parseFunnelCsv(csvInput("step_id,step_name,users\na,A,10\na,B,9"));
  assert.ok(issueCodes(duplicate).includes("duplicate_step"));

  const increasing = parseFunnelCsv(csvInput("step_id,step_name,users\na,A,10\nb,B,11"));
  assert.ok(issueCodes(increasing).includes("non_monotonic_funnel"));
});

test("CSV-005 rejects disguised files, oversized input and too many rows", () => {
  const wrongExtension = parseFunnelCsv(csvInput("step_id,step_name,users\na,A,10", "funnel.txt"));
  assert.deepEqual(issueCodes(wrongExtension), ["invalid_file_type"]);

  const oversized = parseFunnelCsv({ ...csvInput("step_id,step_name,users\na,A,10"), size: 1_048_577 });
  assert.deepEqual(issueCodes(oversized), ["file_too_large"]);

  const rows = Array.from({ length: 101 }, (_, index) => `s${index},Step ${index},${101 - index}`);
  const tooMany = parseFunnelCsv(csvInput(["step_id,step_name,users", ...rows].join("\n")));
  assert.ok(issueCodes(tooMany).includes("too_many_steps"));
});

test("CSV-006 returns precise row and column metadata", () => {
  const result = parseFunnelCsv(csvInput("step_id,step_name,users\na,,10\nb,B,-1"));
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    { code: "empty_label", row: 2, column: "step_name", message: "단계 이름을 입력하세요." },
    { code: "invalid_users", row: 3, column: "users", message: "사용자 수는 0 이상의 안전한 정수여야 합니다." },
  ]);
});

test("CSV-007 validates file metadata before reading content", () => {
  assert.equal(validateFunnelCsvFile({ fileName: "large.csv", mediaType: "text/csv", size: 1_048_577 })?.code, "file_too_large");
  assert.equal(validateFunnelCsvFile({ fileName: "fake.txt", mediaType: "text/csv", size: 100 })?.code, "invalid_file_type");
  assert.equal(validateFunnelCsvFile({ fileName: "safe.csv", mediaType: "text/csv", size: 100 }), null);
});
