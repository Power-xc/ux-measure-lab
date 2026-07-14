import { createHash, randomBytes } from "node:crypto";

const DEFAULTS = {
  name: "Dogfood",
  project: "local-dogfood",
  origin: "http://localhost:3000",
};

function parseArgs(argv) {
  const values = { ...DEFAULTS };
  const names = new Set(Object.keys(values));
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const next = argv[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!names.has(name) || !next) {
      throw new Error("사용법: node scripts/provision-site.mjs [--name 이름] [--project 프로젝트ID] [--origin Origin]");
    }
    values[name] = next.trim();
  }
  return values;
}

function validate(values) {
  if (!values.name || !values.project) throw new Error("name과 project는 비어 있을 수 없습니다.");
  const origin = new URL(values.origin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== values.origin) {
    throw new Error("origin은 경로가 없는 http(s) Origin이어야 합니다.");
  }
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createSnippet(key) {
  const encodedKey = JSON.stringify(key);
  return `<script>
  (function(w,d,s,k){
    w.ml=w.ml||function(){(w.ml.q=w.ml.q||[]).push(arguments)};
    w.ml.k=k;
    var e=d.createElement(s);e.async=1;e.src="/ml.js";
    var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(e,f);
  })(window,document,"script",${encodedKey});
  ml("init",{requireConsent:true,host:"/api/ingest"});
</script>`;
}

function main() {
  const values = parseArgs(process.argv.slice(2));
  validate(values);
  const key = `umlk_${randomBytes(24).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 13);
  const sql = `insert into sites (project_ref, name, key_hash, key_prefix, allowed_origins)
values (${sqlLiteral(values.project)}, ${sqlLiteral(values.name)}, ${sqlLiteral(hash)}, ${sqlLiteral(prefix)}, array[${sqlLiteral(values.origin)}]);`;

  console.log("사이트 키 (이 출력 이후 복구할 수 없음)");
  console.log(key);
  console.log("\nSupabase SQL");
  console.log(sql);
  console.log("\n설치 스니펫");
  console.log(createSnippet(key));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "사이트 프로비저닝에 실패했습니다.";
  console.error(message);
  process.exitCode = 1;
}
