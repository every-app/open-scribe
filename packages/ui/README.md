# @talk/ui

OpenScribe's shared UI. The package keeps its old name for now; renaming it
means touching every import in `web/`.

The component library (shadcn on Base UI), `lib/theme.ts`, `lib/dates.ts` and
the theme (`src/styles/app.css`) that `web/` uses: web imports
`@talk/ui/components/<name>`, `@talk/ui/lib/theme`, `@talk/ui/lib/dates` and
`@talk/ui/styles.css` (see web/README.md).

The desktop screens, their playground and the desktop styles moved with the Mac
app to every-app/every-app (`apps/desktop/ui`, `@every-app/desktop-ui`),
which has its own copy of these components now.
