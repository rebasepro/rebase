---
sourceHash: 8721ee795ebd8dce
title: Custom UI stylen
sidebar_label: Custom UI stylen
description: Erstellen Sie benutzerdefinierte Ansichten, Startseiten und Aktionen aus denselben Komponenten und Theme-Tokens wie der Rest des Admins, damit sie nativ aussehen und dem Theme folgen.
---

## Übersicht

Jeder Erweiterungsmechanismus in diesem Abschnitt übergibt Ihnen eine React-Komponente und tritt in den Hintergrund – eine [benutzerdefinierte Ansicht](/docs/frontend/extending), eine [Startseite](/docs/frontend/component-overrides), eine [Entitätsansicht](/docs/frontend/entity-views), ein [Slot](/docs/frontend/slots). Was keiner davon vorgibt, ist, *woraus* sie gebaut werden sollen.

Die Antwort lautet: aus denselben Teilen, aus denen der Admin gebaut ist. Eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht. Sie befindet sich in derselben Shell, neben denselben Tabellen, unter demselben Theme-Umschalter – daher sollte sie dieselben Komponenten, dieselbe Typografieskala und dieselben Farb-Tokens verwenden.

Die Alternative besteht darin, eine zweite Designsprache innerhalb derselben App zu erfinden. Das ist der häufigste Fehler, und er sieht nicht nur inkonsistent aus – er führt zu Problemen. Ein manuell geschriebenes `color: #111` wird in dem Moment unsichtbar, in dem jemand zum Dark Theme wechselt, und kein Test fängt dies ab.

## Die Regel

**Importieren Sie Komponenten aus `@rebasepro/ui`. Greifen Sie nur für das Layout auf ein reines `<div>` und Klassen zurück.**

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

Jede Komponente im Kit ist unter [UI components](/docs/ui/components/card/) mit ihren echten, aus dem Quellcode generierten Props katalogisiert. Schauen Sie dort nach, bevor Sie etwas selbst bauen: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` und etwa vierzig weitere existieren bereits.

## Farben: Verwenden Sie Tokens, niemals literale Werte

Das Theme ist eine Reihe von CSS-Variablen, die als Tailwind-Utilities bereitgestellt werden. Verwenden Sie diese und kombinieren Sie jeden Light-Wert mit einem `dark:`-Wert:

| Verwendung | Klasse |
|---|---|
| Body-Text | `text-surface-900 dark:text-surface-100` |
| Sekundärer Text | `text-surface-600 dark:text-surface-400` — oder einfach `<Typography color="secondary">` |
| Panel-Hintergrund | `bg-surface-accent-50 dark:bg-surface-800` |
| Rahmen | `border-surface-200 dark:border-surface-700` |
| Akzent | `text-primary` / `bg-primary` (`#0070F4`) |

Zwei Regeln, die aus echten Fehlern in der Praxis resultieren:

- **Schreiben Sie niemals literale Farbwerte.** `#111`, `rgba(128,128,128,.28)`, `white` – jeder davon ist in genau einem Theme korrekt. Eine Seite, deren Zahlen mit `color: var(--fg, #111)` gestylt waren, wurde für alle Dark-Theme-Nutzer als Schwarz auf Schwarz gerendert, sah aber für die Person, die es geschrieben hat, perfekt aus.
- **Setzen Sie niemals eine Farbe, die eine Komponente bereits setzt.** `<Typography>` wählt automatisch die richtige Vordergrundfarbe für das Theme. Das Überschreiben mit einer Klasse führt dazu, dass eine Überschrift am Ende das einzige Element auf der Seite ist, welches das Theme ignoriert.

## Typografie: Verwenden Sie die Skala

`Typography` deckt die gesamte Skala ab – `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `caption`, `label`. Verwenden Sie `variant`, nicht eine Schriftgrößenklasse. Die Skala kodiert bereits das für jede Stufe erforderliche Tracking (`--tracking-display` bei ≥30px, `--tracking-title` bei 20–24px, `--tracking-heading` darunter), was bei einem `text-[27px]` nicht der Fall ist.

Die Produkt-UI geht nicht unter `text-xs`. Die Stufen `text-2xs` und `text-3xs` existieren ausschließlich für Marketingseiten.

## Einrichtung

Custom UI benötigt das CSS des Themes und Tailwind muss auf die Pakete verweisen, andernfalls werden die *innerhalb* von `@rebasepro/ui` verwendeten Utility-Klassen nicht generiert:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` richtet dies automatisch für Sie ein. Wenn Ihre benutzerdefinierte Ansicht ohne Styling dargestellt wird, ist dies das Erste, was Sie überprüfen sollten.

## Checkliste

Vor dem Release einer benutzerdefinierten Ansicht:

- Keine literalen Farbwerte – jede Farbe ist ein Token oder stammt von einer Komponente.
- Jedes `bg-`, `text-` und `border-` hat ein `dark:`-Gegenstück.
- Text ist `<Typography variant=…>`, keine Schriftgrößenklasse.
- Container sind `Card` / `Paper`, kein `<div>` mit einem manuell geschriebenen Rahmen.
- Schalten Sie das Theme um und prüfen Sie die Seite. Das ist der gesamte Test, und er dauert fünf Sekunden.

---
