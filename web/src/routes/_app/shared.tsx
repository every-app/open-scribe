import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { MeetingList } from "@/client/components/MeetingList";
import { Page, PageTitle } from "@/client/components/Page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/client/components/ui/empty";
import { listMeetings } from "@/serverFunctions/meetings";

export const Route = createFileRoute("/_app/shared")({
  loader: () => listMeetings({ data: { shared: true } }),
  head: () => ({ meta: [{ title: "Shared with me · Talk" }] }),
  component: Shared,
});

function Shared() {
  const meetings = Route.useLoaderData();
  return (
    <Page>
      <PageTitle description="Notes your teammates shared with the team.">
        Shared with me
      </PageTitle>
      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Nothing shared yet</EmptyTitle>
            <EmptyDescription>
              When a teammate shares a meeting or files it in a team folder, it
              shows up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MeetingList meetings={meetings} />
      )}
    </Page>
  );
}
