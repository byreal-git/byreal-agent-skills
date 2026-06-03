/**
 * Pure transform: category tree → PRD category.list shape.
 */

import type { CategoryNode } from '../api/categoy.js';

export interface CategoryListItem {
  category_id: string;
  display_name: string;
  category_type: string | null;
  market_types: Array<{ id: number; name: string }>;
}

export function buildCategoryList(tree: CategoryNode[]): { categories: CategoryListItem[] } {
  const categories = tree.map((c) => ({
    category_id: String(c.id),
    display_name: c.categoryName,
    category_type: c.categoryType ?? null,
    market_types: (c.marketTypes ?? []).map((mt) => ({ id: mt.id, name: mt.marketType })),
  }));
  return { categories };
}
