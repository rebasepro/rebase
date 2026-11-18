---
sourceHash: 8d29618687855b39
title: Styling benutzerdefinierter UI
sidebar_label: Styling benutzerdefinierter UI
description: Erstellen Sie benutzerdefinierte Ansichten, Startseiten und Aktionen aus denselben Komponenten und Theme-Tokens wie der Rest des Admin-Bereichs, damit sie nativ wirken und dem Theme folgen.
---

## Übersicht

Jeder Erweiterungsmechanismus in diesem Abschnitt stellt Ihnen eine React-Komponente bereit und hält sich ansonsten heraus – eine [benutzerdefinierte Ansicht](/docs/frontend/extending), eine [Startseite](/docs/frontend/component-overrides), eine [Entitätsansicht](/docs/frontend/entity-views), ein [Slot](/docs/frontend/slots). Was jedoch keiner von ihnen vorgibt, ist, *woraus* sie gebaut werden soll.

Die Antwort lautet: aus denselben Bestandteilen, aus denen auch der Admin-Bereich aufgebaut ist. Eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht. Sie befindet sich in derselben Shell, neben denselben Tabellen, unter demselben Theme-Umschalter – daher sollte sie dieselben Komponenten, dieselbe Typografieskala und dieselben Farb-Tokens verwenden.

Diese Seite befasst sich mit der Erstellung eigener Ansichten. Um das Erscheinungsbild des Admin-Bereichs selbst anzupassen – Markenfarbe, Schriftarten, Eckenradien, Logo –, siehe [Theming & Branding](/docs/frontend/theming); da Ihre Ansichten dieselben Tokens verwenden, übernehmen sie diese Änderungen ebenfalls.

Die Alternative besteht darin, eine zweite Designsprache innerhalb derselben App zu erfinden. Das ist der häufigste Fehler, und er sieht nicht nur inkonsistent aus – er führt zu Fehlern. Ein manuell geschriebenes `color: #111` wird unsichtbar, sobald jemand zum Dark Theme wechselt, und kein Test fängt das ab.

## Die Regel

**Importieren Sie Komponenten aus `@rebasepro/ui`. Greifen Sie nur für das Layout auf ein reines `<div>` und CSS-Klassen zurück.**

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

Jede Komponente im Kit ist unter [UI components](/docs/ui/components/card/) mit ihren tatsächlichen, aus dem Quellcode generierten Props katalogisiert. Schauen Sie dort nach, bevor Sie etwas selbst bauen: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` und rund siebzig weitere existieren bereits.

## Farbe: Tokens verwenden, niemals Literale

Das Theme besteht aus einer Reihe von CSS-Variablen, die als Tailwind-Utilities bereitgestellt werden. Verwenden Sie diese und kombinieren Sie jeden Light-Wert mit einem `dark:`-Gegenstück:

| Verwendung | Klasse |
|---|---|
| Fließtext | `text-surface-900 dark:text-surface-100` |
| Sekundärtext | `text-surface-600 dark:text-surface-400` — oder einfach `<Typography color="secondary">` |
| Panel-Hintergrund | `bg-surface-accent-50 dark:bg-surface-800` |
| Rahmen | `border-surface-200 dark:border-surface-700` |
| Akzent | `text-primary` / `bg-primary` (die Markenfarbe des Projekts, standardmäßig `#0070F4`) |
| Text auf Akzent-Hintergrund | `text-on-primary` — schwarz oder weiß, je nachdem, was auf der Markenfarbe lesbar ist |

Zwei Regeln, die aus echten Problemen in der Praxis stammen:

- **Schreiben Sie niemals ein Farbliteral.** `#111`, `rgba(128,128,128,.28)`, `white` – jedes davon ist in genau einem Theme korrekt. Eine Seite, deren Zahlen mit `color: var(--fg, #111)` formatiert waren, wurde für jeden Dark-Theme-Nutzer als Schwarz-auf-Schwarz gerendert, während sie für die Person, die sie geschrieben hatte, perfekt aussah.
- **Definieren Sie niemals eine Farbe, die eine Komponente bereits festlegt.** `<Typography>` wählt automatisch die passende Vordergrundfarbe für das Theme. Das Überschreiben mit einer Klasse führt dazu, dass eine Überschrift am Ende das einzige Element auf der Seite ist, das das Theme ignoriert.

## Typografie: Die Skala verwenden

`Typography` deckt die gesamte Skala ab – `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `lead`, `caption`, `label`, `button`, `stat`, `micro`, `mono`. Verwenden Sie `variant`, keine Klasse für die Schriftgröße. Die Skala kodiert bereits die Laufweite (Tracking), die jede Stufe benötigt (`--tracking-display` bei ≥30px, `--tracking-title` bei 20–24px, `--tracking-heading` darunter), was bei einem `text-[27px]` nicht der Fall ist.

Die Produkt-UI geht nicht unter `text-xs`, mit einer Ausnahme: Die `micro`-Variante, das Label in Großbuchstaben über einem Wert, basiert auf `text-2xs`. Die Stufe `text-3xs` existiert ausschließlich für Marketing-Seiten.

## Setup

Custom UI benötigt das CSS des Themes und Tailwind muss auf die Packages verweisen, da die *innerhalb* von `@rebasepro/ui` verwendeten Utility-Klassen sonst niemals generiert werden:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` schreibt dies automatisch für Sie. Wenn Ihre benutzerdefinierte Ansicht ungestylt gerendert wird, ist dies der erste Punkt, den Sie überprüfen sollten.

## Checkliste

Vor der Bereitstellung einer benutzerdefinierten Ansicht:

- Keine Farbliterale – jede Farbe ist ein Token oder stammt von einer Komponente.
- Jedes `bg-`, `text-` und `border-` hat ein `dark:`-Gegenstück.
- Text ist `<Typography variant=…>`, keine Klasse für Schriftgröße.
- Container sind `Card` / `Paper`, kein `<div>` mit einem handgeschriebenen Rahmen.
- Schalten Sie das Theme um und betrachten Sie die Seite. Das ist der gesamte Test, und er dauert fünf Sekunden.
