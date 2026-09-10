---
sourceHash: 8065b392b2b6690b
title: Deploy di Rebase su Scaleway
description: Scopri come distribuire Rebase su Scaleway per un'infrastruttura cloud sicura basata in Francia utilizzando i Serverless Containers.
sidebar_label: Scaleway
---

Scaleway è un provider cloud europeo con sede in Francia, con datacenter a Parigi, Amsterdam e Varsavia: una scelta eccellente per le organizzazioni che danno priorità alla sovranità dei dati nell'UE.

Usa il **Managed Database** di Scaleway per Postgres e i **Serverless Containers** per il runtime.

Nulla in questa pagina è specifico di Scaleway per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Creare un database Postgres gestito

1. Nella console di Scaleway, vai su **PostgreSQL**.
2. Clicca su **Create a Database Instance**.
3. Scegli una Region (es. Parigi — `PAR1`).
4. Seleziona un Node Type (**Play2-Pico** o **Pro2-XXS** funzionano bene).
5. Aggiungi un nome per il database (`rebase_db`) e una password utente complessa.
6. Una volta distribuito, annota la **Connection string** (URI) dalla dashboard:
   `postgres://user:password@ip:port/rebase_db`

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una sola volta eseguendo `CREATE EXTENSION vector;` sul database.

## 2. Creare il bundle e incorporarlo in un'immagine

Non c'è **alcuna immagine applicativa da compilare dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tue collection compilate, funzioni, cron e, se il tuo progetto dichiara un'app statica, il tuo frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Serverless Containers effettua il pull da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Vai su **Container Registry** nella console di Scaleway e crea un namespace (es. `rebase-apps`).
2. Effettua il login al registry dal tuo terminale seguendo le istruzioni mostrate.
3. Compila ed esegui il push, dalla radice del progetto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Aggiornare Rebase in seguito richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimarrà invariato.

## 3. Distribuire il Serverless Container

1. Vai su **Serverless Containers**.
2. Clicca su **Create a Container**.
3. Scegli l'immagine appena caricata.
4. Imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto a meno che `PORT` non indichi diversamente.
5. Sotto Environment Variables, aggiungi:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | L'URI ottenuto dal passaggio del Managed Postgres |
| `JWT_SECRET` | Una stringa casuale sicura di oltre 32 caratteri per la firma dei token di autenticazione |
| `REBASE_SERVICE_KEY` | Una stringa casuale sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Gli ultimi tre valori sono il modo in cui questa distribuzione ottiene un amministratore: in produzione il primo account che si registra non viene promosso automaticamente, quindi nient'altro crea il primo chiamante autenticato. Consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin). Contrassegna i secret come variabili d'ambiente segrete anziché in chiaro.

6. Punta l'health check su `/livez`. Non su `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un container sano durante un breve rallentamento del database.
7. Clicca su **Deploy Container**.

Scaleway effettua il provisioning del container e ti fornisce un endpoint pubblico (es. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Per una rigorosa conformità dei dati, verifica che i dettagli della tua organizzazione Scaleway riflettano la tua entità aziendale europea.*

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, un approccio additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security. In questo modo, il primo avvio su un database vuoto è immediatamente in grado di servire le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora la CLI, eseguita da un checkout locale o da un job CI con `DATABASE_URL` puntato al tuo Managed Database:

```bash
rebase db push
```

- **RLS per le junction table** per le relazioni many-to-many.
- **Qualsiasi modifica non puramente additiva**: una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di release.

## Archiviazione file

I Serverless Containers non dispongono di un disco persistente, quindi l'archiviazione locale dei file causerebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione. Scaleway Object Storage è compatibile con S3 e si trova negli stessi datacenter:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulta [Storage](/docs/backend/storage) per il quadro completo.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a ogni piattaforma.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
