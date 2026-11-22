---
sourceHash: 93a59ca2be100841
title: Theming & Branding
sidebar_label: Theming & Branding
description: Verleihen Sie dem Admin-Bereich Ihre Markenidentität – Farben, Schriftarten, Ecken, Oberflächen, Hell- und Dunkelmodus, Logo und Anmeldebildschirm –, indem Sie eine Handvoll CSS-Tokens überschreiben, anstatt Komponenten neu zu schreiben.
---

## Übersicht

Jeder Teil des Admin-Bereichs – der Drawer, die Tabellen, die Formulare, die Dialoge, Studio, der Anmeldebildschirm – basiert auf einem einzigen Satz von Design-Tokens in `@rebasepro/ui`. Ändern Sie ein Token in Ihrem eigenen Stylesheet, und jeder Teil, der es verwendet, folgt automatisch in beiden Themes.

Ein Rebranding erfolgt daher auf zwei Ebenen, wobei Sie die zweite nur selten benötigen:

1. **Tokens.** Markenfarbe, Schriftarten, Eckenradien und Oberflächen sind CSS-Variablen, die Sie in `frontend/src/index.css` überschreiben. Logo und Name sind Props an `<RebaseShell>`. Dies deckt ab, was die meisten Projekte unter „wie unseres aussehen lassen“ verstehen.
2. **Komponenten.** Wenn sich ein Teil anders *verhalten oder angeordnet sein* soll – Ihre eigene App-Bar, Ihr eigener Anmeldebildschirm –, ersetzen Sie ihn durch einen [Component Override](/docs/frontend/component-overrides).

## Markenfarbe

Eine Zeile. Fügen Sie nach den Imports in `frontend/src/index.css` einen `@theme`-Block ein:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Alles, was „primary“ verwendet, ändert sich entsprechend: ausgefüllte Buttons, Links, aktivierte Checkboxen und Schalter, Fokus-Ringe, die aktive Zeile im Drawer, Diagramme, Auswahlen. Die zugehörigen Tokens werden daraus abgeleitet, sodass Sie sie nicht selbst festlegen müssen:

| Token | Abgeleitet als | Verwendet für |
|---|---|---|
| `--color-primary-light` | um 0,15 OKLCH-Helligkeit heller | Akzenttext auf dunklen Hintergründen |
| `--color-primary-dark` | um 0,15 dunkler | Gedrückte und Hover-Zustände |
| `--color-primary-bg` | Primary mit 10 % Deckkraft | Ausgewählte Zeilen, getönte Hintergründe |
| `--color-on-primary` | Weiß oder Schwarz, je nachdem, was auf der Primärfarbe lesbar ist | Die Beschriftung eines ausgefüllten Buttons, das Häkchen in einer Checkbox |

`--color-on-primary` (neu in 0.34; davor hatten ausgefüllte Buttons immer weiße Beschriftungen) sorgt dafür, dass helle Markenfarben lesbar bleiben. Eine gelbe oder limonengrüne Primärfarbe erhält schwarze statt weiße Beschriftungen mit einem Kontrast von 2:1. Die Umschaltung erfolgt bei einer OKLCH-Helligkeit von 0,6, was für fast jede reale Markenfarbe die kontrastreichere Schriftfarbe wählt; falls Ihre Farbe nahe an diesem Schwellenwert liegt und Sie die andere Textfarbe bevorzugen, können Sie diese manuell setzen:

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` und `--color-on-secondary` funktionieren auf dieselbe Weise. Der Admin-Bereich nutzt die Sekundärfarbe kaum – sie ist für Ihre eigene Benutzeroberfläche gedacht.

## Schriftarten

Der Admin-Bereich verwendet `--font-sans` für Fließtext, `--font-headers` für Überschriften und `--font-mono` für formatierte Werte (IDs, Zeitstempel, Code). Installieren Sie die Schriftart, importieren Sie sie einmalig und verweisen Sie mit dem Token darauf:

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

Entfernen Sie die nicht mehr benötigten Schriftart-Imports (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), da sie sonst weiterhin heruntergeladen werden.

## Ecken

Drei Radien bestimmen die gesamte Benutzeroberfläche:

| Token | Standard | Verwendet für |
|---|---|---|
| `--radius-md` | `6px` | Chips, Code-Wells, kleine Kacheln |
| `--radius-lg` | `9px` | Steuerelemente, Menüs, Zeilenhervorhebungen |
| `--radius-xl` | `13px` | Cards, Dialoge, Side-Sheets |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Oberflächen

Hintergründe sind nach Rollen benannt, und jede Rolle hat einen Wert für den Hell- und den Dunkelmodus. Dies sind einfache CSS-Variablen anstelle von `@theme`-Tokens, da sie mit dem Theme wechseln – überschreiben Sie sie daher unter `:root` für den Hellmodus und `.dark` für den Dunkelmodus:

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

| Variable | Bedeutung |
|---|---|
| `--surface-frame` | die Seite hinter allem, um den Drawer herum |
| `--surface-sheet` | der Hauptinhaltsbereich |
| `--surface-card` | Cards, Tabellenzeilen, Formularbereiche |
| `--surface-raised` | ein Steuerelement oder Panel, das von einer Card abgehoben ist |
| `--surface-lifted` | Menüs, Popover, Dialoge |
| `--surface-field` | die Füllung eines Textfelds (halbtransparent) |
| `--surface-hover` / `--surface-active` | Hover- und Gedrückt-Füllungen (halbtransparent) |
| `--surface-well` | ein vertiefter Code- oder Log-Bereich |
| `--hairline` / `--hairline-strong` | Rahmenlinien und Trennlinien (halbtransparent) |

Behalten Sie die Reihenfolge bei: In jedem Theme sollten Frame, Sheet und Card in die gleiche Richtung voneinander abgestuft sein. Textfarben sind auf die Standardwerte abgestimmt; prüfen Sie daher nach einer größeren Änderung die Kontraste einer Seite in beiden Themes.

## Hell- und Dunkelmodus

Standardmäßig folgt der Admin-Bereich dem Betriebssystem, zeigt einen Theme-Umschalter an und merkt sich die Auswahl des Nutzers.

Wenn Sie nur ein einziges Theme ausliefern möchten, steuern Sie den Modus selbst. Übergeben Sie an `<Rebase>` einen `modeController`, dessen `setMode` den Umschalter ignoriert, und setzen Sie die entsprechende Klasse auf `<html>` – mit einem eigenen Controller fasst Rebase die Klassen der Seite nicht an:

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logo und Name

`<RebaseShell>` nimmt den Namen und das Logo entgegen, die im Drawer angezeigt werden. Dasselbe Logo erscheint auch auf dem integrierten Anmeldebildschirm. Legen Sie die Dateien in `frontend/public/` ab:

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` ist optional. Verwenden Sie es, wenn Ihr Logo dunkel gestaltet ist und auf dem dunklen Theme nicht sichtbar wäre; ohne diese Angabe wird `logo` für beide Themes verwendet.

Titel und Icon des Browser-Tabs stammen aus `frontend/index.html`:

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## Der Anmeldebildschirm

Der integrierte Anmeldebildschirm übernimmt Ihre Markenfarbe, Schriftarten, Oberflächen und das `logo` der Shell ohne zusätzlichen Code.

Um die Texte anzupassen oder eigene Inhalte hinzuzufügen, übergeben Sie an `<RebaseAuth>` eine konfigurierte `LoginView`. In der generierten `App.tsx` befindet sich `authController` bereits im Gültigkeitsbereich:

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

Weitere Props: `topComponent` (über den Anmelde-Buttons), `layout="form-first"` (ohne eigene Card, für Seiten, die den Anmeldebereich selbst einbetten, wie z. B. ein Split-Screen neben einem Produktbild) und `disableSignupScreen`.

Um den Bildschirm vollständig zu ersetzen, überschreiben Sie `"Auth.LoginView"` (siehe [Component Overrides](/docs/frontend/component-overrides)).

## Über Tokens hinaus

- **Ersetzen Sie einen Teil der Shell** – die App-Bar, den Drawer, eine Navigationszeile, den Anmeldebildschirm – durch einen [Component Override](/docs/frontend/component-overrides).
- **Fügen Sie eigene Seiten hinzu**, die zum Theme passen: [Styling Custom UI](/docs/frontend/styling) erklärt, aus welchen Komponenten und Klassen Sie diese aufbauen können, damit Ihre Tokens auch dort greifen.

## Checkliste

- Die Markenfarbe wird einmalig in `@theme` festgelegt und nirgendwo sonst. Verwenden Sie keine Literalwerte in Komponenten, sondern nutzen Sie `bg-primary` / `text-primary`.
- Überprüfen Sie einen ausgefüllten Button und eine aktivierte Checkbox: Beschriftung und Häkchen müssen gut lesbar sein.
- Wechseln Sie das Theme und prüfen Sie eine Tabelle, ein Formular und einen Dialog in beiden Modi.
- Wenn Sie die Schriftarten ersetzt haben, entfernen Sie die Standard-Schriftarten-Imports.
