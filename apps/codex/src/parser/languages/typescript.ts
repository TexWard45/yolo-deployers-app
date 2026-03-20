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

function getIdentifierText(node: Node): string | null {
  const nameNode =
    findChildByField(node, "name") ?? findChild(node, "identifier");
  if (nameNode) return nameNode.text;

  // Handle type_alias_declaration → name is a type_identifier
  const typeId = findChild(node, "type_identifier");
  if (typeId) return typeId.text;

  return null;
}

function isExportWrapped(node: Node): {
  isExport: boolean;
  isDefault: boolean;
} {
  const parent = node.parent;
  if (!parent) return { isExport: false, isDefault: false };

  if (parent.type === "export_statement") {
    const hasDefault = parent.children.some((c) => c.type === "default");
    return { isExport: true, isDefault: hasDefault };
  }

  return { isExport: false, isDefault: false };
}

function extractParams(node: Node): string[] {
  const params =
    findChild(node, "formal_parameters") ??
    findChildByField(node, "parameters");
  if (!params) return [];

  return params.children
    .filter(
      (c) =>
        c.type === "required_parameter" ||
        c.type === "optional_parameter" ||
        c.type === "rest_parameter" ||
        c.type === "identifier",
    )
    .map((c) => c.text);
}

function extractReturnType(node: Node): string | null {
  const returnType = findChild(node, "type_annotation");
  if (returnType) return returnType.text.replace(/^\s*:\s*/, "");

  // Arrow functions: check for return type after params
  const children = node.children;
  for (const child of children) {
    if (child.type === "type_annotation") {
      return child.text.replace(/^\s*:\s*/, "");
    }
  }
  return null;
}

function getPrecedingComment(node: Node, _source: string): string | null {
  const target = node.parent?.type === "export_statement" ? node.parent : node;
  const prev = target.previousNamedSibling;

  if (!prev) return null;
  if (prev.type !== "comment") return null;

  const text = prev.text;
  // Only capture JSDoc-style or block comments
  if (text.startsWith("/**") || text.startsWith("//")) {
    return text;
  }
  return null;
}

// ── Top-level node mappings ──────────────────────────────────────────

const topLevelNodes: NodeMapping[] = [
  { nodeType: "function_declaration", chunkType: "FUNCTION" },
  { nodeType: "class_declaration", chunkType: "CLASS", extractChildren: true },
  { nodeType: "interface_declaration", chunkType: "INTERFACE" },
  { nodeType: "type_alias_declaration", chunkType: "TYPE" },
  { nodeType: "enum_declaration", chunkType: "ENUM" },
  // Variable declarations that hold arrow functions
  { nodeType: "lexical_declaration", chunkType: "FUNCTION" },
];

const childNodes: NodeMapping[] = [
  { nodeType: "method_definition", chunkType: "METHOD" },
  { nodeType: "public_field_definition", chunkType: "METHOD" },
];

// ── Language definition ──────────────────────────────────────────────

export const typescriptLanguage: LanguageDefinition = {
  name: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],

  topLevelNodes,
  childNodes,

  getSymbolName(node: Node): string | null {
    // For lexical_declaration (const foo = () => {}), dig into the declarator
    if (node.type === "lexical_declaration") {
      const declarator = findChild(node, "variable_declarator");
      if (!declarator) return null;
      // Only treat as function if value is arrow_function or function
      const value = findChildByField(declarator, "value");
      if (
        !value ||
        (value.type !== "arrow_function" && value.type !== "function")
      ) {
        return null;
      }
      return findChildByField(declarator, "name")?.text ?? null;
    }
    return getIdentifierText(node);
  },

  getParameters(node: Node): string[] {
    if (node.type === "lexical_declaration") {
      const declarator = findChild(node, "variable_declarator");
      if (!declarator) return [];
      const value = findChildByField(declarator, "value");
      if (value) return extractParams(value);
      return [];
    }
    return extractParams(node);
  },

  getReturnType(node: Node): string | null {
    if (node.type === "lexical_declaration") {
      const declarator = findChild(node, "variable_declarator");
      if (!declarator) return null;
      const value = findChildByField(declarator, "value");
      if (value) return extractReturnType(value);
      return null;
    }
    return extractReturnType(node);
  },

  isAsync(node: Node): boolean {
    if (node.type === "lexical_declaration") {
      const declarator = findChild(node, "variable_declarator");
      if (!declarator) return false;
      const value = findChildByField(declarator, "value");
      if (!value) return false;
      return value.children.some((c) => c.text === "async");
    }
    return node.children.some((c) => c.text === "async");
  },

  getDocstring(node: Node, source: string): string | null {
    return getPrecedingComment(node, source);
  },

  getExportType(node: Node): "default" | "named" | "none" {
    const { isExport, isDefault } = isExportWrapped(node);
    if (!isExport) {
      // Check if the node itself has "export" keyword
      if (node.children.some((c) => c.text === "export")) {
        return node.children.some((c) => c.text === "default")
          ? "default"
          : "named";
      }
      return "none";
    }
    return isDefault ? "default" : "named";
  },

  getImports(rootNode: Node): string[] {
    const imports: string[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (child?.type === "import_statement") {
        const source = findChild(child, "string");
        if (source) {
          imports.push(source.text.replace(/['"]/g, ""));
        }
      }
    }
    return imports;
  },
};
