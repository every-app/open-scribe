// The window's routes. Hash history: the renderer is a file:// page, so the path lives after #.

import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { FolderPage, SharedPage } from "./pages/Folders";
import { HomePage } from "./pages/Home";
import { MeetingPage, UpcomingPage } from "./pages/Meeting";
import { Root } from "./pages/Root";
import { SettingsPage } from "./pages/Settings";
import { TemplatesPage } from "./pages/Templates";

const rootRoute = createRootRoute({ component: Root });

const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const shared = createRoute({ getParentRoute: () => rootRoute, path: "/shared", component: SharedPage });
const folder = createRoute({
  getParentRoute: () => rootRoute,
  path: "/folders/$id",
  component: function Folder() {
    const { id } = folder.useParams();
    return <FolderPage id={id} />;
  },
});
const meeting = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meetings/$id",
  component: function Meeting() {
    const { id } = meeting.useParams();
    return <MeetingPage id={id} />;
  },
});
const upcoming = createRoute({
  getParentRoute: () => rootRoute,
  path: "/upcoming/$eventId",
  component: function Upcoming() {
    const { eventId } = upcoming.useParams();
    return <UpcomingPage eventId={eventId} />;
  },
});
const templates = createRoute({
  getParentRoute: () => rootRoute,
  path: "/templates",
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" ? { id: search.id } : {},
  component: function Templates() {
    const { id } = templates.useSearch();
    return <TemplatesPage selected={id} />;
  },
});
const settings = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([home, shared, folder, meeting, upcoming, templates, settings]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
