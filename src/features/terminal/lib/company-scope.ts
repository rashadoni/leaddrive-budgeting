/**
 * Which matrix rows does selecting a company in the tree mean?
 *
 * 2026-08-04 audit. Selecting the holding row emptied the HeatMap and Panel 4,
 * and the panel said "Company not in current matrix: AZSEKER." The matrix's row
 * universe is operating companies (`level 2, role 'operational'`) plus
 * sub-groups; a `role: 'holding'` row is in neither list, so filtering rows by
 * `c.code === activeCompanyCode` could never match it.
 *
 * That row is the top of the tree, it is what the terminal's own welcome card
 * tells a first-time user to click ("Panel 1 — Company tree. Click any company
 * to..."), and it is the only row carrying a holding-wide score — 39/97
 * coverage and R66 on production. Clicking the most inviting row emptied the
 * screen and blamed a search box the user had never typed in.
 *
 * A tree selection means "this company and everything under it" — the ordinary
 * meaning of clicking a parent node. Resolved through the real
 * `parentCompanyId` graph rather than by splitting codes on "-", because the
 * hierarchy is data, not a naming convention.
 */

export interface ScopeNode {
  id: string;
  code: string;
  parentCompanyId?: string | null;
  children?: ScopeNode[];
}

/**
 * Every code at or below `code` in the tree. Returns just `code` itself when
 * the tree is unavailable or the code is not in it, so a caller can always use
 * the result as a filter without a null check — an unknown code then scopes to
 * itself, exactly as the old single-code filter did.
 */
export function companyScopeCodes(
  code: string | null | undefined,
  tree: readonly ScopeNode[] | null | undefined,
): ReadonlySet<string> {
  if (!code) return new Set();
  if (!tree || tree.length === 0) return new Set([code]);

  // The API may hand back a nested tree, a flat list, or a mix. Index both ways
  // so neither shape loses descendants.
  const byId = new Map<string, ScopeNode>();
  const childrenByParent = new Map<string, ScopeNode[]>();
  const walk = (nodes: readonly ScopeNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node);
      if (node.parentCompanyId) {
        const siblings = childrenByParent.get(node.parentCompanyId) ?? [];
        siblings.push(node);
        childrenByParent.set(node.parentCompanyId, siblings);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);

  const start = [...byId.values()].find((n) => n.code === code);
  if (!start) return new Set([code]);

  const out = new Set<string>();
  const queue: ScopeNode[] = [start];
  while (queue.length) {
    const node = queue.shift()!;
    if (out.has(node.code)) continue; // a cycle in the data must not hang render
    out.add(node.code);
    for (const child of [
      ...(node.children ?? []),
      ...(childrenByParent.get(node.id) ?? []),
    ]) {
      if (!out.has(child.code)) queue.push(child);
    }
  }
  return out;
}
