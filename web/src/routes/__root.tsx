import {
  createRootRoute,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import {
  themePreferenceInitScript,
  useThemePreference,
} from "@/client/lib/theme";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Keep: the onboarding loop's verifier reads it on the deployed app's page.
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
});

/** Toasts in the app's theme; "system" follows the OS like the app does. */
function ThemedToaster() {
  const { themePreference } = useThemePreference();
  return <Toaster theme={themePreference} position="bottom-right" />;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          nonce={useRouter().options.ssr?.nonce}
          dangerouslySetInnerHTML={{ __html: themePreferenceInitScript }}
        />
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          {children}
          <ThemedToaster />
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
