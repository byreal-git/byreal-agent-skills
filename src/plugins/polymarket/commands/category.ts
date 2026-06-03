import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { noVisibleCategoriesError } from '../../../core/errors.js';
import { getCategoryTree } from '../api/categoy.js';
import { buildCategoryList } from '../lib/category-view.js';
import { outputPmError, outputPmSuccess, renderCategoryList } from '../formatters.js';

export function createCategoryCommand(): Command {
  const cmd = new Command('category').description('Polymarket categories');

  cmd
    .command('list')
    .description('List Byreal-configured Polymarket categories')
    .action(async (_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const r = await getCategoryTree();
      if (!r.ok) outputPmError(output, r.error);
      if (r.value.length === 0) outputPmError(output, noVisibleCategoriesError());

      outputPmSuccess(output, buildCategoryList(r.value), renderCategoryList, startTime);
    });

  return cmd;
}
