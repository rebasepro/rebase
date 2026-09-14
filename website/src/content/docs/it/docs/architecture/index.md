---
sourceHash: fa7350988287074c
title: Panoramica dell'architettura
sidebar_label: Architettura
description: Scopri come il backend, il frontend, l'SDK client e il database di Rebase si integrano per formare un Backend-as-a-Service completo.
---

## Architettura del sistema

Rebase è una piattaforma full-stack strutturata su quattro livelli:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componenti chiave

### Sistema di adattatori per database (Database Adapter System)

Il backend viene inizializzato attraverso un pattern unificato di adattatori per database. La logica specifica del database è disaccoppiata nel proprio pacchetto, e l'adattatore gestisce automaticamente il connection pooling, la risoluzione dello schema e l'instradamento degli eventi in tempo reale.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Le collezioni vengono risolte automaticamente rispetto all'adattatore configurato tramite il registro interno di dependency injection.

:::tip
`createPostgresAdapter` gestisce automaticamente il connection pooling del database, la risoluzione dello schema e la configurazione di `LISTEN/NOTIFY` in tempo reale.
:::

### Registro delle collezioni (Collection Registry)

Il `BackendCollectionRegistry` è l'indice a runtime di tutte le collezioni, delle loro tabelle PostgreSQL, degli enum e delle relazioni Drizzle. Viene popolato all'avvio a partire dalle definizioni delle tue collezioni.

### Servizio in tempo reale (Realtime Service)

La sincronizzazione in tempo reale utilizza il meccanismo nativo `LISTEN/NOTIFY` di PostgreSQL:

1. Si verifica una mutazione dei dati (insert, update, delete)
2. Il backend emette un `NOTIFY` su un canale
3. Il `RealtimeService` riceve la notifica
4. Trasmette la modifica a tutti i client WebSocket connessi
5. I componenti React eseguono il re-render con i nuovi dati

Per i **deployment multi-istanza** (ad es. Cloud Run con repliche multiple), fornisci una `connectionString` nel tuo PostgresBootstrapper in modo che tutte le repliche condividano la stessa connessione `LISTEN`.

### Registro dello storage (Storage Registry)

Analogamente ai driver, i backend di storage sono registrati all'interno di un registro. È possibile avere più provider di storage (locale, S3) e instradare diversi campi di tipo file verso differenti backend utilizzando `storageId`.

## Mappa dei pacchetti

| Pacchetto | Ruolo | Utilizzato da |
|-----------|-------|---------------|
| `@rebasepro/types` | Interfacce TypeScript per collezioni, proprietà, entità, plugin | Tutto |
| `@rebasepro/server` | Inizializzazione del server backend, API REST, auth, storage, WebSocket | Backend |
| `@rebasepro/client` | SDK Client — Trasporto HTTP, WebSocket, auth | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controller, form, route, hook | Frontend |
| `@rebasepro/ui` | Libreria standalone di componenti UI (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Viste di login, hook per i controller di autenticazione, gestione utenti | Frontend |
| `@rebasepro/studio` | Editor delle collezioni, console SQL, console JS, editor RLS, browser dello storage | Frontend |
| `@rebasepro/cli` | CLI per generazione schemi, migrazioni DB, generazione SDK | Strumenti di sviluppo |
| `@rebasepro/forms` | Gestione leggera dello stato dei form in React | Frontend |
| `@rebasepro/plugin-ai` | Plugin di autocompletamento dei campi basato su IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importazione ed esportazione CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Rilevamento automatico dello schema dai dati del database esistente | Backend/CLI |

## Flusso dei dati

### Flusso di lettura
1. L'utente apre una collezione in Rebase CMS
2. L'SDK Client invia `GET /api/data/:slug` e apre una sottoscrizione WebSocket
3. Il backend interroga PostgreSQL tramite Drizzle ORM
4. Il trasformatore di dati deserializza i record del database nel formato entità
5. La risposta viene inviata al frontend, i componenti eseguono il rendering
6. Il WebSocket mantiene la vista sincronizzata in tempo reale

### Flusso di scrittura
1. L'utente modifica un'entità nel form
2. Vengono eseguiti i callback `beforeSave` (validazione, trasformazione)
3. L'SDK Client invia `PATCH /api/data/:slug/:id`
4. Il backend serializza i valori, esegue l'`UPDATE` di Drizzle
5. Vengono eseguiti i callback `afterSave` (effetti collaterali)
6. La trasmissione del `NOTIFY` attiva l'aggiornamento WebSocket su tutti i client
7. Se la cronologia è abilitata, viene registrato uno snapshot

## Passaggi successivi

- **[Schema as Code](/docs/architecture/schema-as-code)** — L'approccio TypeScript-first
- **[Panoramica del Backend](/docs/backend)** — Configurazione del server
- **[Collezioni](/docs/collections)** — Definisci lo schema dei tuoi dati
