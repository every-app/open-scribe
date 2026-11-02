// The window's routes. Hash history: the renderer is a file:// page, so the path lives after #.
//
// Only Root (sign-in, onboarding, the frame) and Home load with the window. Every other page is
// its own chunk, fetched the first time you open it (routes/*.lazy.tsx); the route definitions
// here keep only paths and search validation.

import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HomePage } from "./pages/Home";
import { Root } from "./pages/Root";

const rootRoute = createRootRoute({ component: Root });

const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

const shared = createRoute({ getParentRoute: () => rootRoute, path: "/shared" }).lazy(() =>
  import("./routes/folders.lazy").then((m) => m.sharedRoute),
);
const folder = createRoute({ getParentRoute: () => rootRoute, path: "/folders/$id" }).lazy(() =>
  import("./routes/folders.lazy").then((m) => m.folderRoute),
);
const meeting = createRoute({ getParentRoute: () => rootRoute, path: "/meetings/$id" }).lazy(() =>
  import("./routes/meeting.lazy").then((m) => m.meetingRoute),
);
const upcoming = createRoute({ getParentRoute: () => rootRoute, path: "/upcoming/$eventId" }).lazy(() =>
  import("./routes/meeting.lazy").then((m) => m.upcomingRoute),
);
const templates = createRoute({
  getParentRoute: () => rootRoute,
  path: "/templates",
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" ? { id: search.id } : {},
}).lazy(() => import("./routes/templates.lazy").then((m) => m.templatesRoute));
const settings = createRoute({ getParentRoute: () => rootRoute, path: "/settings" }).lazy(() =>
  import("./routes/settings.lazy").then((m) => m.settingsRoute),
);

export const routeTree = rootRoute.addChildren([home, shared, folder, meeting, upcoming, templates, settings]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
