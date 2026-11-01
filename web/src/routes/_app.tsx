import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/client/components/AppSidebar";
import { NewNoteButton } from "@/client/components/NewNoteButton";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/client/components/ui/sidebar";
import { listFolders } from "@/serverFunctions/folders";
import { getAccount } from "@/serverFunctions/home";

/** Every signed-in page: the sidebar, a slim top bar, and the page. */
export const Route = createFileRoute("/_app")({
  loader: async () => {
    const [account, folders] = await Promise.all([getAccount(), listFolders()]);
    return { account, folders };
  },
  component: AppLayout,
});

function AppLayout() {
  const { account, folders } = Route.useLoaderData();
  return (
    <SidebarProvider className="h-[100dvh] min-h-0 overflow-hidden">
      <AppSidebar
        folders={folders}
        orgName={account.user.orgName}
        launcher={account.launcher}
      />
      <SidebarInset className="min-h-0 overflow-hidden md:!m-0 md:!mt-2 md:!rounded-none md:!rounded-tl-lg md:border-l md:border-t md:border-sidebar-border md:!shadow-none">
        <div className="flex shrink-0 items-center gap-1 px-3 py-2">
          <SidebarTrigger aria-label="Toggle sidebar" className="md:hidden" />
          <div className="flex-1" />
          <NewNoteButton />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
