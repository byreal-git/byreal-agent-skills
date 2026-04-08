/**
 * Update command - check for and install updates
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { VERSION } from '../../core/constants.js';
import { checkForUpdate, getInstallCommand } from '../../core/update-check.js';
import { isAutoUpdateEnabled, suppressAutoUpdate } from '../../core/auto-updater.js';

const SCOPED_PACKAGE = '@byreal-io/byreal-cli';
const LEGACY_PACKAGE = 'byreal-cli';

interface ExecErrorLike {
  message?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function normalizeOutput(value: string | Buffer | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toString('utf-8');
}

function runCommand(command: string): { success: true } | { success: false; output: string } {
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (stdout) process.stdout.write(stdout);
    return { success: true };
  } catch (error) {
    const execError = error as ExecErrorLike;
    const stdout = normalizeOutput(execError.stdout);
    const stderr = normalizeOutput(execError.stderr);
    const message = execError.message ?? '';

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    return {
      success: false,
      output: [message, stdout, stderr].filter(Boolean).join('\n'),
    };
  }
}

function isLegacyBinaryConflict(output: string, installCommand: string): boolean {
  if (!installCommand.includes(SCOPED_PACKAGE)) return false;
  const lower = output.toLowerCase();
  return output.includes('EEXIST')
    && (lower.includes('/bin/byreal-cli') || lower.includes('file exists'));
}

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

      const autoUpdateEnabled = isAutoUpdateEnabled();

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: {
            currentVersion: VERSION,
            latestVersion: result?.latestVersion ?? VERSION,
            updateAvailable: result?.updateAvailable ?? false,
            autoUpdateEnabled,
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
        if (autoUpdateEnabled) {
          console.log(chalk.gray('Auto-update is enabled. The update will install automatically.'));
        } else {
          console.log(chalk.gray(`Run: ${installCommand}`));
        }
      } else {
        console.log(chalk.green(`Already up to date (v${VERSION})`));
      }
    });

  // install subcommand
  update
    .command('install')
    .description('Install the latest version')
    .action(() => {
      suppressAutoUpdate();
      const result = checkForUpdate(true);
      const installCommand = getInstallCommand(result?.latestVersion);

      console.log(chalk.cyan(`Installing latest version from npm registry...`));
      console.log(chalk.gray(`> ${installCommand}\n`));

      const installResult = runCommand(installCommand);
      if (installResult.success) {
        console.log(chalk.green('\nUpdate complete!'));
        return;
      }

      // TODO(v0.3.x): Remove this migration fallback after all users are off the legacy package name.
      if (isLegacyBinaryConflict(installResult.output, installCommand)) {
        console.log(chalk.yellow('\nDetected legacy global installation conflict.'));
        console.log(chalk.yellow('Attempting automatic migration from `byreal-cli` to `@byreal-io/byreal-cli`...\n'));

        const uninstallCommand = `npm uninstall -g ${LEGACY_PACKAGE}`;
        console.log(chalk.gray(`> ${uninstallCommand}`));
        const uninstallResult = runCommand(uninstallCommand);
        if (!uninstallResult.success) {
          console.log(chalk.gray('Legacy uninstall did not fully succeed; retrying install anyway.\n'));
        }

        console.log(chalk.gray(`> ${installCommand}\n`));
        const retryResult = runCommand(installCommand);
        if (retryResult.success) {
          console.log(chalk.green('\nUpdate complete!'));
          return;
        }
      }

      console.error(chalk.red('\nUpdate failed. Try running manually:'));
      console.error(chalk.gray(`  npm uninstall -g ${LEGACY_PACKAGE}`));
      console.error(chalk.gray(`  ${installCommand}`));
      process.exit(1);
    });

  return update;
}
