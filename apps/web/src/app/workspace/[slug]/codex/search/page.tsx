import { redirect } from "next/navigation";
import { getSession } from "@/actions/auth";
import { CodexSearchClient } from "./search-client";

interface SearchPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CodexSearchPage({ params }: SearchPageProps) {
  const { slug } = await params;
  const session = await getSession();

  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  return <CodexSearchClient workspaceId={workspace.id} workspaceSlug={slug} />;
}
