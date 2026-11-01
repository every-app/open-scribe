import type { ReactNode } from "react";

/** The page column every signed-in page uses. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-16 pt-6">
      {children}
    </main>
  );
}

export function PageTitle({
  children,
  description,
  actions,
}: {
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-3xl font-semibold tracking-tight">
          {children}
        </h1>
        {description && (
          <p className="mt-1 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
