import { execFileSync } from "node:child_process";
import chalk from "chalk";

interface VersionDiffOptions {
  commit?: string;
  paths: string;
}

export async function versionDiffCommand(
  options: VersionDiffOptions,
): Promise<void> {
  const commit = options.commit ?? "HEAD~1";
  const paths = options.paths.split(",").map((p) => p.trim());

  console.log(chalk.bold(`\neddgate version diff\n`));
  console.log(chalk.dim(`  comparing: ${commit} -> HEAD`));
  console.log(chalk.dim(`  paths: ${paths.join(", ")}\n`));

  // Get changed files
  for (const path of paths) {
    try {
      const diff = execFileSync(
        "git",
        ["diff", "--stat", commit, "HEAD", "--", path],
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (diff) {
        console.log(chalk.bold(`  ${path}:`));
        for (const line of diff.split("\n")) {
          console.log(`    ${line}`);
        }
        console.log();
      }
    } catch {
      console.log(chalk.dim(`  ${path}: no changes or not in git`));
    }
  }

  // Show detailed diff for prompts
  for (const path of paths) {
    try {
      const files = execFileSync(
        "git",
        ["diff", "--name-only", commit, "HEAD", "--", path],
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (!files) continue;

      for (const file of files.split("\n").filter(Boolean)) {
        console.log(chalk.bold(`  Changes in ${file}:`));

        const diff = execFileSync(
          "git",
          ["diff", commit, "HEAD", "--", file],
          { encoding: "utf-8", timeout: 5000 },
        ).trim();

        for (const line of diff.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            console.log(chalk.green(`    ${line}`));
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            console.log(chalk.red(`    ${line}`));
          }
        }
        console.log();
      }
    } catch {
      // skip
    }
  }

  // Summary
  try {
    const totalChanges = execFileSync(
      "git",
      [
        "diff",
        "--shortstat",
        commit,
        "HEAD",
        "--",
        ...paths,
      ],
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (totalChanges) {
      console.log(chalk.dim(`  Summary: ${totalChanges}`));
    } else {
      console.log(chalk.dim("  No changes detected."));
    }
  } catch {
    console.log(chalk.dim("  Could not compute summary."));
  }

  console.log();
}
