import * as p from "@clack/prompts";
import { readdirSync, statSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";

/**
 * Interactive file picker with folder navigation.
 * Uses @clack/prompts select.
 */
export async function pickFile(
  startDir: string,
  lang: "ko" | "en" = "ko",
): Promise<string | null> {
  let currentDir = resolve(startDir);

  const labels = {
    ko: {
      selectFile: "파일 또는 폴더를 선택하세요",
      parentDir: ".. (상위 폴더)",
      cancelled: "취소됨",
    },
    en: {
      selectFile: "Select a file or folder",
      parentDir: ".. (parent folder)",
      cancelled: "Cancelled",
    },
  };
  const t = labels[lang];

  while (true) {
    const entries = listDirectory(currentDir);

    const options: Array<{ value: string; label: string; hint?: string }> = [];

    // Parent directory
    const parent = dirname(currentDir);
    if (parent !== currentDir) {
      options.push({
        value: "__PARENT__",
        label: t.parentDir,
        hint: basename(parent),
      });
    }

    // Directories first, then files
    const dirs = entries.filter((e) => e.isDir);
    const files = entries.filter((e) => !e.isDir);

    for (const dir of dirs) {
      options.push({
        value: join(currentDir, dir.name),
        label: `${dir.name}/`,
        hint: "folder",
      });
    }

    for (const file of files) {
      options.push({
        value: join(currentDir, file.name),
        label: file.name,
        hint: formatSize(file.size),
      });
    }

    if (options.length === 0) {
      p.log.warn(lang === "ko" ? "빈 디렉토리입니다." : "Empty directory.");
      return null;
    }

    p.log.info(currentDir);

    const selected = await p.select({
      message: t.selectFile,
      options,
    });

    if (p.isCancel(selected)) {
      return null;
    }

    const selectedPath = selected as string;

    if (selectedPath === "__PARENT__") {
      currentDir = parent;
      continue;
    }

    try {
      const stat = statSync(selectedPath);
      if (stat.isDirectory()) {
        currentDir = selectedPath;
        continue;
      }
      // File selected
      return selectedPath;
    } catch {
      return selectedPath;
    }
  }
}

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

function listDirectory(dir: string): DirEntry[] {
  try {
    const entries = readdirSync(dir);
    return entries
      .filter((name) => !name.startsWith(".") && name !== "node_modules" && name !== "dist")
      .map((name) => {
        try {
          const stat = statSync(join(dir, name));
          return { name, isDir: stat.isDirectory(), size: stat.size };
        } catch {
          return { name, isDir: false, size: 0 };
        }
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 30);
  } catch {
    return [];
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
