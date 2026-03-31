/**
 * Stats command - show CLI download statistics from npm Registry
 */

import { Command } from "commander";
import chalk from "chalk";
import { NPM_PACKAGE } from "../../core/constants.js";
import { outputJson } from "../output/formatters.js";

interface NpmDownloads {
  total: number;
  period: string;
}

// ============================================
// Fetch Stats
// ============================================

function fetchNpmDownloads(): NpmDownloads | null {
  try {
    const { execSync } = require("child_process");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startDate = "2026-01-01";
    const result = execSync(
      `curl -sf "https://api.npmjs.org/downloads/point/${startDate}:${today}/${encodeURIComponent(NPM_PACKAGE)}"`,
      { timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const data = JSON.parse(result) as {
      downloads: number;
      start: string;
      end: string;
    };
    return { total: data.downloads, period: `${data.start} ~ ${data.end}` };
  } catch {
    return null;
  }
}

// ============================================
// Create Stats Command
// ============================================

export function createStatsCommand(): Command {
  return new Command("stats")
    .description("Show CLI download statistics from npm")
    .action((_options: Record<string, unknown>, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const outputFormat = globalOptions.output || "table";
      const startTime = Date.now();

      const npmStats = fetchNpmDownloads();

      if (!npmStats) {
        if (outputFormat === "json") {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: {
                  code: "FETCH_FAILED",
                  type: "NETWORK",
                  message: "Failed to fetch download statistics",
                  suggestions: [
                    {
                      action: "retry",
                      description:
                        "Check your network connection and try again",
                    },
                  ],
                },
              },
              null,
              2,
            ),
          );
        } else {
          console.error(chalk.red("Failed to fetch download statistics."));
          console.error(
            chalk.gray("Check your network connection and try again."),
          );
        }
        return;
      }

      if (outputFormat === "json") {
        outputJson(
          {
            totalDownloads: npmStats.total,
            npm: {
              downloads: npmStats.total,
              period: npmStats.period,
            },
          },
          startTime,
        );
        return;
      }

      // Table output
      console.log(chalk.white.bold("\nNPM Registry"));
      console.log(chalk.gray(`  Package: ${NPM_PACKAGE}`));
      console.log(chalk.gray(`  Period: ${npmStats.period}`));
      console.log(chalk.cyan.bold(`  Downloads: ${npmStats.total}`));
      console.log();
    });
}
