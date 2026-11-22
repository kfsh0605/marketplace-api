// Записывает раздел в evidence/demos.txt: читает строки из stdin и заменяет раздел "## <имя>"
// (или добавляет его в конец). Так повторный запуск скрипта не плодит дубликаты.
import fs from "node:fs";
import path from "node:path";

const name = process.argv[2];
if (!name) {
  console.error("использование: demos-write.mjs <имя раздела>");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..", "..");
const file = path.join(root, "evidence", "demos.txt");
fs.mkdirSync(path.dirname(file), { recursive: true });

const body = fs.readFileSync(0, "utf8").replace(/\r/g, "").trimEnd();
const section = `## ${name}\n${body}\n`;

const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r/g, "") : "";
const sections = existing
  .split(/^(?=## )/m)
  .map((s) => s.trimEnd() + "\n")
  .filter((s) => s.trim() !== "");
const index = sections.findIndex((s) => s.startsWith(`## ${name}\n`));
if (index >= 0) sections[index] = section;
else sections.push(section);
fs.writeFileSync(file, sections.join("\n"));
