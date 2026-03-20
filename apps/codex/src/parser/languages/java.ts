import type { LanguageDefinition, Node, NodeMapping } from "../types.js";

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
  {
    nodeType: "class_declaration",
    chunkType: "CLASS",
    extractChildren: true,
  },
  { nodeType: "interface_declaration", chunkType: "INTERFACE" },
  { nodeType: "enum_declaration", chunkType: "ENUM" },
];

const childNodes: NodeMapping[] = [
  { nodeType: "method_declaration", chunkType: "METHOD" },
  { nodeType: "constructor_declaration", chunkType: "METHOD" },
];

// ── Language definition ──────────────────────────────────────────────

export const javaLanguage: LanguageDefinition = {
  name: "java",
  extensions: [".java"],

  topLevelNodes,
  childNodes,

  getSymbolName(node: Node): string | null {
    return findChildByField(node, "name")?.text ?? null;
  },

  getParameters(node: Node): string[] {
    const params = findChildByField(node, "parameters");
    if (!params) return [];

    return params.children
      .filter(
        (c) =>
          c.type === "formal_parameter" || c.type === "spread_parameter",
      )
      .map((c) => c.text);
  },

  getReturnType(node: Node): string | null {
    // Java method return type is the "type" field
    const type = findChildByField(node, "type");
    if (type) return type.text;
    return null;
  },

  isAsync(): boolean {
    // Java doesn't have async keyword (uses CompletableFuture etc.)
    return false;
  },

  getDocstring(node: Node): string | null {
    const prev = node.previousNamedSibling;
    if (!prev) return null;

    if (prev.type === "block_comment" && prev.text.startsWith("/**")) {
      return prev.text;
    }
    return null;
  },

  getExportType(node: Node): "default" | "named" | "none" {
    // Java uses access modifiers. "public" = exported
    const modifiers = findChild(node, "modifiers");
    if (modifiers && modifiers.text.includes("public")) {
      return "named";
    }
    return "none";
  },

  getImports(rootNode: Node): string[] {
    const imports: string[] = [];
    // Java: program > import_declaration
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;

      if (child.type === "import_declaration") {
        // Extract the scoped identifier
        const scoped = findChild(child, "scoped_identifier");
        if (scoped) imports.push(scoped.text);
      }
    }
    return imports;
  },
};
