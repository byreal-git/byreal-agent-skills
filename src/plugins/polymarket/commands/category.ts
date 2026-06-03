import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { emitNotImplemented } from '../formatters.js';

export function createCategoryCommand(): Command {
  const cmd = new Command('category').description('Polymarket categories');

  cmd
    .command('list')
    .description('List Byreal-configured Polymarket categories')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'category list');
    });

  return cmd;
}
