import type { CodexChunkType } from "@shared/types";
import type { Node } from "web-tree-sitter";

// ── Parsed output from AST analysis ─────────────────────────────────

export interface ParsedChunk {
  chunkType: CodexChunkType;
  symbolName: string | null;
  lineStart: number;
  lineEnd: number;
  content: string;
  contentHash: string;
  parameters: string[];
  returnType: string | null;
  imports: string[];
  exportType: "default" | "named" | "none";
  isAsync: boolean;
  docstring: string | null;
  children: ParsedChunk[];
}

// ── Language definition interface ────────────────────────────────────

/** Maps a tree-sitter node type to a CodexChunkType. */
export interface NodeMapping {
  nodeType: string;
  chunkType: CodexChunkType;
  /** If true, children of this node are extracted as separate chunks. */
  extractChildren?: boolean;
}

export interface LanguageDefinition {
  /** Language identifier (e.g. "typescript", "python"). */
  name: string;
  /** File extensions this language handles. */
  extensions: string[];
  /** Node types to capture as top-level chunks. */
  topLevelNodes: NodeMapping[];
  /** Node types to capture as child chunks (e.g. methods inside a class). */
  childNodes: NodeMapping[];
  /** Extract symbol name from a captured node. */
  getSymbolName(node: Node): string | null;
  /** Extract parameter list from a function/method node. */
  getParameters(node: Node): string[];
  /** Extract return type annotation from a function/method node. */
  getReturnType(node: Node): string | null;
  /** Check if the node is async. */
  isAsync(node: Node): boolean;
  /** Extract docstring/JSDoc attached to this node. */
  getDocstring(node: Node, source: string): string | null;
  /** Determine export type ("default" | "named" | "none"). */
  getExportType(node: Node): "default" | "named" | "none";
  /** Extract top-level import strings from the full source. */
  getImports(rootNode: Node): string[];
}
