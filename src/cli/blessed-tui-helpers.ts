// Re-export MCP and Config managers for blessed TUI
// These use @clack/prompts and are called when blessed screen is destroyed

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export async function tuiMcpManager(p: typeof import("@clack/prompts")): Promise<void> {
  const configPath = resolve("./eddgate.config.yaml");

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    config = (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch { /* no config */ }

  const mcp = (config.mcp as { servers?: Array<Record<string, unknown>> }) ?? { servers: [] };
  if (!mcp.servers) mcp.servers = [];

  const action = await p.select({
    message: "MCP servers",
    options: [
      { value: "list", label: `List servers (${mcp.servers.length})` },
      { value: "add", label: "Add new server" },
      { value: "remove", label: "Remove server" },
    ],
  });
  if (p.isCancel(action)) return;

  if (action === "list") {
    if (mcp.servers.length === 0) {
      p.log.info("No MCP servers configured.");
    } else {
      for (const s of mcp.servers) {
        p.log.info(`${s.name} (${s.transport}) -- ${s.command ?? s.url ?? ""}`);
      }
    }
    return;
  }

  if (action === "add") {
    const name = await p.text({ message: "Server name" });
    if (p.isCancel(name)) return;

    const transport = await p.select({
      message: "Transport",
      options: [
        { value: "stdio", label: "stdio" },
        { value: "http", label: "http" },
        { value: "sse", label: "sse" },
      ],
    });
    if (p.isCancel(transport)) return;

    let target: string | symbol;
    if (transport === "stdio") {
      target = await p.text({ message: "Command" });
    } else {
      target = await p.text({ message: "URL" });
    }
    if (p.isCancel(target)) return;

    const server: Record<string, unknown> = { name: name as string, transport: transport as string };
    if (transport === "stdio") server.command = target as string;
    else server.url = target as string;

    mcp.servers.push(server);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Added: ${name as string}`);
    return;
  }

  if (action === "remove" && mcp.servers.length > 0) {
    const toRemove = await p.select({
      message: "Remove which?",
      options: mcp.servers.map((s) => ({ value: s.name as string, label: `${s.name} (${s.transport})` })),
    });
    if (p.isCancel(toRemove)) return;

    mcp.servers = mcp.servers.filter((s) => s.name !== toRemove);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Removed: ${toRemove as string}`);
  }
}

export async function tuiConfigManager(p: typeof import("@clack/prompts")): Promise<void> {
  const configPath = resolve("./eddgate.config.yaml");

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    config = (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    p.log.warn("No config file found. Run: eddgate init");
    return;
  }

  const model = (config.model as Record<string, unknown>) ?? { default: "sonnet" };

  const setting = await p.select({
    message: "Settings",
    options: [
      { value: "model", label: `Default model: ${model.default ?? "sonnet"}` },
      { value: "language", label: `Language: ${(config.language as string) === "ko" ? "한국어" : "English"}` },
      { value: "view", label: "View current config" },
    ],
  });
  if (p.isCancel(setting)) return;

  if (setting === "model") {
    const { MODELS } = await import("./models.js");
    const newModel = await p.select({
      message: "Default model",
      options: MODELS.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
    });
    if (p.isCancel(newModel)) return;

    model.default = newModel as string;
    config.model = model;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Model: ${newModel as string}`);
    return;
  }

  if (setting === "language") {
    const newLang = await p.select({
      message: "Language",
      options: [
        { value: "ko", label: "한국어" },
        { value: "en", label: "English" },
      ],
    });
    if (p.isCancel(newLang)) return;

    config.language = newLang as string;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(newLang === "ko" ? "한국어로 설정됨" : "Set to English");
    return;
  }

  if (setting === "view") {
    const raw = await readFile(configPath, "utf-8");
    p.log.info(raw);
  }
}
