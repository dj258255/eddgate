import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import chalk from "chalk";

interface McpOptions {
  config: string;
}

export async function mcpCommand(
  action: string,
  options: McpOptions,
  args?: string[],
): Promise<void> {
  const configPath = resolve(options.config);

  switch (action) {
    case "list":
      await mcpList(configPath);
      break;
    case "add":
      if (!args || args.length < 2) {
        console.error(
          chalk.red("Usage: eddgate mcp add <name> <transport> [command-or-url]"),
        );
        process.exit(1);
      }
      await mcpAdd(configPath, args[0], args[1], args[2]);
      break;
    case "remove":
      if (!args || args.length < 1) {
        console.error(chalk.red("Usage: eddgate mcp remove <name>"));
        process.exit(1);
      }
      await mcpRemove(configPath, args[0]);
      break;
    default:
      console.error(
        chalk.red(`Unknown action: ${action}. Use: list, add, remove`),
      );
      process.exit(1);
  }
}

async function loadConfig(
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf-8");
    return (parseYaml(content) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function saveConfig(
  path: string,
  config: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, stringifyYaml(config), "utf-8");
}

async function mcpList(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const mcp = config.mcp as { servers?: Array<Record<string, unknown>> } | undefined;
  const servers = mcp?.servers ?? [];

  if (servers.length === 0) {
    console.log(chalk.dim("\nNo MCP servers configured.\n"));
    console.log(chalk.dim("Add one: eddgate mcp add <name> <transport> [command]"));
    return;
  }

  console.log(chalk.bold(`\nMCP Servers (${servers.length}):\n`));

  for (const server of servers) {
    const transport = server.transport ?? "?";
    const target = server.command ?? server.url ?? "-";
    const roles = (server.allowedRoles as string[])?.join(", ") ?? "all";

    console.log(`  ${chalk.cyan(String(server.name))} (${transport})`);
    console.log(chalk.dim(`    ${target}`));
    if (roles !== "all") {
      console.log(chalk.dim(`    roles: ${roles}`));
    }
  }

  console.log();
}

async function mcpAdd(
  configPath: string,
  name: string,
  transport: string,
  commandOrUrl?: string,
): Promise<void> {
  const config = await loadConfig(configPath);

  if (!config.mcp) config.mcp = { servers: [] };
  const mcp = config.mcp as { servers: Array<Record<string, unknown>> };
  if (!mcp.servers) mcp.servers = [];

  // Check if already exists
  if (mcp.servers.some((s) => s.name === name)) {
    console.error(chalk.red(`MCP server "${name}" already exists.`));
    process.exit(1);
  }

  const server: Record<string, unknown> = { name, transport };

  if (transport === "stdio" && commandOrUrl) {
    server.command = commandOrUrl;
  } else if ((transport === "http" || transport === "sse") && commandOrUrl) {
    server.url = commandOrUrl;
  }

  mcp.servers.push(server);
  await saveConfig(configPath, config);

  console.log(chalk.green(`Added MCP server: ${name} (${transport})`));
}

async function mcpRemove(
  configPath: string,
  name: string,
): Promise<void> {
  const config = await loadConfig(configPath);
  const mcp = config.mcp as { servers?: Array<Record<string, unknown>> } | undefined;

  if (!mcp?.servers) {
    console.error(chalk.red(`MCP server "${name}" not found.`));
    process.exit(1);
  }

  const before = mcp.servers.length;
  mcp.servers = mcp.servers.filter((s) => s.name !== name);

  if (mcp.servers.length === before) {
    console.error(chalk.red(`MCP server "${name}" not found.`));
    process.exit(1);
  }

  await saveConfig(configPath, config);
  console.log(chalk.green(`Removed MCP server: ${name}`));
}
