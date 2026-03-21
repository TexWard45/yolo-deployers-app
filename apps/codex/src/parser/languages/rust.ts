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
  { nodeType: "function_item", chunkType: "FUNCTION" },
  { nodeType: "impl_item", chunkType: "CLASS", extractChildren: true },
  { nodeType: "struct_item", chunkType: "TYPE" },
  { nodeType: "enum_item", chunkType: "ENUM" },
  { nodeType: "trait_item", chunkType: "INTERFACE" },
  { nodeType: "type_item", chunkType: "TYPE" },
];

const childNodes: NodeMapping[] = [
  { nodeType: "function_item", chunkType: "METHOD" },
];

// ── Language definition ──────────────────────────────────────────────

export const rustLanguage: LanguageDefinition = {
  name: "rust",
  extensions: [".rs"],

  topLevelNodes,
  childNodes,

  getSymbolName(node: Node): string | null {
    if (node.type === "impl_item") {
      // impl Foo { ... } → name is the type
      const type = findChildByField(node, "type");
      if (type) return type.text;
      return null;
    }
    return findChildByField(node, "name")?.text ?? null;
  },

  getParameters(node: Node): string[] {
    const params = findChildByField(node, "parameters");
    if (!params) return [];

    return params.children
      .filter((c) => c.type === "parameter" || c.type === "self_parameter")
      .map((c) => c.text);
  },

  getReturnType(node: Node): string | null {
    // Look for -> return type syntax
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i]?.text === "->") {
        const nextChild = children[i + 1];
        if (nextChild) return nextChild.text;
      }
    }
    return null;
  },

  isAsync(node: Node): boolean {
    return node.children.some((c) => c.text === "async");
  },

  getDocstring(node: Node): string | null {
    // Rust doc comments: /// or //!
    const prev = node.previousNamedSibling;
    if (!prev) return null;

    if (prev.type === "line_comment" && prev.text.startsWith("///")) {
      // Collect consecutive doc comments
      let doc = prev.text;
      let current: Node | null = prev.previousNamedSibling;
      while (
        current?.type === "line_comment" &&
        current.text.startsWith("///")
      ) {
        doc = current.text + "\n" + doc;
        current = current.previousNamedSibling;
      }
      return doc;
    }
    return null;
  },

  getExportType(node: Node): "default" | "named" | "none" {
    // Rust uses `pub` keyword for visibility
    if (node.children.some((c) => c.type === "visibility_modifier")) {
      return "named";
    }
    return "none";
  },

  getImports(rootNode: Node): string[] {
    const imports: string[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;

      if (child.type === "use_declaration") {
        const argument =
          findChild(child, "scoped_identifier") ??
          findChild(child, "use_wildcard") ??
          findChild(child, "scoped_use_list") ??
          findChild(child, "identifier");
        if (argument) imports.push(argument.text);
      }
    }
    return imports;
  },
};
