---
sourceHash: 3e8accd144f401d4
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Überschreiben Sie Standard-UI-Komponenten durch benutzerdefinierte Implementierungen auf Anwendungs- oder Collection-Ebene.
---

## Übersicht

Mit Rebase können Sie Standard-UI-Komponenten durch Ihre eigenen benutzerdefinierten Implementierungen überschreiben. Dies implementiert ein Komponenten-Swizzling-Modell im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente umschließt das Original. Die integrierte Komponente wird als `OriginalComponent`-Prop übergeben, sodass Sie sie innerhalb Ihres benutzerdefinierten Layouts bzw. Ihrer Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Overrides

Um Komponenten global für Ihre gesamte Anwendung zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-`<Rebase>`-Provider.

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

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie deren Definition ein `components`-Objekt hinzu. Dies ist nützlich, um Empty States, Karten oder Detailansichten für bestimmte Modelle anzupassen.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Gültigkeitsbereiche überschreibbarer Komponenten

### Komponenten mit App-Gültigkeitsbereich (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfzeile am oberen Rand der Seite |
| `"Shell.Drawer"` | Die einklappbare Haupt-Sidebar-Navigationsleiste |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Sidebar |
| `"HomePage"` | Die Standard-Startseite im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei einer Authentifizierungsanforderung angezeigt wird |

### Komponenten mit Collection-Gültigkeitsbereich (`CollectionComponentName`)

Diese Komponenten können global überschrieben werden (und fungieren als Standardwerte für alle Collections) oder auf Ebene einzelner Collections.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Übersichtsseite der Collection |
| `"Collection.Table"` | Die standardmäßige tabellarische Ansicht |
| `"Collection.Card"` | Der Wrapper für Einträge in der Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefiniertes Filtereingabefeld für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Button-Leiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenbereich-Container (Side Panel) für Formular/Detail |
| `"EntityPreview"` | Inline-Chip-Vorschau für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` tragen kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind
nicht im Union-Typ enthalten – sie führen zu Typfehlern, und in reinem JavaScript
wird der Override schlichtweg niemals angewendet.
:::

Ihre Ersatzkomponente erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die
Override-Map gibt keinen Props-Typ pro Schlüssel vor – `ComponentOverride<P>` setzt als Standardwert für
`P` den Typ `Record<string, unknown>` ein – typisieren Sie den Parameter daher selbst oder übergeben Sie ein
Typargument, wenn Sie eine Typprüfung für die Props wünschen. Einige der integrierten Komponenten exportieren
einen Props-Typ, den Sie importieren und wiederverwenden können: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps` und
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` und
`EntityFormActionsProps` (`@rebasepro/cms`). Die übrigen besitzen keinen exportierten Props-Typ
– definieren Sie hierfür die Struktur (Shape), die Sie tatsächlich auslesen.

## Verwandte Themen

- [Rebase erweitern](/docs/frontend/extending/) — Erweiterungspunkte, die keinen Override erfordern
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — Ersetzen des Editors einer einzelnen Eigenschaft anstelle einer ganzen Komponente
- [Slots](/docs/frontend/slots/) — Erweitern einer Komponente, anstatt sie zu ersetzen
