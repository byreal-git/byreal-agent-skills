/**
 * Stats command - show CLI download statistics from GitHub Releases + npm Registry
 */

import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { GITHUB_REPO, TABLE_CHARS } from "../../core/constants.js";
import { outputJson } from "../output/formatters.js";

// ============================================
// Types
// ============================================

interface ReleaseStats {
  version: string;
  publishedAt: string;
  downloads: number;
}

interface NpmDownloads {
  total: number;
  period: string;
}

const NPM_PACKAGE = "@byreal-io/byreal-cli";

// ============================================
// Fetch Release Stats
// ============================================

function fetchGitHubStats(): ReleaseStats[] | null {
  try {
    const { execSync } = require("child_process");
    const result = execSync(
      `curl -sf -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${GITHUB_REPO}/releases"`,
      { timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const releases = JSON.parse(result) as Array<{
      tag_name: string;
      published_at: string;
      assets: Array<{ download_count: number }>;
    }>;

    return releases.map((release) => ({
      version: release.tag_name,
      publishedAt: release.published_at.slice(0, 10),
      downloads: release.assets.reduce(
        (sum, asset) => sum + asset.download_count,
        0,
      ),
    }));
  } catch {
    return null;
  }
}

function fetchNpmDownloads(): NpmDownloads | null {
  try {
    const { execSync } = require("child_process");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const start = new Date(now);
    start.setMonth(start.getMonth() - 18);
    const startDate = start.toISOString().slice(0, 10);
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
    .description("Show CLI download statistics from GitHub Releases and npm")
    .option("--detail", "Show per-version download breakdown")
    .action((options: { detail?: boolean }, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const outputFormat = globalOptions.output || "table";
      const startTime = Date.now();

      const githubStats = fetchGitHubStats();
      const npmStats = fetchNpmDownloads();

      if (!githubStats && !npmStats) {
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

      const githubTotal =
        githubStats?.reduce((sum, r) => sum + r.downloads, 0) ?? 0;
      const npmTotal = npmStats?.total ?? 0;
      const totalDownloads = githubTotal + npmTotal;

      if (outputFormat === "json") {
        const jsonData: Record<string, unknown> = {
          totalDownloads,
          github: {
            downloads: githubTotal,
            ...(options.detail && githubStats ? { releases: githubStats } : {}),
          },
          npm: {
            downloads: npmTotal,
            ...(npmStats ? { period: npmStats.period } : {}),
          },
        };
        outputJson(jsonData, startTime);
        return;
      }

      // Table output
      if (options.detail) {
        console.log(chalk.white.bold("\nGitHub Releases"));
        if (githubStats) {
          const table = new Table({
            head: [
              chalk.cyan.bold("Version"),
              chalk.cyan.bold("Published"),
              chalk.cyan.bold("Downloads"),
            ],
            chars: TABLE_CHARS,
            style: {
              head: [],
              border: [],
              "padding-left": 1,
              "padding-right": 1,
            },
          });

          for (const release of githubStats) {
            table.push([
              chalk.white(release.version),
              chalk.gray(release.publishedAt),
              String(release.downloads),
            ]);
          }

          console.log(table.toString());
          console.log(chalk.gray(`  Subtotal: ${githubTotal}`));
        } else {
          console.log(chalk.gray("  Unavailable"));
        }

        console.log(chalk.white.bold("\nnpm Registry"));
        if (npmStats) {
          console.log(chalk.gray(`  Period: ${npmStats.period}`));
          console.log(chalk.gray(`  Subtotal: ${npmTotal}`));
        } else {
          console.log(chalk.gray("  Not yet published or no downloads"));
        }
      }

      console.log(chalk.cyan.bold(`\nTotal Downloads: ${totalDownloads}`));
      if (options.detail || outputFormat === "table") {
        const parts: string[] = [];
        if (githubTotal > 0) parts.push(`GitHub ${githubTotal}`);
        if (npmTotal > 0) parts.push(`npm ${npmTotal}`);
        if (parts.length === 2) {
          console.log(chalk.gray(`  (${parts.join(" + ")})`));
        }
      }
      console.log();
    });
}
