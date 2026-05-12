---
title: Strumenti Studio
sidebar_label: Studio
slug: it/docs/studio
description: Rebase Studio fornisce strumenti per sviluppatori per la modifica visiva dello schema, query SQL, scripting JavaScript, gestione delle policy RLS e navigazione dello storage.
---

## Panoramica

Rebase ha due modalità:

- **Modalità Contenuto** — Per editor di contenuti e team operativi. Mostra le collezioni e la gestione dei dati.
- **Modalità Studio** — Per gli sviluppatori. Sblocca gli strumenti rivolti agli sviluppatori.

Passa da una modalità all'altra utilizzando il controller della modalità admin o l'interruttore dell'interfaccia utente nella barra dell'app.

## Strumenti Studio Integrati

### Editor di Collezioni

Un editor di schema visuale che ti permette di creare e modificare collezioni tramite un'interfaccia utente drag-and-drop. Quando salvi le modifiche, utilizza [ts-morph](https://ts-morph.com/) per aggiornare i tuoi file sorgente TypeScript tramite manipolazione AST — preservando tutto il codice esistente e la logica personalizzata.

![Editor di collezioni](/img/collection_editor.png)

```tsx
import { RebaseCMS } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Console SQL

Esegui query SQL grezze sul tuo database PostgreSQL e visualizza i risultati in una tabella:

```tsx
import { SQLEditor } from "@rebasepro/studio";

{ slug: "sql", name: "SQL Console", view: <SQLEditor /> }
```

### Console JS

Scrivi ed esegui JavaScript utilizzando l'SDK di Rebase:

```tsx
import { JSEditor } from "@rebasepro/studio";

{ slug: "js", name: "JS Console", view: <JSEditor /> }
```

### Editor di Policy RLS

Visualizza e gestisci le policy di Row Level Security per le tue tabelle PostgreSQL:

```tsx
import { RLSEditor } from "@rebasepro/studio";

{ slug: "rls", name: "RLS Policies", view: <RLSEditor /> }
```

### Browser Storage

Naviga, carica e gestisci i file nei tuoi backend di storage:

```tsx
import { StorageView } from "@rebasepro/studio";

{ slug: "storage", name: "Storage", view: <StorageView /> }
```

## Aggiunta di Viste Studio

Gli strumenti Studio sono automaticamente disponibili quando includi il componente `RebaseStudio` all'interno della tua app:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

Queste viste appaiono nella navigazione della barra laterale quando la modalità Studio è attiva.

## Passi Successivi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Collezioni](/docs/collections)** — Configurazione delle collezioni
