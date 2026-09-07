---
title: Styling Custom UI
sidebar_label: Styling Custom UI
description: Build custom views, home pages and actions out of the same components and theme tokens as the rest of the admin, so they look native and follow the theme.
---

## Overview

Every extension mechanism in this section hands you a React component and gets out of the way — a [custom view](/docs/frontend/extending), a [home page](/docs/frontend/component-overrides), an [entity view](/docs/frontend/entity-views), a [slot](/docs/frontend/slots). What none of them says is what to *build it out of*.

The answer is: the same parts the admin is built from. A custom view is still an admin view. It sits inside the same shell, beside the same tables, under the same theme toggle — so it should use the same components, the same type scale and the same colour tokens.

The alternative is inventing a second design language inside the same app. That is the common failure, and it does not merely look inconsistent — it breaks. A hand-written `color: #111` renders invisible the moment someone switches to the dark theme, and no test catches it.

## The rule

**Import components from `@rebasepro/ui`. Reach for a raw `<div>` and a class only for layout.**

```tsx
import { Alert, Button, Card, Chip, Typography } from "@rebasepro/ui";

export function DashboardView() {
    return (
        <div className="p-8 max-w-5xl mx-auto flex flex-col gap-8">
            <Typography variant="h4">Outreach</Typography>
            <Typography variant="body2" color="secondary">
                What ran last night, and what is waiting for you.
            </Typography>

            <Card className="p-4 flex flex-col gap-1">
                <Typography variant="h5" className="mb-0 tabular-nums">128</Typography>
                <Typography variant="subtitle2" className="mb-0">Signals</Typography>
                <Typography variant="caption" color="secondary" className="mb-0">12 approved</Typography>
            </Card>

            <Alert color="warning">Delivery is not configured, so nothing can be sent.</Alert>
        </div>
    );
}
```

Every component in the kit is catalogued under [UI components](/docs/ui/components/card/) with its real props, generated from the source. Check there before hand-rolling: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` and about forty more already exist.

## Colour: use tokens, never literals

The theme is a set of CSS variables exposed as Tailwind utilities. Use them, and pair every light value with a `dark:` one:

| Use | Class |
|---|---|
| Body text | `text-surface-900 dark:text-surface-100` |
| Secondary text | `text-surface-600 dark:text-surface-400` — or just `<Typography color="secondary">` |
| Panel background | `bg-surface-accent-50 dark:bg-surface-800` |
| Borders | `border-surface-200 dark:border-surface-700` |
| Accent | `text-primary` / `bg-primary` (`#0070F4`) |

Two rules that come from real breakage:

- **Never write a colour literal.** `#111`, `rgba(128,128,128,.28)`, `white` — each one is correct in exactly one theme. A page whose numbers were `color: var(--fg, #111)` rendered black-on-black for every dark-theme user, and looked perfect to the person who wrote it.
- **Never set a colour a component already sets.** `<Typography>` picks the right foreground for the theme. Overriding it with a class is how a heading ends up the only element on the page that ignores the theme.

## Type: use the scale

`Typography` carries the whole scale — `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `caption`, `label`. Use `variant`, not a font-size class. The scale already encodes the tracking each tier needs (`--tracking-display` at ≥30px, `--tracking-title` at 20–24px, `--tracking-heading` below that), which a `text-[27px]` does not.

Product UI does not go below `text-xs`. The `text-2xs` and `text-3xs` tiers exist for marketing pages only.

## Setup

Custom UI needs the theme's CSS and Tailwind pointed at the packages, or the utility classes used *inside* `@rebasepro/ui` never get generated:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` writes this for you. If your custom view renders unstyled, this is the first thing to check.

## Checklist

Before shipping a custom view:

- No colour literals — every colour is a token or comes from a component.
- Every `bg-`, `text-` and `border-` has a `dark:` counterpart.
- Text is `<Typography variant=…>`, not a font-size class.
- Containers are `Card` / `Paper`, not a `<div>` with a hand-written border.
- Toggle the theme and look at the page. That is the whole test, and it takes five seconds.
