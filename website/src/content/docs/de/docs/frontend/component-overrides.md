---
sourceHash: 5ceaf45e05dbf2b8
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Standard-UI-Komponenten durch benutzerdefinierte Implementierungen auf Anwendungs- oder Collection-Ebene überschreiben.
---

## Übersicht

Rebase ermöglicht es Ihnen, Standard-UI-Komponenten durch Ihre eigenen benutzerdefinierten Implementierungen zu überschreiben. Dies implementiert ein Komponenten-Swizzling-Modell im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente umschließt das Original. Das, was sie umschließt (normalerweise die integrierte Komponente), wird als `OriginalComponent`-Prop übergeben, sodass Sie es innerhalb Ihres benutzerdefinierten Layouts / Ihrer benutzerdefinierten Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Overrides

Um Komponenten global über Ihre gesamte Anwendung hinweg zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-`<Rebase>`-Provider.

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

## Komponenten-Overrides auf Collection-Ebene

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie ein `components`-Objekt unter ihrem `admin`-Block hinzu. Dies ist nützlich, um Empty States, Karten oder Detailansichten für bestimmte Modelle anzupassen.

Im Standard-Scaffold wird `config/collections/` **sowohl** vom Admin-Panel als auch vom Backend geladen, welches dieselben Dateien liest, um das Schema und die API abzuleiten. Verweisen Sie daher per **Modulpfad** auf jede Komponente, anstatt sie zu importieren. `Component` akzeptiert dieselben Formen wie `admin.Field` und `entityViews[].Builder`: einen Pfad, einen Lazy-`import()` oder die Komponente selbst.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

Die umschließende Komponente befindet sich zusammen mit dem Rest Ihres Frontend-Codes und erhält das, was sie umschließt, als `OriginalComponent` – die integrierte Komponente, es sei denn, Ihre App überschreibt sie ebenfalls (siehe [Wenn beide Scopes eine Komponente überschreiben](#wenn-beide-scopes-eine-komponente-überschreiben)):

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Jedes Modul benötigt einen **Standardexport** (Default Export). Das Collections-Vite-Plugin schreibt einen Pfad in einen Lazy-Import um, sodass die Komponente ein eigener Chunk ist und beim ersten Rendern des Overrides geladen wird. Dieses Umschreiben deckt die Dateien innerhalb des konfigurierten `collectionsDir` ab. Ein Pfad in einer Datei außerhalb davon erreicht das Admin-Panel als bloßer String: Die Konsole weist darauf hin, und anstelle dessen wird die integrierte Komponente gerendert. Schreiben Sie den Lazy-Import außerhalb von `collectionsDir` selbst: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Eine direkte Referenz (`Component: ProductCustomForm`) funktioniert ebenfalls, aber nur in einer Collection-Datei, die vom Server nicht geladen wird, da das Importieren der Komponente auch React und alle damit verbundenen Abhängigkeiten importiert.

### Wenn beide Scopes eine Komponente überschreiben

Unter 0.24 erhält der Wrapper einer Collection immer die integrierte Komponente, und der Override auf App-Ebene wird innerhalb dieser Collection übersprungen.

Die beiden Scopes setzen sich zusammen. Der Override auf App-Ebene (`<Rebase components>`) wird zuerst auf die integrierte Komponente angewendet, und der Override der Collection (`admin.components`) wird auf das Ergebnis angewendet:

| App-Ebene | Collection-Ebene | Was innerhalb dieser Collection gerendert wird |
|---|---|---|
| beliebig | keine | was überall sonst gerendert wird: der Override auf App-Ebene oder die integrierte Komponente |
| keine | wrap | der Wrapper der Collection um die integrierte Komponente |
| replace oder wrap | wrap | der Wrapper der Collection um den Override auf App-Ebene, übergeben als `OriginalComponent` |
| beliebig | replace | die Komponente der Collection allein; sie ersetzt beide |

Eine Collection kann also etwas um eine Komponente herum hinzufügen, die Ihre App bereits anpasst, ohne diese Anpassung zu verlieren. Um die Version auf App-Ebene für eine einzelne Collection zu verwerfen, ersetzen Sie sie (`replace`), anstatt sie zu wrappen (`wrap`).

---

## Gültigkeitsbereiche überschreibbarer Komponenten

### Komponenten mit App-Scope (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfzeile (Header-Leiste) oben auf der Seite |
| `"Shell.Drawer"` | Die einklappbare Hauptnavigationsleiste (Sidebar Drawer) |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Seitenleiste |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Seitenleiste |
| `"HomePage"` | Die Standard-Landingpage im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei einer Authentifizierungsanforderung angezeigt wird |

### Komponenten mit Collection-Scope (`CollectionComponentName`)

Diese Komponenten können global überschrieben werden (und fungieren als Standardwerte für alle Collections) oder auf Ebene einzelner Collections.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Landingpage der Collection |
| `"Collection.Table"` | Die standardmäßige tabellarische Tabellenblatt-Ansicht |
| `"Collection.Card"` | Der Wrapper für Einträge in der Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefiniertes Filtereingabefeld für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Button-Leiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenpanel-Container für Formular/Detail |
| `"EntityPreview"` | Inline-Vorschau-Chip für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` tragen kein `Entity.`-Präfix. `"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind nicht in der Union enthalten – sie führen zu einem Typfehler, und in reinem JavaScript wird der Override schlicht niemals angewendet.
:::

Ihr Ersatz erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die Override-Map benennt keinen Props-Typ pro Schlüssel – `ComponentOverride<P>` setzt für `P` standardmäßig `Record<string, unknown>` an – typisieren Sie den Parameter daher selbst oder übergeben Sie ein Typargument, wenn Sie möchten, dass die Props überprüft werden. Einige der integrierten Komponenten exportieren einen Props-Typ, den Sie importieren und wiederverwenden können: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` und `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` und `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Die übrigen verfügen über keinen exportierten Props-Typ – definieren Sie die Form (Shape) selbst, die Sie tatsächlich auslesen.

### Was ein `Collection.View`-Override berücksichtigen muss

`Collection.View` ist das, was ein `CollectionPanel` zeichnet, sodass die Props des Panels Ihren Override als `CollectionViewBindingProps` (`@rebasepro/cms`) erreichen, verteilt über die eigenen der Collection. Ein Ersatz, der diese ignoriert, bricht jede Seite, die die Collection einbettet. Berücksichtigen Sie mindestens folgende:

| Prop | Was der Aufrufer erwartet |
|---|---|
| `collectionOverrides` | Was der Aufrufer an der Collection ändert (ein fester Filter, eine Sortierung, der Ansichtsmodus), angewendet über der registrierten Collection |
| `fields` | Nur diese Properties, in dieser Reihenfolge: die Spalten und woraus Listenzeilen und Karten befüllt werden |
| `highlightedEntityId` | Die als ausgewählt gezeichnete Zeile; `null` für keine |
| `onEntityClick` | Wird mit der angeklickten Zeile (einer `Entity`) aufgerufen, anstatt sie zu öffnen. Das `onRowClick` des Panels trifft als dieses ein |

Das Panel übergibt außerdem `viewMode` (der Modus, in dem geöffnet werden soll), `toolbar` (die zu zeichnende Toolbar, `null` für keine) und `title` (`false`, um keinen Titel zu zeichnen), sofern dessen Aufrufer diese gesetzt hat. Das integrierte `CollectionViewBinding` verarbeitet alle davon; ein Override, der es umschließt, anstatt es zu ersetzen, kann sie direkt durchreichen.

Um von der integrierten Komponente auszugehen, anstatt bei null anzufangen, kopieren Sie deren Quellcode in Ihr Projekt und registrieren Sie die Kopie hier: Jeder Teil außer `Collection.View`, `DetailView` und dem Drag-and-Drop der Startseite kompiliert mit Paket-Imports. Siehe [Copying a built-in part](/docs/frontend/customizing#copying-a-built-in-part).

## Verwandte Themen

- [Extending Rebase](/docs/frontend/extending/) — die Erweiterungspunkte, die keinen Override erfordern
- [Custom Fields](/docs/frontend/custom-fields/) — den Editor einer einzelnen Property ersetzen anstatt einer Komponente
- [Slots](/docs/frontend/slots/) — zu einer Komponente hinzufügen, anstatt sie zu ersetzen
