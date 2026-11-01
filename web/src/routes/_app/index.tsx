import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { ComingUp } from "@/client/components/ComingUp";
import { MeetingList } from "@/client/components/MeetingList";
import { Page } from "@/client/components/Page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";
import { getComingUp } from "@/serverFunctions/home";
import { listMeetings } from "@/serverFunctions/meetings";

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    const [comingUp, meetings] = await Promise.all([
      getComingUp(),
      listMeetings({ data: {} }),
    ]);
    return { comingUp, meetings };
  },
  head: () => ({ meta: [{ title: "Talk" }] }),
  component: Home,
});

function Home() {
  const { comingUp, meetings } = Route.useLoaderData();
  return (
    <Page>
      <ComingUp data={comingUp} />
      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No notes yet</EmptyTitle>
            <EmptyDescription>
              Take notes from Talk for Mac, or press Start now on a meeting
              above. They show up here when the meeting ends.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MeetingList meetings={meetings} />
      )}
    </Page>
  );
}
