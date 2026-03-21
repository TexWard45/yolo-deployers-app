import OpenAI from "openai";
import type { FixPrReviewerOutput } from "@shared/types";

const SYSTEM_PROMPT = `You are a strict code reviewer.

Return ONLY valid JSON with this shape:
{"approved":false,"blockers":[{"severity":"blocker","message":"...","filePath":"..."}],"warnings":[{"severity":"warning","message":"...","filePath":"..."}],"notes":[{"severity":"note","message":"...","filePath":"..."}],"missingTests":["..."]}

Rules:
- blocker means the change should not ship as-is
- focus on correctness, regressions, and missing validation
- do not add style-only feedback`;

export interface CodexReviewPromptInput {
  rcaSummary: string;
  changedFiles: Array<{ filePath: string; diff: string }>;
  testPlan: string[];
}

export async function reviewCodexFix(
  input: CodexReviewPromptInput,
  options: { apiKey?: string | null; model?: string; timeoutMs?: number } = {},
): Promise<FixPrReviewerOutput> {
  if (!options.apiKey) {
    return {
      approved: input.changedFiles.length > 0,
      blockers: [],
      warnings: [],
      notes: [],
      missingTests: [],
    };
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

  try {
    const response = await client.chat.completions.create({
      model: options.model ?? "gpt-4.1",
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
    }, { signal: controller.signal });

    const content = response.choices[0]?.message?.content ?? "";
    return JSON.parse(content) as FixPrReviewerOutput;
  } catch {
    return {
      approved: false,
      blockers: [{
        severity: "blocker",
        message: "Automated review failed to complete.",
      }],
      warnings: [],
      notes: [],
      missingTests: input.testPlan,
    };
  } finally {
    clearTimeout(timeout);
  }
}
