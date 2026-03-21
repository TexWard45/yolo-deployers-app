import OpenAI from "openai";
import {
  FixPrFixerOutputSchema,
  type FixPrCodeContextOutput,
  type FixPrFixerOutput,
  type FixPrRcaOutput,
  type FixPrTestPlan,
} from "@shared/types";

const SYSTEM_PROMPT = `You are a code-fix agent.

Return ONLY valid JSON with this shape:
{"summary":"...","changedFiles":[{"filePath":"...","original":"...","updated":"...","explanation":"..."}],"patchPlan":"...","riskNotes":["..."],"cannotFixSafely":false,"confidence":0.7}

Rules:
- make the smallest viable change
- only edit files in the provided editScope
- include exact original snippets for each replacement
- ALWAYS attempt to generate a fix, even if you are not fully confident — set "confidence" (0.0-1.0) to reflect how likely the fix is correct
- set cannotFixSafely=true ONLY if the editScope is completely empty (no files at all)
- if the files in editScope are not ideal but exist, still attempt a best-effort fix with a low confidence score and explain in riskNotes`;

export interface CodexFixPromptInput {
  rca: FixPrRcaOutput;
  codeContext: FixPrCodeContextOutput;
  testPlan: FixPrTestPlan;
  fileContents: Array<{ filePath: string; content: string }>;
  priorFailures: string[];
}

export async function generateCodexFix(
  input: CodexFixPromptInput,
  options: { apiKey?: string | null; model?: string; timeoutMs?: number } = {},
): Promise<FixPrFixerOutput> {
  if (!options.apiKey) {
    return {
      summary: "LLM API key missing; cannot generate a code patch automatically.",
      changedFiles: [],
      patchPlan: "No patch generated.",
      riskNotes: ["LLM API key missing"],
      cannotFixSafely: true,
      confidence: 0,
    };
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const response = await client.chat.completions.create({
      model: options.model ?? "gpt-4.1",
      temperature: 0,
      max_tokens: 1800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
    }, { signal: controller.signal });

    const raw = response.choices[0]?.message?.content ?? "";
    // Strip markdown code fences if LLM wraps JSON in ```json ... ```
    const content = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    console.log("[codex-fix] LLM response length:", content.length);
    return FixPrFixerOutputSchema.parse(JSON.parse(content));
  } catch (err) {
    console.error("[codex-fix] Fix generation failed:", err);
    return {
      summary: "Failed to generate a code patch safely.",
      changedFiles: [],
      patchPlan: "No patch generated.",
      riskNotes: ["Fix generation failed: " + (err instanceof Error ? err.message : String(err))],
      cannotFixSafely: true,
      confidence: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}
