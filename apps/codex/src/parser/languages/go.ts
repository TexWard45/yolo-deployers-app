import type { Node } from "web-tree-sitter";
import type { LanguageDefinition, NodeMapping } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

function findChildByField(node: Node, field: string): Node | null {
  return node.childForFieldName(field);
}

// ── Node mappings ────────────────────────────────────────────────────

const topLevelNodes: NodeMapping[] = [
  { nodeType: "function_declaration", chunkType: "FUNCTION" },
  { nodeType: "method_declaration", chunkType: "METHOD" },
  { nodeType: "type_declaration", chunkType: "TYPE" },
];

const childNodes: NodeMapping[] = [
  // Go doesn't nest functions inside types in the AST — methods are top-level
];

// ── Language definition ──────────────────────────────────────────────

export const goLanguage: LanguageDefinition = {
  name: "go",
  extensions: [".go"],

  topLevelNodes,
  childNodes,

  getSymbolName(node: Node): string | null {
    if (node.type === "type_declaration") {
      const spec = findChild(node, "type_spec");
      if (spec) return findChildByField(spec, "name")?.text ?? null;
      return null;
    }
    return findChildByField(node, "name")?.text ?? null;
  },

  getParameters(node: Node): string[] {
    const params =
      findChildByField(node, "parameters") ??
      findChild(node, "parameter_list");
    if (!params) return [];

    return params.children
      .filter((c) => c.type === "parameter_declaration")
      .map((c) => c.text);
  },

  getReturnType(node: Node): string | null {
    const result = findChildByField(node, "result");
    if (result) return result.text;
    return null;
  },

  isAsync(): boolean {
    // Go doesn't have async/await syntax
    return false;
  },

  getDocstring(node: Node): string | null {
    // Go uses preceding line comments as documentation
    const prev = node.previousNamedSibling;
    if (!prev) return null;

    if (prev.type === "comment") {
      return prev.text;
    }
    return null;
  },

  getExportType(node: Node): "default" | "named" | "none" {
    // In Go, exported symbols start with uppercase
    let name: string | null = null;

    if (node.type === "type_declaration") {
      const spec = findChild(node, "type_spec");
      name = spec ? (findChildByField(spec, "name")?.text ?? null) : null;
    } else {
      name = findChildByField(node, "name")?.text ?? null;
    }

    if (
      name &&
      name.length > 0 &&
      name[0] === name[0]!.toUpperCase() &&
      name[0] !== name[0]!.toLowerCase()
    ) {
      return "named";
    }
    return "none";
  },

  getImports(rootNode: Node): string[] {
    const imports: string[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;

      if (child.type === "import_declaration") {
        // Single import or import block
        const spec = findChild(child, "import_spec");
        if (spec) {
          const path = findChild(spec, "interpreted_string_literal");
          if (path) imports.push(path.text.replace(/"/g, ""));
        }
        const specList = findChild(child, "import_spec_list");
        if (specList) {
          for (let j = 0; j < specList.childCount; j++) {
            const s = specList.child(j);
            if (s?.type === "import_spec") {
              const path = findChild(s, "interpreted_string_literal");
              if (path) imports.push(path.text.replace(/"/g, ""));
            }
          }
        }
      }
    }
    return imports;
  },
};
