import blessed from "neo-blessed";
import { readdirSync, statSync } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";

/**
 * Blessed-native file browser.
 * Navigate folders, select files, go up with ".."
 */
export function blessedFileBrowser(
  screen: any,
  options?: { startDir?: string; label?: string },
): Promise<string | null> {
  return new Promise((res) => {
    let currentDir = resolve(options?.startDir ?? ".");

    const box = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "70%",
      height: "70%",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      label: ` ${options?.label ?? "Select File"} `,
    });

    const pathDisplay = blessed.box({
      parent: box,
      top: 0,
      left: 1,
      width: "100%-4",
      height: 1,
      tags: true,
    });

    const list = blessed.list({
      parent: box,
      top: 1,
      left: 0,
      width: "100%-2",
      height: "100%-4",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "cyan", fg: "black", bold: true },
        item: { fg: "white" },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "cyan" } },
    });

    const hint = blessed.box({
      parent: box,
      bottom: 0,
      left: 1,
      width: "100%-4",
      height: 1,
      tags: true,
      content: "{gray-fg}Enter: open/select  Esc: cancel{/gray-fg}",
    });

    function render(): void {
      pathDisplay.setContent(`{gray-fg}${currentDir}{/gray-fg}`);

      const entries = listDir(currentDir);
      const items: string[] = [];

      // Parent
      const parent = dirname(currentDir);
      if (parent !== currentDir) {
        items.push("{yellow-fg}  ..  (parent){/yellow-fg}");
      }

      // Dirs first
      for (const e of entries.filter((e) => e.isDir)) {
        items.push(`{cyan-fg}  ${e.name}/{/cyan-fg}`);
      }

      // Files
      for (const e of entries.filter((e) => !e.isDir)) {
        const size = formatSize(e.size);
        items.push(`  ${e.name}  {gray-fg}${size}{/gray-fg}`);
      }

      list.setItems(items);
      list.select(0);
      list.focus();
      screen.render();
    }

    list.on("select", (_el: any, index: number) => {
      const parent = dirname(currentDir);
      const hasParent = parent !== currentDir;
      const adjustedIndex = hasParent ? index - 1 : index;

      // Parent dir
      if (hasParent && index === 0) {
        currentDir = parent;
        render();
        return;
      }

      const entries = listDir(currentDir);
      const dirs = entries.filter((e) => e.isDir);
      const files = entries.filter((e) => !e.isDir);

      if (adjustedIndex < dirs.length) {
        // Enter directory
        currentDir = join(currentDir, dirs[adjustedIndex].name);
        render();
        return;
      }

      // Select file
      const fileIndex = adjustedIndex - dirs.length;
      if (fileIndex >= 0 && fileIndex < files.length) {
        const filePath = join(currentDir, files[fileIndex].name);
        box.destroy();
        screen.render();
        res(filePath);
      }
    });

    list.key(["escape"], () => {
      box.destroy();
      screen.render();
      res(null);
    });

    render();
  });
}

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

function listDir(dir: string): DirEntry[] {
  try {
    return readdirSync(dir)
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
      .slice(0, 50);
  } catch {
    return [];
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
