import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import {
  ChevronLeft,
  Folder,
  House,
  LayoutTemplate,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { toast } from "sonner";
import { FolderNameDialog } from "@/client/components/FolderNameDialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/client/components/ui/sidebar";
import type { Folder as FolderRow } from "@/server/folders";
import { createFolder } from "@/serverFunctions/folders";

const navButtonClass =
  "relative text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:before:absolute data-active:before:inset-y-1 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary";

function NavLink({
  icon: Icon,
  label,
  link,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  link: LinkOptions;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <Link
        {...link}
        activeOptions={{ includeSearch: false, ...link.activeOptions }}
        onClick={() => setOpenMobile(false)}
      >
        {({ isActive }) => (
          <SidebarMenuButton
            render={<span />}
            isActive={isActive}
            className={navButtonClass}
          >
            <Icon className="size-4" />
            <span className="truncate">{label}</span>
          </SidebarMenuButton>
        )}
      </Link>
    </SidebarMenuItem>
  );
}

function FolderGroup({
  label,
  folders,
  onAdd,
  empty,
}: {
  label: string;
  folders: FolderRow[];
  onAdd: () => void;
  empty: string;
}) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupAction title={`New folder in ${label}`} onClick={onAdd}>
        <Plus />
        <span className="sr-only">New folder in {label}</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {folders.map((folder) => (
            <NavLink
              key={folder.id}
              icon={Folder}
              label={folder.name}
              link={{ to: "/folders/$id", params: { id: folder.id } }}
            />
          ))}
          {folders.length === 0 && (
            <SidebarMenuItem>
              <button
                type="button"
                onClick={onAdd}
                className="px-2 py-1 text-left text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground"
              >
                {empty}
              </button>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar({
  folders,
  orgName,
  launcher,
}: {
  folders: FolderRow[];
  orgName: string;
  launcher: string;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const [adding, setAdding] = useState<"private" | "team" | null>(null);

  async function add(name: string) {
    if (!adding) return;
    try {
      const folder = await createFolder({ data: { name, space: adding } });
      setAdding(null);
      await router.invalidate();
      await navigate({ to: "/folders/$id", params: { id: folder.id } });
    } catch {
      toast.error("Couldn't create the folder.");
    }
  }

  return (
    <Sidebar variant="inset" collapsible="offcanvas" className="md:!p-0">
      <SidebarHeader className="gap-0 px-3 pb-1 pt-2">
        <a
          href={launcher}
          aria-label="Back to Every App"
          className="mb-1 inline-flex h-7 w-fit items-center gap-0.5 rounded-md pl-0.5 pr-2 text-sm text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          <span>Every App</span>
        </a>
        <Link
          to="/"
          onClick={() => setOpenMobile(false)}
          className="truncate px-1 pb-2 text-base font-semibold text-sidebar-foreground"
        >
          Talk
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Main navigation">
          <SidebarGroup className="py-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <NavLink
                  icon={House}
                  label="Home"
                  link={{ to: "/", activeOptions: { exact: true } }}
                />
                <NavLink
                  icon={Users}
                  label="Shared with me"
                  link={{ to: "/shared" }}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <FolderGroup
            label="My notes"
            folders={folders.filter((folder) => folder.space === "private")}
            onAdd={() => setAdding("private")}
            empty="New private folder"
          />
          <FolderGroup
            label={orgName}
            folders={folders.filter((folder) => folder.space === "team")}
            onAdd={() => setAdding("team")}
            empty="New team folder"
          />
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-0 border-t border-sidebar-border">
        <SidebarMenu>
          <NavLink
            icon={LayoutTemplate}
            label="Templates"
            link={{ to: "/templates" }}
          />
          <NavLink
            icon={Settings}
            label="Settings"
            link={{ to: "/settings" }}
          />
        </SidebarMenu>
      </SidebarFooter>

      <FolderNameDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title={adding === "team" ? `New folder in ${orgName}` : "New folder"}
        description={
          adding === "team"
            ? "Everyone on the team sees this folder and the notes in it."
            : "Only you see this folder."
        }
        submitLabel="Create folder"
        onSubmit={add}
      />
    </Sidebar>
  );
}
