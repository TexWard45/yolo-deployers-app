import { redirect } from "next/navigation";
import { getSession } from "@/actions/auth";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { slug } = await params;
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const workspace = session.workspaces.find((w) => w.slug === slug);
  if (!workspace) {
    redirect("/");
  }

  return (
    <SidebarProvider>
      <AppSidebar user={session} />
      <SidebarInset>
        <div className="flex h-svh min-w-0 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
            <SidebarTrigger />
            <span className="text-sm font-semibold tracking-tight">{workspace.name}</span>
          </header>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-6">{children}</main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
