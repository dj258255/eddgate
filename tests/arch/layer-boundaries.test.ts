import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Architecture Boundary Tests
 *
 * eddgate layer 구조:
 *   types/   (최하위 -- 아무것도 import 안 함)
 *   trace/   (types만 import)
 *   config/  (types만 import)
 *   eval/    (types, trace, config, core/agent-runner만 import)
 *   core/    (types, trace, config, eval만 import)
 *   i18n/    (독립)
 *   render/  (types, trace만 import -- cli/ import 금지)
 *   cli/     (최상위 -- 모두 import 가능)
 *
 * 금지 규칙:
 *   types/ -> 아무 src/ 모듈도 import 금지
 *   eval/  -> cli/, render/ import 금지
 *   core/  -> cli/, render/ import 금지
 *   render/ -> cli/ import 금지
 *   trace/ -> core/, eval/, cli/, render/ import 금지
 */

const SRC_DIR = path.resolve("src");

function getAllTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  return items.flatMap((item) => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return getAllTsFiles(full);
    return /\.(ts|tsx)$/.test(item.name) ? [full] : [];
  });
}

function getImportedDirs(filePath: string): string[] {
  const text = fs.readFileSync(filePath, "utf8");
  const dirs: string[] = [];
  const regex = /from\s+["'](\.\.\/.+?)["']/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const dirMatch = match[1].match(/^\.\.\/([^/]+)/);
    if (dirMatch) dirs.push(dirMatch[1]);
  }
  return dirs;
}

function checkLayerViolations(
  layerDir: string,
  forbiddenDirs: string[],
): { file: string; forbidden: string }[] {
  const dir = path.join(SRC_DIR, layerDir);
  const files = getAllTsFiles(dir);
  const violations: { file: string; forbidden: string }[] = [];

  for (const file of files) {
    const importedDirs = getImportedDirs(file);
    for (const imp of importedDirs) {
      if (forbiddenDirs.includes(imp)) {
        const relative = path.relative(SRC_DIR, file);
        violations.push({ file: relative, forbidden: imp });
      }
    }
  }

  return violations;
}

describe("architecture layer boundaries", () => {
  it("types/ must not import any other src/ module", () => {
    const violations = checkLayerViolations("types", [
      "core",
      "eval",
      "cli",
      "render",
      "trace",
      "config",
      "i18n",
    ]);
    expect(violations).toEqual([]);
  });

  it("trace/ must not import core/, eval/, cli/, render/", () => {
    const violations = checkLayerViolations("trace", [
      "core",
      "eval",
      "cli",
      "render",
    ]);
    expect(violations).toEqual([]);
  });

  it("eval/ must not import cli/ or render/", () => {
    const violations = checkLayerViolations("eval", ["cli", "render"]);
    expect(violations).toEqual([]);
  });

  it("core/ must not import cli/ or render/", () => {
    const violations = checkLayerViolations("core", ["cli", "render"]);
    expect(violations).toEqual([]);
  });

  it("render/ must not import cli/", () => {
    const violations = checkLayerViolations("render", ["cli"]);
    expect(violations).toEqual([]);
  });
});
