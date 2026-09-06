---
sourceHash: 08efd8549191e760
title: Panoramica dell'Architettura
sidebar_label: Architettura
description: Scopri come il backend, il frontend, l'SDK client e il database di Rebase si integrano per formare un Backend-as-a-Service completo.
---

## Architettura del Sistema

Rebase è una piattaforma full-stack con quattro livelli:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  React Admin UI  •  Custom Views  •  Plugins  •  Your App      │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componenti Chiave

### Sistema di Bootstrapper

Il backend si inizializza tramite un sistema di bootstrapper basato su plugin. La logica specifica del database è disaccoppiata in un proprio pacchetto, e i bootstrappers gestiscono l'inizializzazione del database, dell'autenticazione e dei servizi interni.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
        connectionString: process.env.DATABASE_URL!
    })
```

Le collezioni si risolvono automaticamente rispetto al bootstrapper configurato tramite il registro interno di iniezione delle dipendenze.

:::tip
Il `createPostgresAdapter` gestisce automaticamente il pooling delle connessioni al database, la risoluzione dello schema e la configurazione `LISTEN/NOTIFY` in tempo reale.
:::

### Registro delle Collezioni

Il `BackendCollectionRegistry` è l'indice runtime di tutte le collezioni, le loro tabelle PostgreSQL, gli enum e le relazioni Drizzle. Viene popolato all'avvio dalle tue definizioni di collezione.

### Servizio in Tempo Reale

La sincronizzazione in tempo reale utilizza il meccanismo nativo `LISTEN/NOTIFY` di PostgreSQL:

1. Avviene una mutazione dei dati (inserimento, aggiornamento, eliminazione)
2. Il backend emette un `NOTIFY` su un canale
3. Il `RealtimeService` riceve la notifica
4. Trasmette la modifica a tutti i client WebSocket connessi
5. I componenti React si ri-renderizzano con i nuovi dati

Per **deployments multi-istanza** (ad esempio, Cloud Run con più repliche), fornisci una `connectionString` nel tuo PostgresBootstrapper in modo che tutte le repliche condividano la stessa connessione `LISTEN`.

### Registro dello Storage

Come i driver, i backend di storage sono registrati in un registro. Puoi avere più provider di storage (locale, S3) e instradare diversi campi file a diversi backend usando `storageId`.

## Mappa dei Pacchetti

| Package | Ruolo | Usato da |
|---------|------|---------|
| `@rebasepro/types` | Interfacce TypeScript per collezioni, proprietà, entità, plugin | Tutto |
| `@rebasepro/server` | Inizializzazione del server backend, REST API, autenticazione, storage, WebSocket | Backend |
| `@rebasepro/client` | SDK client — Trasporto HTTP, WebSocket, autenticazione | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controller, moduli, routing, hook | Frontend |
| `@rebasepro/ui` | Libreria di componenti UI standalone (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Viste di login, hook del controller di autenticazione, gestione utenti | Frontend |
| `@rebasepro/studio` | Editor di collezioni, console SQL, console JS, editor RLS, browser di storage | Frontend |
| `@rebasepro/cli` | CLI per generazione schema, migrazioni DB, generazione SDK | Strumenti di sviluppo |
| `@rebasepro/forms` | Gestione dello stato dei form React leggera | Frontend |
| `@rebasepro/plugin-ai` | Plugin di autocompletamento campi basato su AI | Frontend |
| `@rebasepro/plugin-data-import-export` | Importazione ed esportazione CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Rilevamento automatico dello schema dai dati del database esistenti | Backend/CLI |

## Flusso dei Dati

### Flusso di Lettura
1. L'utente apre una collezione nell'interfaccia utente di amministrazione
2. L'SDK client invia `GET /api/data/:slug` + apre una sottoscrizione WebSocket
3. Il backend interroga PostgreSQL tramite Drizzle ORM
4. Il trasformatore di dati deserializza i record del database nel formato entità
5. La risposta viene inviata al frontend, i componenti vengono renderizzati
6. WebSocket mantiene la vista sincronizzata in tempo reale

### Flusso di Scrittura
1. L'utente modifica un'entità nel form
2. Vengono eseguiti i callback `beforeSave` (validazione, trasformazione)
3. L'SDK client invia `PATCH /api/data/:slug/:id`
4. Il backend serializza i valori, esegue l'`UPDATE` di Drizzle
5. Vengono eseguiti i callback `afterSave` (effetti collaterali)
6. La trasmissione `NOTIFY` attiva l'aggiornamento WebSocket a tutti i client
7. Se la cronologia è abilitata, viene registrato uno entity

## Prossimi Passi

- **[Schema come Codice](/docs/architecture/schema-as-code)** — L'approccio TypeScript-first
- **[Panoramica del Backend](/docs/backend)** — Configurazione del server
- **[Collezioni](/docs/collections)** — Definisci il tuo schema dati
---
