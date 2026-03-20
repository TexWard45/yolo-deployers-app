import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { Parser, Language } from "web-tree-sitter";
import type { ParsedChunk } from "./types.js";
import { getLanguageDefinition, getGrammarName } from "./languages/index.js";
import { extractChunksFromTree } from "./metadata.js";
import { splitLargeChunks } from "./chunk-splitter.js";

// ── WASM initialization ──────────────────────────────────────────────

let initialized = false;
const loadedLanguages = new Map<string, Language>();

/**
 * Initialize web-tree-sitter WASM runtime. Must be called once before parsing.
 */
export async function initTreeSitter(): Promise<void> {
  if (initialized) return;

  // web-tree-sitter ships its own .wasm file. Locate it from node_modules.
  const wasmPath = resolveWasmPath("web-tree-sitter", "tree-sitter.wasm");
  if (wasmPath) {
    await Parser.init({
      locateFile: () => wasmPath,
    });
  } else {
    await Parser.init();
  }

  initialized = true;
}

/**
 * Load a tree-sitter grammar WASM for a given language.
 * Searches standard locations in node_modules.
 */
export async function loadLanguageGrammar(
  language: string,
): Promise<Language> {
  const grammarName = getGrammarName(language);
  if (!grammarName) {
    throw new Error(`Unsupported language: ${language}`);
  }

  const cached = loadedLanguages.get(grammarName);
  if (cached) return cached;

  const wasmFileName = `tree-sitter-${grammarName}.wasm`;

  // Search for WASM in common locations
  const searchPaths = [
    // WASM files directory (project-level)
    resolve(process.cwd(), "grammars", wasmFileName),
    // node_modules of the language package
    resolveWasmPath(`tree-sitter-${grammarName}`, wasmFileName),
    // Monorepo root node_modules
    resolve(
      process.cwd(),
      "..",
      "..",
      "node_modules",
      `tree-sitter-${grammarName}`,
      wasmFileName,
    ),
    // Codex app local
    resolve(
      process.cwd(),
      "node_modules",
      `tree-sitter-${grammarName}`,
      wasmFileName,
    ),
  ].filter((p): p is string => p !== null);

  for (const path of searchPaths) {
    if (existsSync(path)) {
      const lang = await Language.load(path);
      loadedLanguages.set(grammarName, lang);
      return lang;
    }
  }

  throw new Error(
    `WASM grammar not found for ${grammarName}. ` +
      `Searched: ${searchPaths.join(", ")}. ` +
      `Run the grammar build script or place ${wasmFileName} in the grammars/ directory.`,
  );
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Parse a source file into semantically meaningful chunks.
 *
 * @param content  - Raw file content.
 * @param language - Language name or file extension (e.g. "typescript", ".py").
 * @returns Array of ParsedChunk with full metadata, hierarchy, and content hashes.
 */
export async function parseFile(
  content: string,
  language: string,
): Promise<ParsedChunk[]> {
  await initTreeSitter();

  const langDef = getLanguageDefinition(language);
  if (!langDef) {
    // Unsupported language → return empty (file will be skipped)
    return [];
  }

  const grammar = await loadLanguageGrammar(language);
  const parser = new Parser();
  parser.setLanguage(grammar);

  const tree = parser.parse(content);
  if (!tree) return [];

  const chunks = extractChunksFromTree(tree.rootNode, langDef, content);

  // Split oversized chunks into fragments
  const processed = splitLargeChunks(chunks);

  // Clean up
  tree.delete();
  parser.delete();

  return processed;
}

/**
 * Check if a language is supported by the parser.
 */
export function isLanguageSupported(language: string): boolean {
  return getLanguageDefinition(language) !== null;
}

// ── Internal helpers ─────────────────────────────────────────────────

function resolveWasmPath(
  packageName: string,
  fileName: string,
): string | null {
  try {
    const possiblePaths = [
      join("node_modules", packageName, fileName),
      join("..", "..", "node_modules", packageName, fileName),
    ];

    for (const p of possiblePaths) {
      const resolved = resolve(process.cwd(), p);
      if (existsSync(resolved)) return resolved;
    }
    return null;
  } catch {
    return null;
  }
}
