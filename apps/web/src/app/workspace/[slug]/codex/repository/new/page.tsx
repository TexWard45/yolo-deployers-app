import { redirect } from "next/navigation";
import { getSession } from "@/actions/auth";
import { NewRepositoryForm } from "./new-repository-form";

interface NewRepositoryPageProps {
  params: Promise<{ slug: string }>;
}

export default async function NewRepositoryPage({ params }: NewRepositoryPageProps) {
  const { slug } = await params;
  const session = await getSession();

  if (!session) redirect("/login");

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) redirect("/");

  return <NewRepositoryForm workspaceId={workspace.id} workspaceSlug={slug} />;
}
