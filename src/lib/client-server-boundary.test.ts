import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/** Return runtime imports only; type-only edges disappear from client output. */
function runtimeImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = []

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause
      const typeOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          clause?.namedBindings != null &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly))
      if (!typeOnly) imports.push(statement.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier != null &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause
      const typeOnly =
        statement.isTypeOnly ||
        (clause != null &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly))
      if (!typeOnly) imports.push(statement.moduleSpecifier.text)
    }
  }

  function collectDynamicImports(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, collectDynamicImports)
  }
  collectDynamicImports(sourceFile)

  return [...new Set(imports)]
}

type DependencyProvider = (file: string) => readonly string[]

/** Multi-source BFS. One visited set is enough because module edges are stable. */
function findRuntimePath(
  roots: readonly string[],
  target: string,
  dependenciesFor: DependencyProvider,
): string[] | null {
  const queue: string[] = []
  const predecessor = new Map<string, string | null>()

  for (const root of roots) {
    if (predecessor.has(root)) continue
    predecessor.set(root, null)
    queue.push(root)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const file = queue[cursor]
    if (file === target) {
      const chain: string[] = []
      let current: string | null = file
      while (current != null) {
        chain.push(current)
        current = predecessor.get(current) ?? null
      }
      return chain.reverse()
    }

    for (const dependency of dependenciesFor(file)) {
      if (predecessor.has(dependency)) continue
      predecessor.set(dependency, file)
      queue.push(dependency)
    }
  }

  return null
}

function isRuntimeSource(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  const segments = relative.split(path.sep)
  if (segments[0] !== "src") return false
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || file.endsWith(".d.ts")) return false
  if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(file)) return false
  return !segments.some((segment) =>
    /^(?:__tests__|__mocks__|tests?)$/.test(segment),
  )
}

/** Match a real directive prologue while allowing comments before it. */
function hasUseClientDirective(source: string): boolean {
  return /^(?:\uFEFF)?(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*(["'])use client\1\s*;?/.test(
    source,
  )
}

interface ProjectRuntimeScanner {
  readonly clientRoots: readonly string[]
  findPath(target: string, roots?: readonly string[]): string[] | null
}

function createProjectRuntimeScanner(root: string): ProjectRuntimeScanner {
  const configPath = path.join(root, "tsconfig.json")
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error != null) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const sourcePaths = parsed.fileNames
    .map((file) => path.resolve(file))
    .filter((file) => isRuntimeSource(root, file))
  const sourceSet = new Set(sourcePaths)
  const sourceCache = new Map<string, string>()
  const dependencyCache = new Map<string, readonly string[]>()
  const moduleResolutionCache = ts.createModuleResolutionCache(
    root,
    (fileName) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    parsed.options,
  )

  const sourceFor = (file: string): string => {
    const cached = sourceCache.get(file)
    if (cached != null) return cached
    const source = fs.readFileSync(file, "utf8")
    sourceCache.set(file, source)
    return source
  }

  const dependenciesFor = (file: string): readonly string[] => {
    const cached = dependencyCache.get(file)
    if (cached != null) return cached

    const sourceFile = ts.createSourceFile(
      file,
      sourceFor(file),
      ts.ScriptTarget.Latest,
      false,
    )
    const dependencies = new Set<string>()
    for (const specifier of runtimeImports(sourceFile)) {
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        parsed.options,
        ts.sys,
        moduleResolutionCache,
      ).resolvedModule
      if (resolved == null) continue
      const dependency = path.resolve(resolved.resolvedFileName)
      if (sourceSet.has(dependency)) dependencies.add(dependency)
    }
    const result = [...dependencies]
    dependencyCache.set(file, result)
    return result
  }

  // Source text is cheap to read once. Parsing and module resolution stay
  // lazy: only modules reachable from one of these client roots enter graph.
  const clientRoots = sourcePaths
    .filter((file) => hasUseClientDirective(sourceFor(file)))
    .sort()

  return {
    clientRoots,
    findPath(target, roots = clientRoots) {
      return findRuntimePath(roots, path.resolve(target), dependenciesFor)
    },
  }
}

let scannerCache: ProjectRuntimeScanner | null = null
function projectScanner(): ProjectRuntimeScanner {
  scannerCache ??= createProjectRuntimeScanner(process.cwd())
  return scannerCache
}

describe("client/server module boundary", () => {
  it("keeps runtime edges while excluding type-only edges", () => {
    const sourceFile = ts.createSourceFile(
      "/virtual/client.tsx",
      [
        '"use client"',
        'import type { ServerType } from "./types"',
        'import { type OtherType } from "./other-types"',
        'export type { ExportedType } from "./exported-types"',
        'export { type NamedExportedType } from "./named-exported-types"',
        'import { runtimeValue, type RuntimeType } from "./runtime"',
        'export { runtimeExport } from "./runtime-export"',
        'const lazy = import("./lazy")',
        'const required = require("./required")',
      ].join("\n"),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    )

    expect(runtimeImports(sourceFile)).toEqual([
      "./runtime",
      "./runtime-export",
      "./lazy",
      "./required",
    ])
  })

  it("keeps test and spec modules out of the runtime graph", () => {
    const root = process.cwd()
    expect(
      isRuntimeSource(root, path.join(root, "src/lib/runtime.ts")),
    ).toBe(true)
    expect(
      isRuntimeSource(root, path.join(root, "src/lib/runtime.test.ts")),
    ).toBe(false)
    expect(
      isRuntimeSource(root, path.join(root, "src/lib/runtime.spec.tsx")),
    ).toBe(false)
    expect(
      isRuntimeSource(root, path.join(root, "src/test/api-harness.ts")),
    ).toBe(false)
  })

  it("reports an in-memory client to forbidden-module chain", () => {
    const client = "/virtual/client.tsx"
    const shared = "/virtual/shared.ts"
    const forbidden = "/virtual/prisma-admin.ts"
    const graph = new Map<string, readonly string[]>([
      [client, [shared]],
      [shared, [forbidden]],
      [forbidden, []],
    ])

    expect(
      findRuntimePath([client], forbidden, (file) => graph.get(file) ?? []),
    ).toEqual([client, shared, forbidden])
  })

  it("detects a known real client dependency chain without fixture files", () => {
    const root = process.cwd()
    const client = path.resolve(root, "src/features/terminal/components/HeatMap.tsx")
    const dependency = path.resolve(
      root,
      "src/features/terminal/components/use-heat-map-model.ts",
    )
    const chain = projectScanner().findPath(dependency, [client])

    expect(chain?.map((file) => path.relative(root, file))).toEqual([
      "src/features/terminal/components/HeatMap.tsx",
      "src/features/terminal/components/use-heat-map-model.ts",
    ])
  })

  it('has no runtime path from a "use client" module to prisma-admin', () => {
    const root = process.cwd()
    const target = path.resolve(root, "src/lib/db/prisma-admin.ts")
    const violation = projectScanner().findPath(target)
    const readableViolation =
      violation?.map((file) => path.relative(root, file)).join(" -> ") ?? null

    expect(readableViolation).toBeNull()
  })
})
