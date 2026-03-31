/**
 * Update command - check for and install updates
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { VERSION } from '../../core/constants.js';
import { checkForUpdate, getInstallCommand } from '../../core/update-check.js';

// ============================================
// Create Update Command
// ============================================

export function createUpdateCommand(): Command {
  const update = new Command('update')
    .description('Check for and install CLI updates');

  // check subcommand
  update
    .command('check')
    .description('Check for available updates')
    .action((_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const result = checkForUpdate(true);
      const installCommand = getInstallCommand(result?.latestVersion);

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: {
            currentVersion: VERSION,
            latestVersion: result?.latestVersion ?? VERSION,
            updateAvailable: result?.updateAvailable ?? false,
            installCommand,
          },
        }, null, 2));
        return;
      }

      if (!result) {
        console.log(chalk.yellow('Could not check for updates (npm registry unavailable or network error).'));
        console.log(chalk.gray(`Current version: ${VERSION}`));
        return;
      }

      if (result.updateAvailable) {
        console.log(chalk.green(`Update available: ${result.currentVersion} → ${result.latestVersion}`));
        console.log(chalk.gray(`Run: ${installCommand}`));
      } else {
        console.log(chalk.green(`Already up to date (v${VERSION})`));
      }
    });

  // install subcommand
  update
    .command('install')
    .description('Install the latest version')
    .action(() => {
      const result = checkForUpdate(true);
      const installCommand = getInstallCommand(result?.latestVersion);

      console.log(chalk.cyan(`Installing latest version from npm registry...`));
      console.log(chalk.gray(`> ${installCommand}\n`));

      try {
        const stdout = execSync(installCommand, {
          encoding: 'utf-8',
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        if (stdout) process.stdout.write(stdout);
        console.log(chalk.green('\nUpdate complete!'));
      } catch (error) {
        const execError = error as { stdout?: string | Buffer; stderr?: string | Buffer };
        if (execError.stdout) process.stdout.write(String(execError.stdout));
        if (execError.stderr) process.stderr.write(String(execError.stderr));
        console.error(chalk.red('\nUpdate failed. Try running manually:'));
        console.error(chalk.gray(`  ${installCommand}`));
        process.exit(1);
      }
    });

  return update;
}
