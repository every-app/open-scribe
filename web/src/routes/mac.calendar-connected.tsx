import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@talk/ui/components/button";
import { openMacAppLink } from "@/client/lib/mac-app-link";

// Where the Gateway sends the browser after the Mac app's "Connect Google
// Calendar" (the connectUrl /api/v1 hands out): back to the Mac app, which
// reads the calendar again when its window comes up.
export const Route = createFileRoute("/mac/calendar-connected")({
  head: () => ({ meta: [{ title: "Google Calendar connected" }] }),
  component: CalendarConnected,
});

function CalendarConnected() {
  // The browser asks before it opens the app; the button is there if it doesn't.
  useEffect(() => {
    window.location.href = openMacAppLink;
  }, []);
  return (
    <main className="flex h-[100dvh] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Google Calendar is connected
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your upcoming meetings are in EveryApp now. You can close this tab.
        </p>
        <Button
          className="mt-6"
          nativeButton={false}
          render={<a href={openMacAppLink} />}
        >
          Open EveryApp
        </Button>
      </div>
    </main>
  );
}
