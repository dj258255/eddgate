import { resolve } from "node:path";
import chalk from "chalk";
import { loadAllWorkflows, loadAllRoles } from "../../config/loader.js";

interface ListOptions {
  dir?: string;
}

export async function listCommand(
  type: string,
  options: ListOptions,
): Promise<void> {
  switch (type) {
    case "workflows": {
      const dir = resolve(options.dir ?? "./workflows");
      const workflows = await loadAllWorkflows(dir);

      if (workflows.size === 0) {
        console.log(chalk.dim(`워크플로우 없음 (${dir})`));
        return;
      }

      console.log(chalk.bold(`\n워크플로우 (${dir}):\n`));
      for (const [name, wf] of workflows) {
        console.log(
          `  ${chalk.cyan(name)} — ${wf.name} (${wf.steps.length} steps, ${wf.config.topology})`,
        );
        if (wf.description) {
          console.log(chalk.dim(`    ${wf.description}`));
        }
      }
      break;
    }

    case "roles": {
      const dir = resolve(options.dir ?? "./roles");
      const roles = await loadAllRoles(dir);

      if (roles.size === 0) {
        console.log(chalk.dim(`역할 없음 (${dir})`));
        return;
      }

      console.log(chalk.bold(`\n역할 (${dir}):\n`));
      for (const [id, role] of roles) {
        const tools = role.tools.length
          ? chalk.dim(` [${role.tools.join(", ")}]`)
          : "";
        console.log(`  ${chalk.cyan(id)} — ${role.name}${tools}`);
        if (role.description) {
          console.log(chalk.dim(`    ${role.description}`));
        }
      }
      break;
    }

    default:
      console.error(
        chalk.red(`알 수 없는 타입: ${type}. 사용 가능: workflows, roles`),
      );
      process.exit(1);
  }

  console.log();
}
