import type { SentryConfig } from "@shared/rest";
import { queueEnv } from "@shared/env/queue";

interface WorkspaceSentryFields {
  sentryOrgSlug: string | null;
  sentryProjectSlug: string | null;
  sentryProjectSlugs: string[];
  sentryAuthToken: string | null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * Resolve per-workspace Sentry config, with optional global env fallback.
 *
 * Priority:
 * 1) Workspace config values (WorkspaceAgentConfig)
 * 2) Global queue env values
 */
export function resolveSentryConfig(
  workspaceConfig: WorkspaceSentryFields | null | undefined,
): SentryConfig | null {
  const workspaceProjectSlugs = (workspaceConfig?.sentryProjectSlugs ?? []).filter(
    (slug) => slug.trim().length > 0,
  );

  const envProjectSlugs = [
    queueEnv.GLOBAL_SENTRY_PROJECT_SLUG,
    queueEnv.SENTRY_PROJECT,
  ].filter((slug): slug is string => Boolean(slug && slug.trim().length > 0));

  const orgSlug = firstNonEmpty(
    workspaceConfig?.sentryOrgSlug,
    queueEnv.GLOBAL_SENTRY_ORG_SLUG,
    queueEnv.SENTRY_ORG,
  );

  const projectSlug = firstNonEmpty(
    workspaceConfig?.sentryProjectSlug,
    workspaceProjectSlugs[0],
    queueEnv.GLOBAL_SENTRY_PROJECT_SLUG,
    queueEnv.SENTRY_PROJECT,
  );

  const authToken = firstNonEmpty(
    workspaceConfig?.sentryAuthToken,
    queueEnv.GLOBAL_SENTRY_AUTH_TOKEN,
    queueEnv.SENTRY_AUTH_TOKEN,
  );

  if (!orgSlug || !projectSlug || !authToken) {
    return null;
  }

  const projectSlugs = workspaceProjectSlugs.length > 0 ? workspaceProjectSlugs : envProjectSlugs;

  return {
    orgSlug,
    projectSlug,
    authToken,
    projectSlugs: projectSlugs.length > 0 ? projectSlugs : undefined,
  };
}
