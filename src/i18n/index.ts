import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export type Lang = "ko" | "en";

let currentLang: Lang = "en";
let strings: Record<string, Record<string, string>> = {};

/**
 * Load language from config file, fallback to "en".
 */
export function initLang(configPath?: string): Lang {
  try {
    const raw = readFileSync(resolve(configPath ?? "./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const lang = config.language as string;
    if (lang === "ko" || lang === "en") {
      currentLang = lang;
    }
  } catch {
    // default en
  }

  loadStrings(currentLang);
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  loadStrings(lang);
}

export function getLang(): Lang {
  return currentLang;
}

/**
 * Get a translated string by dot-path.
 * Example: t("menu.run") -> "Run a workflow" or "워크플로우 실행"
 */
export function t(path: string): string {
  const parts = path.split(".");
  let current: unknown = strings;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) return path;
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : path;
}

function findLangFile(lang: Lang): string | null {
  const candidates: string[] = [];

  // 1. import.meta.dirname (Node 21.2+)
  if (import.meta.dirname) {
    candidates.push(join(import.meta.dirname, `${lang}.json`));
  }

  // 2. fileURLToPath fallback (Node 20)
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(dir, `${lang}.json`));
  } catch { /* eval mode -- import.meta.url is undefined */ }

  // 3. src/i18n/ (dev mode with tsx)
  candidates.push(resolve("src/i18n", `${lang}.json`));

  // 4. dist/i18n/ (built mode, cwd = project root)
  candidates.push(resolve("dist/i18n", `${lang}.json`));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function loadStrings(lang: Lang): void {
  const filePath = findLangFile(lang);
  if (filePath) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      strings = JSON.parse(raw);
      return;
    } catch { /* fall through to fallback */ }
  }

  // Fallback: inline minimal strings
  if (lang === "ko") {
    strings = { menu: { whatToDo: "무엇을 하시겠습니까?", exit: "종료", back: "돌아가기", bye: "bye" } };
  } else {
    strings = { menu: { whatToDo: "What do you want to do?", exit: "Exit", back: "Back", bye: "bye" } };
  }
}
