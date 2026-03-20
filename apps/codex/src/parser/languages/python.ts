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
  { nodeType: "function_definition", chunkType: "FUNCTION" },
  {
    nodeType: "class_definition",
    chunkType: "CLASS",
    extractChildren: true,
  },
  // Decorated definitions wrap functions/classes
  { nodeType: "decorated_definition", chunkType: "FUNCTION" },
];

const childNodes: NodeMapping[] = [
  { nodeType: "function_definition", chunkType: "METHOD" },
];

// ── Language definition ──────────────────────────────────────────────

export const pythonLanguage: LanguageDefinition = {
  name: "python",
  extensions: [".py", ".pyi"],

  topLevelNodes,
  childNodes,

  getSymbolName(node: Node): string | null {
    if (node.type === "decorated_definition") {
      const inner =
        findChild(node, "function_definition") ??
        findChild(node, "class_definition");
      if (inner) return findChildByField(inner, "name")?.text ?? null;
      return null;
    }
    return findChildByField(node, "name")?.text ?? null;
  },

  getParameters(node: Node): string[] {
    let target: Node = node;
    if (node.type === "decorated_definition") {
      target = findChild(node, "function_definition") ?? node;
    }
    const params = findChildByField(target, "parameters");
    if (!params) return [];

    return params.children
      .filter(
        (c) =>
          c.type === "identifier" ||
          c.type === "typed_parameter" ||
          c.type === "default_parameter" ||
          c.type === "typed_default_parameter" ||
          c.type === "list_splat_pattern" ||
          c.type === "dictionary_splat_pattern",
      )
      .filter((c) => c.text !== "self" && c.text !== "cls")
      .map((c) => c.text);
  },

  getReturnType(node: Node): string | null {
    let target: Node = node;
    if (node.type === "decorated_definition") {
      target = findChild(node, "function_definition") ?? node;
    }
    const returnType = findChildByField(target, "return_type");
    if (returnType) return returnType.text.replace(/^\s*->\s*/, "");
    return null;
  },

  isAsync(node: Node): boolean {
    if (node.type === "decorated_definition") {
      const inner = findChild(node, "function_definition");
      if (inner) return inner.children.some((c) => c.text === "async");
      return false;
    }
    return node.children.some((c) => c.text === "async");
  },

  getDocstring(node: Node): string | null {
    let target: Node = node;
    if (node.type === "decorated_definition") {
      target =
        findChild(node, "function_definition") ??
        findChild(node, "class_definition") ??
        node;
    }
    const body = findChildByField(target, "body") ?? findChild(target, "block");
    if (!body) return null;

    const firstStmt = body.child(0);
    if (!firstStmt) return null;

    // Python docstrings are expression_statement containing a string
    if (firstStmt.type === "expression_statement") {
      const str = findChild(firstStmt, "string");
      if (str) return str.text;
    }
    return null;
  },

  getExportType(): "default" | "named" | "none" {
    // Python doesn't have export keywords — everything is importable
    return "named";
  },

  getImports(rootNode: Node): string[] {
    const imports: string[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;
      if (child.type === "import_statement") {
        const name = findChild(child, "dotted_name");
        if (name) imports.push(name.text);
      } else if (child.type === "import_from_statement") {
        const module = findChild(child, "dotted_name");
        if (module) imports.push(module.text);
      }
    }
    return imports;
  },
};
