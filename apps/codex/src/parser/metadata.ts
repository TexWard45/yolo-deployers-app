import type { CodexChunkType } from "@shared/types";
import type { LanguageDefinition, Node, NodeMapping, ParsedChunk } from "./types.js";
import { computeHash } from "./chunk-splitter.js";

// ── Chunk extraction ─────────────────────────────────────────────────

/**
 * Extract metadata from a captured AST node and produce a ParsedChunk.
 */
export function extractChunkFromNode(
  node: Node,
  lang: LanguageDefinition,
  source: string,
  chunkType: CodexChunkType,
): ParsedChunk {
  const content = node.text;

  return {
    chunkType,
    symbolName: lang.getSymbolName(node),
    lineStart: node.startPosition.row + 1, // 1-indexed
    lineEnd: node.endPosition.row + 1,
    content,
    contentHash: computeHash(content),
    parameters: lang.getParameters(node),
    returnType: lang.getReturnType(node),
    imports: [], // Imports are collected at file level
    exportType: lang.getExportType(node),
    isAsync: lang.isAsync(node),
    docstring: lang.getDocstring(node, source),
    children: [],
  };
}

/**
 * Walk the AST root and extract all chunks according to the language definition.
 * Handles both top-level nodes and nested children (e.g. methods inside classes).
 */
export function extractChunksFromTree(
  rootNode: Node,
  lang: LanguageDefinition,
  source: string,
): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  const fileImports = lang.getImports(rootNode);

  // Build lookup sets for efficient matching
  const topLevelMap = new Map(
    lang.topLevelNodes.map((n) => [n.nodeType, n]),
  );
  const childMap = new Map(
    lang.childNodes.map((n) => [n.nodeType, n]),
  );

  // Scan direct children of root (top-level declarations)
  for (let i = 0; i < rootNode.childCount; i++) {
    const node = rootNode.child(i);
    if (!node) continue;

    // Check if this is a wrapper (e.g. export_statement in TS)
    const effectiveNode = unwrapExportNode(node, topLevelMap);
    const mapping = topLevelMap.get(effectiveNode.type);

    if (!mapping) continue;

    // For lexical_declaration in TS, skip if it's not a function
    if (effectiveNode.type === "lexical_declaration") {
      const symbolName = lang.getSymbolName(effectiveNode);
      if (!symbolName) continue; // Not a function assignment
    }

    const chunk = extractChunkFromNode(
      effectiveNode,
      lang,
      source,
      mapping.chunkType,
    );
    chunk.imports = fileImports;

    // Extract child nodes (e.g. methods inside a class body)
    if (mapping.extractChildren) {
      const children = extractChildChunks(effectiveNode, lang, source, childMap);
      chunk.children = children;
    }

    chunks.push(chunk);
  }

  return chunks;
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Unwrap export_statement to get the actual declaration node.
 */
function unwrapExportNode(
  node: Node,
  topLevelMap: Map<string, NodeMapping>,
): Node {
  if (node.type === "export_statement") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && topLevelMap.has(child.type)) {
        return child;
      }
    }
  }
  return node;
}

/**
 * Extract child chunks from within a parent node (e.g. methods in a class body).
 */
function extractChildChunks(
  parentNode: Node,
  lang: LanguageDefinition,
  source: string,
  childMap: Map<string, NodeMapping>,
): ParsedChunk[] {
  const children: ParsedChunk[] = [];

  function walk(node: Node): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      const mapping = childMap.get(child.type);
      if (mapping) {
        children.push(
          extractChunkFromNode(child, lang, source, mapping.chunkType),
        );
      } else {
        // Recurse into block/body nodes to find nested declarations
        if (
          child.type === "class_body" ||
          child.type === "statement_block" ||
          child.type === "block" ||
          child.type === "declaration_list" ||
          child.type === "field_declaration_list"
        ) {
          walk(child);
        }
      }
    }
  }

  walk(parentNode);
  return children;
}
