import type { LanguageDefinition } from "../types.js";
import { typescriptLanguage } from "./typescript.js";
import { pythonLanguage } from "./python.js";
import { goLanguage } from "./go.js";
import { javaLanguage } from "./java.js";
import { rustLanguage } from "./rust.js";

// ── Language registry ────────────────────────────────────────────────

const languageByName = new Map<string, LanguageDefinition>([
  ["typescript", typescriptLanguage],
  ["tsx", typescriptLanguage],
  ["javascript", typescriptLanguage],
  ["jsx", typescriptLanguage],
  ["python", pythonLanguage],
  ["go", goLanguage],
  ["java", javaLanguage],
  ["rust", rustLanguage],
]);

const languageByExtension = new Map<string, LanguageDefinition>();
for (const lang of [
  typescriptLanguage,
  pythonLanguage,
  goLanguage,
  javaLanguage,
  rustLanguage,
]) {
  for (const ext of lang.extensions) {
    languageByExtension.set(ext, lang);
  }
}

/**
 * Resolve a LanguageDefinition by language name or file extension.
 * Returns null if the language is not supported.
 */
export function getLanguageDefinition(
  nameOrExtension: string,
): LanguageDefinition | null {
  // Try direct name lookup first
  const byName = languageByName.get(nameOrExtension.toLowerCase());
  if (byName) return byName;

  // Try extension (ensure it starts with a dot)
  const ext = nameOrExtension.startsWith(".")
    ? nameOrExtension.toLowerCase()
    : `.${nameOrExtension.toLowerCase()}`;
  return languageByExtension.get(ext) ?? null;
}

/**
 * Returns the tree-sitter grammar name needed for WASM loading.
 * Tree-sitter grammars don't always match our language names.
 */
export function getGrammarName(language: string): string | null {
  const mapping: Record<string, string> = {
    typescript: "typescript",
    tsx: "tsx",
    javascript: "javascript",
    jsx: "javascript",
    python: "python",
    go: "go",
    java: "java",
    rust: "rust",
  };
  return mapping[language.toLowerCase()] ?? null;
}

/** All supported language names. */
export const supportedLanguages = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "go",
  "java",
  "rust",
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];
