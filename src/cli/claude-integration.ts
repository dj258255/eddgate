import { readFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";

/**
 * Read Claude Code's installed plugins and MCP servers.
 * Integrates with ~/.claude/ directory structure.
 */

export interface ClaudePlugin {
  name: string;
  scope: string;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
}

export interface ClaudeMcpServer {
  name: string;
  type: string;
  command?: string;
  url?: string;
  args?: string[];
}

/**
 * Read installed Claude Code plugins from ~/.claude/plugins/installed_plugins.json
 */
export async function getClaudePlugins(): Promise<ClaudePlugin[]> {
  const plugins: ClaudePlugin[] = [];

  try {
    const configPath = join(homedir(), ".claude", "plugins", "installed_plugins.json");
    const raw = await readFile(configPath, "utf-8");
    const data = JSON.parse(raw) as {
      plugins: Record<string, Array<{
        scope: string;
        installPath: string;
        installedAt: string;
        lastUpdated: string;
      }>>;
    };

    for (const [name, installs] of Object.entries(data.plugins)) {
      for (const install of installs) {
        plugins.push({
          name: name.split("@")[0],
          scope: install.scope,
          installPath: install.installPath,
          installedAt: install.installedAt,
          lastUpdated: install.lastUpdated,
        });
      }
    }
  } catch {
    // No plugins or file not found
  }

  return plugins;
}

/**
 * Read MCP servers from project .mcp.json or ~/.claude/mcp.json
 */
export async function getClaudeMcpServers(): Promise<ClaudeMcpServer[]> {
  const servers: ClaudeMcpServer[] = [];

  // Project-level .mcp.json
  for (const path of [".mcp.json", join(homedir(), ".claude", "mcp.json")]) {
    try {
      const raw = await readFile(resolve(path), "utf-8");
      const data = JSON.parse(raw) as Record<string, {
        type?: string;
        command?: string;
        url?: string;
        args?: string[];
      }>;

      for (const [name, config] of Object.entries(data)) {
        servers.push({
          name,
          type: config.type ?? "stdio",
          command: config.command,
          url: config.url,
          args: config.args,
        });
      }
    } catch {
      // File not found
    }
  }

  return servers;
}

/**
 * Format plugin info for display.
 */
export function formatPluginList(plugins: ClaudePlugin[]): string {
  if (plugins.length === 0) return "  No Claude Code plugins installed.";

  return plugins.map((p) => {
    const updated = new Date(p.lastUpdated).toLocaleDateString();
    return `  {cyan-fg}${p.name}{/cyan-fg}  {gray-fg}(${p.scope}, updated ${updated}){/gray-fg}`;
  }).join("\n");
}

/**
 * Format MCP server info for display.
 */
export function formatMcpList(servers: ClaudeMcpServer[]): string {
  if (servers.length === 0) return "  No MCP servers found.";

  return servers.map((s) => {
    const target = s.command
      ? `${s.command}${s.args?.length ? " " + s.args.join(" ") : ""}`
      : s.url ?? "";
    return `  {magenta-fg}${s.name}{/magenta-fg} (${s.type})\n    {gray-fg}${target}{/gray-fg}`;
  }).join("\n\n");
}
