import OpenAI from "openai";
import type { FixPrRcaOutput } from "@shared/types";

const SYSTEM_PROMPT = `You are an RCA agent for a code-fix workflow.

Return ONLY valid JSON with this shape:
{"summary":"...","hypotheses":[{"summary":"...","confidence":0.0,"likelyFiles":["..."],"evidence":[{"issueId":"...","title":"...","culprit":"...","filePath":"...","stackTrace":"..."}]}],"confidence":0.0,"likelyFiles":["..."],"evidence":[{"issueId":"...","title":"...","culprit":"...","filePath":"...","stackTrace":"..."}],"insufficientEvidence":false}

Rules:
- use Sentry evidence when present
- use the thread analysis RCA when it is stronger than raw error data
- keep likelyFiles bounded
- do not invent stack traces or file paths`;

export interface FixPrRcaPromptInput {
  analysisSummary: string;
  analysisRcaSummary: string | null;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
}

export async function generateFixPrRca(
  input: FixPrRcaPromptInput,
  options: { apiKey?: string | null; model?: string; timeoutMs?: number } = {},
): Promise<FixPrRcaOutput> {
  const fallback = buildFallbackRca(input);
  if (!options.apiKey) return fallback;

  const client = new OpenAI({ apiKey: options.apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await client.chat.completions.create({
      model: options.model ?? "gpt-4.1",
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    }, { signal: controller.signal });

    const content = response.choices[0]?.message?.content ?? "";
    return JSON.parse(content) as FixPrRcaOutput;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackRca(input: FixPrRcaPromptInput): FixPrRcaOutput {
  const sentryFindings = Array.isArray(input.sentryFindings)
    ? (input.sentryFindings as Array<Record<string, unknown>>)
    : [];

  const evidence = sentryFindings.slice(0, 3).map((finding) => ({
    issueId: typeof finding.issueId === "string" ? finding.issueId : undefined,
    title: typeof finding.title === "string" ? finding.title : undefined,
    culprit: typeof finding.culprit === "string" ? finding.culprit : null,
    filePath: undefined,
    stackTrace: typeof finding.stackTrace === "string" ? finding.stackTrace : null,
  }));

  const likelyFiles = extractLikelyFiles(input.codexFindings);
  const summary = input.analysisRcaSummary ?? input.analysisSummary;

  return {
    summary,
    hypotheses: [{
      summary,
      confidence: evidence.length > 0 ? 0.8 : 0.45,
      likelyFiles,
      evidence,
    }],
    confidence: evidence.length > 0 ? 0.8 : 0.45,
    likelyFiles,
    evidence,
    insufficientEvidence: evidence.length === 0 && !input.analysisRcaSummary,
  };
}

function extractLikelyFiles(codexFindings: unknown): string[] {
  const chunks = ((codexFindings as { chunks?: Array<{ filePath?: string }> } | null)?.chunks ?? []);
  return [...new Set(chunks.map((chunk) => chunk.filePath?.trim()).filter((filePath): filePath is string => Boolean(filePath)))].slice(0, 5);
}
