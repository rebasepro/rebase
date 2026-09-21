---
sourceHash: 973d76b134971c29
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Überschreiben Sie Standard-UI-Komponenten mit benutzerdefinierten Implementierungen auf Anwendungs- oder Collection-Ebene.
---

## Übersicht

Rebase ermöglicht es Ihnen, Standard-UI-Komponenten durch Ihre eigenen benutzerdefinierten Implementierungen zu überschreiben. Dies implementiert ein Komponenten-Swizzling-Modell im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente kapselt (wrappt) das Original. Die integrierte Komponente wird als `OriginalComponent`-Prop übergeben, sodass Sie sie innerhalb Ihres benutzerdefinierten Layouts bzw. Ihrer Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Overrides

Um Komponenten global für Ihre gesamte Anwendung zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-Provider `<Rebase>`.

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

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie ein `components`-Objekt unterhalb des `admin`-Blocks hinzu. Dies ist nützlich, um leere Zustände (Empty States), Cards oder Detailansichten für bestimmte Modelle anzupassen.

<span class="since-badge" data-since="0.22">Seit 0.22</span> Im Standard-Scaffolding wird `config/collections/` **sowohl** vom Admin-Panel als auch vom Backend geladen, welches dieselben Dateien liest, um das Schema und die API abzuleiten. Verweisen Sie daher auf jede Komponente per **Modulpfad** anstatt sie zu importieren. `Component` akzeptiert dieselben Formate wie `admin.Field` und `entityViews[].Builder`: einen Pfad, ein Lazy-`import()` oder die Komponente selbst.

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

Die wrappende Komponente liegt zusammen mit dem Rest Ihres Frontend-Codes und erhält die integrierte Komponente als `OriginalComponent`:

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

Jedes Modul benötigt einen **Default-Export**. Das Vite-Plugin für Collections schreibt einen Pfad in einen Lazy-Import um, sodass die Komponente ein eigener Chunk ist und erst geladen wird, wenn das Override zum ersten Mal gerendert wird. Diese Umschreibung deckt Dateien innerhalb des konfigurierten `collectionsDir` ab. Ein Pfad in einer Datei außerhalb davon erreicht das Admin-Panel als einfacher String: Dies wird in der Konsole gemeldet und die integrierte Komponente wird stattdessen gerendert. Außerhalb von `collectionsDir` müssen Sie den Lazy-Import selbst schreiben: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Eine direkte Referenz (`Component: ProductCustomForm`) funktioniert ebenfalls, jedoch nur in einer Collection-Datei, die vom Server nicht geladen wird, da der Import der Komponente auch React und alle damit verbundenen Abhängigkeiten lädt.

---

## Gültigkeitsbereiche überschreibbarer Komponenten

### Komponenten mit App-Gültigkeitsbereich (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-Providers `<Rebase>` überschrieben werden, da sie die grundlegende Shell-Struktur darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Header-Leiste am oberen Rand der Seite |
| `"Shell.Drawer"` | Das einklappbare Navigationsmenü der Haupt-Sidebar |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Sidebar |
| `"HomePage"` | Die Standard-Landingpage im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Cards auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei erforderlicher Authentifizierung angezeigt wird |

### Komponenten mit Collection-Gültigkeitsbereich (`CollectionComponentName`)

Diese Komponenten können global (als Standard für alle Collections) oder für einzelne Collections überschrieben werden.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Landingpage der Collection |
| `"Collection.Table"` | Die standardmäßige Tabellenansicht |
| `"Collection.Card"` | Der Wrapper für Elemente in der Card-Ansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Buttons oberhalb der Tabelle/Cards |
| `"Collection.FilterField"` | Benutzerdefiniertes Filtereingabefeld für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Button-Leiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenleisten-Container für Formular/Details |
| `"EntityPreview"` | Inline-Chip-Vorschau für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entity fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` besitzen kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind
nicht in der Union enthalten – sie führen zu Typfehlern, und in reinem JavaScript wird das Override
schlichtweg niemals angewendet.
:::

Ihr Ersatz erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die
Override-Map legt keinen Props-Typ pro Schlüssel fest – `ComponentOverride<P>` setzt für
`P` standardmäßig `Record<string, unknown>` ein. Typisieren Sie den Parameter daher selbst
oder übergeben Sie ein Typargument, wenn Sie eine Typprüfung der Props wünschen. Einige der
integrierten Komponenten exportieren einen Props-Typ, den Sie importieren und wiederverwenden können:
`CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps` und
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` und
`EntityFormActionsProps` (`@rebasepro/cms`). Die übrigen Komponenten bieten keinen exportierten Props-Typ –
definieren Sie hier einfach die Struktur, die Sie tatsächlich auslesen.

## Verwandte Themen

- [Rebase erweitern](/docs/frontend/extending/) — Erweiterungspunkte, die kein Override erfordern
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — Ersetzen des Editors einer einzelnen Eigenschaft statt einer ganzen Komponente
- [Slots](/docs/frontend/slots/) — Erweitern einer Komponente, anstatt sie zu ersetzen
