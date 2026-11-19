---
sourceHash: bad5fe6e295033b6
title: Komponenten-Überschreibungen (Swizzling)
sidebar_label: Komponenten-Überschreibungen
description: Standard-UI-Komponenten durch eigene Implementierungen auf Anwendungs- oder Collection-Ebene überschreiben.
---

## Übersicht

Rebase ermöglicht es Ihnen, Standard-UI-Komponenten durch Ihre eigenen Implementierungen zu überschreiben. Dies implementiert ein Swizzling-Modell im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente kapselt (wrappt) das Original ein. Was sie umschließt (normalerweise die integrierte Komponente), wird als `OriginalComponent`-Prop übergeben, sodass Sie sie innerhalb Ihres benutzerdefinierten Layouts / Ihrer benutzerdefinierten Logik rendern können.

Um nur das *Aussehen* des Admins zu ändern – Farben, Schriftarten, Ecken, Logo – benötigen Sie keine Überschreibung: siehe [Theming & Branding](/docs/frontend/theming).

Komponenten-Überschreibungen können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Überschreibungen

Um Komponenten global in Ihrer gesamten Anwendung zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-`<Rebase>`-Provider.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Komponenten-Überschreibungen auf Collection-Ebene

Um Komponenten nur für eine einzelne Tabelle zu überschreiben, übergeben Sie `components` in deren
`customizeTable`. Dies ist nützlich für den Empty State, die Cards oder das Formular einer
bestimmten Tabelle. Jedes `Component` ist die Komponente selbst, importiert per Wert:
die Datei wird ausschließlich im Browser ausgeführt.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Eine umhüllende Komponente erhält das, was sie umschließt, als `OriginalComponent`: die
integrierte Komponente, es sei denn, Ihre App überschreibt diese ebenfalls (siehe
[Wenn beide Scopes eine Komponente überschreiben](#wenn-beide-scopes-eine-komponente-überschreiben)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Ein String-Pfad oder ein Lazy `() => import(…)` Thunk in `Component` wirft beim
Laden des Moduls einen Fehler mit dem Hinweis, was stattdessen zu schreiben ist.

### Wenn beide Scopes eine Komponente überschreiben

Die beiden Scopes lassen sich kombinieren. Die Überschreibung auf App-Ebene (`<Rebase components>`) wird zuerst auf die integrierte Komponente angewendet, und die der Tabelle (`components` in `customizeTable`) wird auf das Ergebnis angewendet:

| App-Ebene | Collection-Ebene | Was innerhalb dieser Collection gerendert wird |
|---|---|---|
| beliebig | keine | was überall sonst gerendert wird: die Überschreibung auf App-Ebene oder die integrierte Komponente |
| keine | wrap | der Wrapper der Collection um die integrierte Komponente |
| replace oder wrap | wrap | der Wrapper der Collection um die Überschreibung auf App-Ebene, übergeben als `OriginalComponent` |
| beliebig | replace | die Komponente der Collection allein; sie ersetzt beide |

Eine Collection kann also etwas um eine Komponente herum hinzufügen, die Ihre App bereits anpasst, ohne diese Anpassung zu verlieren. Um die Version auf App-Ebene für eine Collection zu verwerfen, ersetzen Sie sie (`replace`), anstatt sie zu kapseln (`wrap`).

---

## Scopes überschreibbarer Komponenten

### Komponenten mit App-Scope (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfzeile am oberen Rand der Seite |
| `"Shell.Drawer"` | Die einklappbare Hauptnavigationsleiste (Sidebar-Drawer) |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Sidebar |
| `"HomePage"` | Die Standard-Startseite im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei der Authentifizierungsanforderung angezeigt wird |

### Komponenten mit Collection-Scope (`CollectionComponentName`)

Diese Komponenten können global überschrieben werden (und dienen dann als Standardwerte für alle Collections) oder für einzelne Collections.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Übersichtsseite der Collection |
| `"Collection.Table"` | Die standardmäßige tabellarische Tabellenansicht |
| `"Collection.Card"` | Der Wrapper für Einträge in der Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefiniertes Filtereingabefeld für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Leiste für Formularabsendungs-/-abbruch-Buttons |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenpanel-Container für Formulare/Details |
| `"EntityPreview"` | Inline-Chip-Vorschau für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` haben kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind
nicht in der Typ-Union enthalten – sie führen zu Typfehlern, und in reinem JavaScript wird die
Überschreibung einfach niemals angewendet.
:::

Ihre Ersatzkomponente erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die
Überschreibungs-Map definiert keinen Props-Typ pro Schlüssel – `ComponentOverride<P>` setzt für
`P` standardmäßig `Record<string, unknown>` ein – typisieren Sie den Parameter daher selbst oder übergeben Sie ein
Typargument, wenn Sie möchten, dass die Props überprüft werden. Einige der integrierten Komponenten exportieren
einen Props-Typ, den Sie importieren und wiederverwenden können: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
und `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` und
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). Für die übrigen gibt es keinen exportierten Props-Typ – schreiben Sie die Struktur, die Sie
tatsächlich auslesen.

### Was eine `Collection.View`-Überschreibung berücksichtigen muss

`Collection.View` ist das, was ein `CollectionPanel` darstellt. Daher erreichen die Props des Panels
Ihre Überschreibung als `CollectionViewBindingProps` (`@rebasepro/cms`), überlagert mit den
eigenen Props der Collection. Ein Ersatz, der diese ignoriert, bricht jede Seite, die
die Collection einbettet. Berücksichtigen Sie mindestens folgende:

| Prop | Was der Aufrufer erwartet |
|---|---|
| `collectionOverrides` | Was der Aufrufer an der Collection ändert (ein fester Filter, eine Sortierung, der Ansichtsmodus), angewendet über der registrierten Collection |
| `fields` | Nur diese Eigenschaften, in dieser Reihenfolge: die Spalten und woraus Zeilen und Karten der Liste befüllt werden |
| `highlightedIds` | Die IDs der Zeilen, die als ausgewählt dargestellt werden; `[]` für keine |
| `onRowClick` | Wird mit der angeklickten Zeile (wie vom Server gesendet) und deren ID aufgerufen, anstatt sie zu öffnen. Das panel-eigene `onRowClick` |

Das Panel übergibt auch `viewMode` (der Modus, in dem geöffnet werden soll), `toolbar` (die Toolbar,
die gezeichnet werden soll, `null` für keine) und `title` (`false`, um keinen Titel anzuzeigen), sofern dessen
Aufrufer diese festgelegt hat. Das integrierte `CollectionViewBinding` verarbeitet alle davon; eine
Überschreibung, die es kapselt, anstatt es zu ersetzen, kann sie direkt durchreichen.

Um mit dem integrierten Teil zu beginnen, anstatt bei Null anzufangen, kopieren Sie dessen Quellcode in
Ihr Projekt und registrieren Sie die Kopie hier: Jeder Teil außer `Collection.View`,
`DetailView` und dem Drag-and-Drop der Startseite kompiliert mit Paket-Imports.
Siehe [Kopieren eines integrierten Teils](/docs/frontend/customizing#copying-a-built-in-part).

## Verwandte Themen

- [Theming & Branding](/docs/frontend/theming/) — Den Admin mit Design-Tokens statt Komponenten umgestalten
- [Rebase erweitern](/docs/frontend/extending/) — Die Erweiterungspunkte, die keine Überschreibung erfordern
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — Den Editor für eine einzelne Eigenschaft anstelle einer Komponente ersetzen
- [Slots](/docs/frontend/slots/) — Zu einer Komponente hinzufügen, anstatt sie zu ersetzen
