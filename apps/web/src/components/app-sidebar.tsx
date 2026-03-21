"use client";

import {
  LayoutDashboard,
  Inbox,
  Settings,
  Shield,
  ChevronUp,
  ChevronDown,
  LogOut,
  Code,
  Bot,
  Building2,
  Check,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { logout } from "@/actions/auth";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AppSidebarProps {
  user?: {
    username: string;
    name: string | null;
    isSystemAdmin: boolean;
    workspaces?: Workspace[];
  } | null;
}

export function AppSidebar({ user }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeSlug = pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? null;
  const workspaces = user?.workspaces ?? [];
  const activeWorkspace = workspaces.find((ws) => ws.slug === activeSlug) ?? workspaces[0] ?? null;

  async function handleLogout() {
    await logout();
    router.push("/login");
    router.refresh();
  }

  function switchWorkspace(ws: Workspace) {
    // Navigate to the same sub-page in the new workspace
    const subPage = pathname.match(/^\/workspace\/[^/]+\/(.+)/)?.[1] ?? "inbox";
    router.push(`/workspace/${ws.slug}/${subPage}`);
  }

  const initials = (user?.name ?? user?.username ?? "?")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LayoutDashboard className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  Template Project
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Dashboard
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Workspace switcher */}
        {activeWorkspace && workspaces.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
                      <Building2 className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {activeWorkspace.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {activeWorkspace.role}
                      </span>
                    </div>
                    <ChevronDown className="ml-auto size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="bottom"
                    align="start"
                    className="w-[--radix-popper-anchor-width]"
                  >
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        onClick={() => switchWorkspace(ws)}
                      >
                        <Building2 className="mr-2 size-4" />
                        {ws.name}
                        {ws.slug === activeWorkspace.slug ? (
                          <Check className="ml-auto size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {/* Workspace pages — shown for active workspace */}
        {activeWorkspace ? (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.includes("/inbox")}
                  render={<Link href={`/workspace/${activeWorkspace.slug}/inbox`} />}
                >
                  <Inbox />
                  <span>Inbox</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.includes("/codex")}
                  render={<Link href={`/workspace/${activeWorkspace.slug}/codex`} />}
                >
                  <Code />
                  <span>Codex</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.includes("/settings")}
                  render={<Link href={`/workspace/${activeWorkspace.slug}/settings`} />}
                >
                  <Bot />
                  <span>AI Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {user?.isSystemAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/admin" />}>
                  <Shield />
                  <span>Admin Panel</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {user?.name ?? user?.username ?? "User"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user?.username}
                  </span>
                </div>
                <ChevronUp className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-popper-anchor-width]"
              >
                <DropdownMenuItem>
                  <Settings className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
