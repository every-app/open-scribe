# @talk/ui

Talk's shared React 19 + Tailwind 4 components and the desktop screens.

- `src/components/ui`: the component library (shadcn on Base UI), used by
  both desktop/ and web/ (web imports `@talk/ui/components/<name>`, see
  web/README.md). A change here changes both apps.
- `src/styles/app.css`: the shared theme; web imports it as is (its
  `src/styles/app.css` is just that import). `src/styles/desktop.css`
  layers the desktop look on top of it (system font, 13px UI text, quiet warm
  neutrals, a translucent sidebar for vibrancy). Import `@talk/ui/styles.css`.
- `src/screens`: the desktop screens. They're data-agnostic: they take
  `Loadable<T>` values and callbacks, and they never fetch. The router and
  query layer in `desktop/src/renderer` wire them up.
- `src/types.ts`: the shapes the screens draw. They mirror the `/api/v1`
  contract and the helper protocol structurally, without importing web/.

## Playground

```sh
pnpm --filter @talk/ui playground    # http://127.0.0.1:5188
pnpm --filter @talk/ui screenshots   # with the playground running
```

The playground renders every screen and state with mock data at Mac window
sizes, in light and dark mode. `?scene=<id>&theme=dark&bare` renders one scene
full-window. That's what `scripts/screenshots.mjs` captures into
`screenshots/` at 1200×800.

## Using it from an app

Tailwind must scan this package's sources. Add
`@source "<path to>/packages/ui/src";` next to your `@import
"@talk/ui/styles.css"` (desktop.css already sources itself when it's imported
directly).
