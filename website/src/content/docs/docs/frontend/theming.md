---
title: Theming & Branding
sidebar_label: Theming & Branding
description: Put your brand on the admin — colour, fonts, corners, surfaces, light and dark mode, logo and sign-in screen — by overriding a handful of CSS tokens, not by rewriting components.
---

## Overview

Every part of the admin — the drawer, the tables, the forms, the dialogs, Studio, the sign-in screen — is drawn from one set of design tokens in `@rebasepro/ui`. Change a token in your own stylesheet and every part that uses it follows, in both themes.

So rebranding has two levels, and you rarely need the second:

1. **Tokens.** Brand colour, fonts, corner radius and surfaces are CSS variables you override in `frontend/src/index.css`. Logo and name are props on `<RebaseShell>`. This covers what most projects mean by "make it look like ours".
2. **Components.** When a part should *behave or be laid out* differently — your own app bar, your own sign-in screen — replace it with a [component override](/docs/frontend/component-overrides).

## Brand colour

One line. Put a `@theme` block after the imports in `frontend/src/index.css`:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Everything that says "primary" moves with it: filled buttons, links, checked checkboxes and switches, focus rings, the active row in the drawer, charts, selection. The related tokens are derived from it, so you do not set them yourself:

| Token | Derived as | Used for |
|---|---|---|
| `--color-primary-light` | lighter by 0.15 OKLCH lightness | accent text on dark backgrounds |
| `--color-primary-dark` | darker by 0.15 | pressed and hover states |
| `--color-primary-bg` | primary at 10% opacity | selected rows, tinted backgrounds |
| `--color-on-primary` | white or black, whichever reads on the primary | the label of a filled button, the tick in a checkbox |

`--color-on-primary` (new in 0.34; before it, filled buttons always drew white labels) is what keeps a light brand legible. A yellow or lime primary gets black labels on its buttons rather than white ones at 2:1. It flips at OKLCH lightness 0.6, which picks the higher-contrast ink for nearly every real brand colour; if yours sits near the line and you prefer the other ink, set it:

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` and `--color-on-secondary` work the same way. The admin barely uses secondary — it is there for your own UI.

## Fonts

The admin sets body copy in `--font-sans`, headings in `--font-headers` and measured values (ids, timestamps, code) in `--font-mono`. Install the font, import it once, and point the token at it:

```bash
pnpm --dir frontend add @fontsource-variable/manrope
```

```tsx no-verify
// frontend/src/App.tsx, next to the existing font imports
import "@fontsource-variable/manrope";
```

```css
@theme {
    --font-sans: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
    --font-headers: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
}
```

Remove the font imports you no longer use (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), or they still download.

## Corners

Three radii carry the whole UI:

| Token | Default | Used for |
|---|---|---|
| `--radius-md` | `6px` | chips, code wells, small tiles |
| `--radius-lg` | `9px` | controls, menus, row highlights |
| `--radius-xl` | `13px` | cards, dialogs, side sheets |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Surfaces

Backgrounds are named by role, and each role has a light value and a dark value. These are plain CSS variables rather than `@theme` tokens, because they switch with the theme — so override them under `:root` for light and `.dark` for dark:

```css
/* A warmer ground in both themes */
:root {
    --surface-frame: #f4f1ec;
    --surface-sheet: #faf8f5;
}

.dark {
    --surface-frame: #0d0b09;
    --surface-sheet: #15120f;
    --surface-card: #1b1814;
}
```

| Variable | What it is |
|---|---|
| `--surface-frame` | the page behind everything, around the drawer |
| `--surface-sheet` | the main content area |
| `--surface-card` | cards, table rows, form panels |
| `--surface-raised` | a control or panel lifted off a card |
| `--surface-lifted` | menus, popovers, dialogs |
| `--surface-field` | the fill of a text field (translucent) |
| `--surface-hover` / `--surface-active` | hover and pressed fills (translucent) |
| `--surface-well` | a recessed code or log well |
| `--hairline` / `--hairline-strong` | borders and dividers (translucent) |

Keep the order: in each theme, frame, sheet and card should step away from each other in the same direction. Text colours are tuned against the defaults, so after a big change check a page in both themes for contrast.

## Light and dark mode

By default the admin follows the operating system, shows a theme toggle, and remembers the person's choice.

To ship a single theme, own the mode yourself. Hand `<Rebase>` a `modeController` whose `setMode` ignores the toggle, and put the matching class on `<html>` — with your own controller, Rebase leaves the page's classes alone:

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logo and name

<span class="since-badge" data-since="0.34">Since 0.34</span>

`<RebaseShell>` takes the name and logo shown in the drawer. The same logo appears on the built-in sign-in screen. Put the files in `frontend/public/`:

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` is optional. Use it when your logo is drawn in dark ink and would disappear on the dark theme; without it, `logo` is used in both.

The browser tab's title and icon come from `frontend/index.html`:

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## The sign-in screen

<span class="since-badge" data-since="0.34">Since 0.34</span>

The built-in sign-in screen picks up your brand colour, fonts, surfaces and the shell's `logo` with no extra code.

To change its copy or add your own content, hand `<RebaseAuth>` a configured `LoginView`. In the scaffolded `App.tsx`, `authController` is already in scope:

```tsx
import { LoginView, RebaseAuth } from "@rebasepro/app";

<RebaseAuth loginView={
    <LoginView
        authController={authController}
        logo="/logo.svg"
        logoDark="/logo-dark.svg"
        title="Acme Ops"
        subtitle="Sign in with your work account"
        additionalComponent={<a href="https://acme.example/help">Trouble signing in?</a>}
    />
}/>
```

Other props: `topComponent` (above the sign-in buttons), `layout="form-first"` (no card of its own, for a page that frames the sign-in itself, such as a split screen beside a product picture), and `disableSignupScreen`.

To replace the screen outright, override `"Auth.LoginView"` (see [Component Overrides](/docs/frontend/component-overrides)).

## Beyond tokens

- **Replace a part of the shell** — the app bar, the drawer, a navigation row, the sign-in screen — with a [component override](/docs/frontend/component-overrides).
- **Add your own pages** that match the theme: [Styling Custom UI](/docs/frontend/styling) explains which components and classes to build them from, so your tokens reach them too.

## Checklist

- The brand colour is set once, in `@theme`, and nowhere else. Do not write it as a literal in components; use `bg-primary` / `text-primary`.
- Look at a filled button and a checked checkbox: the label and the tick must be easy to read.
- Toggle the theme and look at a table, a form and a dialog in both modes.
- If you replaced the fonts, remove the default font imports.
