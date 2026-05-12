---
title: Distribuzione di Rebase su Scaleway
description: Scopri come distribuire Rebase su Scaleway per un'infrastruttura cloud sicura, basata in Francia, utilizzando i Serverless Containers.
sidebar_label: Scaleway
---

Scaleway è un fornitore cloud europeo di prim'ordine con sede in Francia e datacenter a Parigi, Amsterdam e Varsavia. È una scelta eccellente per le organizzazioni che privilegiano la sovranità dei dati dell'UE.

Consigliamo di utilizzare il **Managed Database** di Scaleway per un supporto Postgres affidabile e i **Serverless Containers** per scalare dinamicamente l'applicazione Node.js Rebase.

## 1. Crea un Managed Postgres Database

I Managed Database di Scaleway offrono backup automatici e alta disponibilità.

1. Nella Console Scaleway, vai a **PostgreSQL**.
2. Clicca su **Crea un'istanza di database**.
3. Scegli una Regione (es. Parigi - `PAR1`).
4. Seleziona un Tipo di Nodo (un **Play2-Pico** o **Pro2-XXS** standard funziona bene).
5. Aggiungi un nome di database (`rebase_db`) e definisci una password utente incredibilmente sicura.
6. Una volta distribuito, annota la **stringa di connessione** (URI) dal dashboard. Sarà simile a:
   `postgres://user:password@ip:port/rebase_db`

## 2. Crea e carica il Container

I Serverless Containers di Scaleway eseguono immagini Docker standard. Per prima cosa, crea il backend Rebase localmente e caricalo nel Scaleway Container Registry.

1. Vai a **Container Registry** nella Console Scaleway e crea un Namespace (es. `rebase-apps`).
2. Effettua l'accesso al registry dal tuo terminale locale utilizzando le istruzioni fornite.
3. Crea la tua app Rebase utilizzando il `Dockerfile` generato:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest ./backend
```

4. Carica l'immagine:

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Distribuisci il Serverless Container

Ora distribuisci l'immagine completamente serverless senza gestire l'infrastruttura.

1. Vai a **Serverless Containers**.
2. Clicca su **Crea un Container**.
3. Scegli l'immagine che hai appena caricato dal Container Registry.
4. Imposta la Porta su **3001**.
5. Sotto Variabili d'ambiente, aggiungi quanto segue in modo sicuro:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | L'URI dal passaggio del tuo Managed Postgres |
| `JWT_SECRET` | Una stringa casuale sicura di 32+ caratteri per la firma dei token di autenticazione |
| `NODE_ENV` | `production` |

6. Clicca su **Distribuisci Container**.

Scaleway effettuerà immediatamente il provisioning del container e ti fornirà un URL di endpoint pubblico (es. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Nota: Per una rigorosa conformità dei dati, verifica che i dettagli della tua Organizzazione Scaleway riflettano la tua entità aziendale europea.*

---
