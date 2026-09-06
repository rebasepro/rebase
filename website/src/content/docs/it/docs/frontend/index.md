---
sourceHash: 03d03e9fa055a194
title: Panoramica Frontend
sidebar_label: Frontend
description: Costruisci e personalizza il pannello di amministrazione Rebase con React — controller, scaffold, routing e viste.
---

## Panoramica

Il frontend Rebase è un **framework React** che renderizza il tuo pannello di amministrazione. Legge le definizioni delle tue collezioni e genera automaticamente tabelle, moduli, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice del tuo URL distribuito. Se invece costruisci la tua app di prodotto, puoi montare l'amministrazione sotto un prefisso come `/admin` nella stessa distribuzione — vedi [Cambiare l'URL di Base](/docs/getting-started/deployment#changing-the-base-url).

I componenti chiave che costituiscono un frontend Rebase:

```tsx
<Rebase
    client={rebaseClient}
    collectionRegistryController={collectionRegistryController}
    urlController={urlController}
    navigationStateController={navigationStateController}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="My App" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## Il Rebase Provider

`<Rebase>` è il provider radice che rende tutte le funzionalità di Rebase disponibili ai componenti figli tramite contesto. Accetta:

| Proprietà | Descrizione |
|-----------|-------------|
| `client` | Istanza di `RebaseClient` per dati, autenticazione e archiviazione |
| `collectionRegistryController` | Risolve i percorsi e le configurazioni delle collezioni |
| `urlController` | Costruisce URL e gestisce il routing |
| `navigationStateController` | Gestisce lo stato della navigazione, le viste e i plugin |
| `authController` | Stato e metodi di autenticazione |
| `storageSource` | Operazioni di archiviazione file |
| `userConfigPersistence` | Preferenze UI locali (larghezza colonne, ecc.) |
| `entityViews` | Schede di vista entità personalizzate globali |
| `entityActions` | Azioni globali per le entità |
| `plugins` | Istanze di plugin (proprietà legacy — preferire il passaggio tramite controller di navigazione) |

## Controller

I controller sono hook di React che configurano aspetti specifici del framework:

### `useBuildNavigationStateController`

Il controller principale che collega tutto insieme:

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Definizioni delle collezioni
    views: customViews,                   // Viste di navigazione personalizzate
    plugins,                              // Istanze di plugin
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

### `useBuildCollectionRegistryController`

Gestisce come le collezioni vengono risolte dai percorsi URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildUrlController`

Configura la generazione di URL:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Gestisce il tema chiaro/scuro:

```typescript
const modeController = useBuildModeController();
// Fornisce: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Alterna tra le modalità Studio e Contenuto:

```typescript
const adminModeController = useBuildAdminModeController();
// Fornisce: adminModeController.mode ("studio" | "content")
```

## Componenti Scaffold

| Componente | Descrizione |
|------------|-------------|
| `<Scaffold>` | Contenitore del layout principale con sidebar responsiva |
| `<AppBar>` | Barra di navigazione superiore con ricerca, interruttore modalità, menu utente |
| `<Drawer>` | Navigazione laterale con elenco collezioni e link alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità nel pannello laterale |
| `<RebaseRoutes>` | Contenitore di route che si integra con React Router |
| `<RebaseRoute>` | Gestisce le route delle collezioni (`/c/*`) |
| `<ContentHomePage>` | Pagina iniziale predefinita che mostra le schede delle collezioni |
| `<StudioHomePage>` | Pagina iniziale della modalità Studio con strumenti per sviluppatori |

## Viste Personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate:

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "Impostazioni App",
        view: <AppSettings />,
        nestedRoutes: true  // Supporta sotto-percorsi,
        admin: {
            icon: "dashboard",
            group: "Analisi",
            icon: "settings"
        }
    }
];

```

## Stile

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiaro/scuro. Personalizza tramite:

- **Proprietà CSS personalizzate** — Sovrascrivi i token di design
- **`ModeControllerProvider`** — Controlla la modalità chiaro/scuro
- **Configurazione Tailwind** — Personalizzazione standard di Tailwind

```css
/* Sovrascrivi i token di design */
:root {
    --font-sans: "Inter", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Passi Successivi

- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Costruisci campi modulo personalizzati
- **[Viste Entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor di entità
- **[Modalità di Vista](/docs/frontend/view-modes)** — Lista, Tabella, Schede, Kanban
- **[Plugin](/docs/plugins)** — Estendi il framework

---
