import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Page, PageTitle } from "@/client/components/Page";
import { TemplateSelect } from "@/client/components/TemplateSelect";
import { Button } from "@/client/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { type ThemePreference, useThemePreference } from "@/client/lib/theme";
import { getAccount } from "@/serverFunctions/home";
import { listTemplates, setDefaultTemplate } from "@/serverFunctions/templates";

export const Route = createFileRoute("/_app/settings")({
  loader: async () => {
    const [account, templates] = await Promise.all([
      getAccount(),
      listTemplates(),
    ]);
    return { account, templates };
  },
  head: () => ({ meta: [{ title: "Settings · Talk" }] }),
  component: Settings,
});

// The library's pressed color is the dark theme's background; lift it.
const pressed = "data-pressed:bg-secondary data-pressed:text-foreground";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Settings() {
  const { account, templates } = Route.useLoaderData();
  const router = useRouter();
  const { themePreference, setThemePreference } = useThemePreference();
  const { calendar } = account;

  return (
    <Page>
      <PageTitle>Settings</PageTitle>

      <div className="flex flex-col gap-4">
        <Section title="Account">
          <p className="text-sm">
            Signed in as <strong>{account.user.email}</strong> in{" "}
            {account.user.orgName}.{" "}
            <a href={account.launcher} className="text-primary hover:underline">
              Manage it in Every App
            </a>
          </p>
        </Section>

        <Section
          title="Google Calendar"
          description="Shows your upcoming meetings, and lets Talk for Mac remind you to take notes."
        >
          {!calendar.available ? (
            <p className="text-sm text-muted-foreground">
              Google isn't set up on this workspace's Gateway.
            </p>
          ) : calendar.connected ? (
            <p className="text-sm">Connected.</p>
          ) : (
            <Button
              size="sm"
              className="self-start"
              nativeButton={false}
              render={<a href={calendar.connectUrl} />}
            >
              {calendar.reconnect ? "Reconnect" : "Connect"} Google Calendar
            </Button>
          )}
        </Section>

        <Section
          title="Talk for Mac"
          description="The Mac app takes the notes: it sits in the menu bar, reminds you when a meeting starts, and transcribes it."
        >
          <p className="text-sm">
            In Talk for Mac, enter this address and choose Sign in with Every
            App:
          </p>
          <code className="self-start rounded bg-muted px-2 py-1 text-sm">
            {account.appUrl}
          </code>
          <p className="text-xs text-muted-foreground">
            Can't use that? Paste a Full access personal access token from{" "}
            <a href={account.tokensUrl} className="underline">
              Manage workspace → Tokens
            </a>{" "}
            instead.
          </p>
        </Section>

        <Section
          title="Notes"
          description={
            <>
              The template new notes are written with, unless the meeting's
              folder has its own.{" "}
              <Link to="/templates" className="text-primary hover:underline">
                Edit templates
              </Link>
            </>
          }
        >
          <TemplateSelect
            templates={templates.templates}
            value={templates.defaultTemplateId}
            onChange={async (templateId) => {
              if (!templateId) return;
              try {
                await setDefaultTemplate({ data: { templateId } });
                await router.invalidate();
                toast("Default template saved.");
              } catch {
                toast.error("Couldn't save the default.");
              }
            }}
          />
        </Section>

        <Section title="Appearance">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[themePreference]}
            onValueChange={(next) => {
              const picked = next[0] as ThemePreference | undefined;
              if (picked) setThemePreference(picked);
            }}
          >
            <ToggleGroupItem value="system" className={pressed}>
              System
            </ToggleGroupItem>
            <ToggleGroupItem value="light" className={pressed}>
              Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className={pressed}>
              Dark
            </ToggleGroupItem>
          </ToggleGroup>
        </Section>
      </div>
    </Page>
  );
}
