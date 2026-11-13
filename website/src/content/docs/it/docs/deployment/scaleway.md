---
sourceHash: 663fa0179ad2c716
title: Distribuzione di Rebase su Scaleway
description: Scopri come distribuire Rebase su Scaleway per un'infrastruttura cloud sicura basata in Francia utilizzando i Serverless Containers.
sidebar_label: Scaleway
---

Scaleway è un provider cloud europeo con sede in Francia, con data center a Parigi, Amsterdam e Varsavia: un'ottima scelta per le organizzazioni che danno priorità alla sovranità dei dati nell'UE.

Usa il **Managed Database** di Scaleway per Postgres e i **Serverless Containers** per il runtime.

Nulla in questa pagina riguarda nello specifico Scaleway in relazione al tuo progetto. Una distribuzione di Rebase è composta da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un database Postgres gestito

1. Nella Console Scaleway, vai su **PostgreSQL**.
2. Fai clic su **Create a Database Instance**.
3. Scegli una regione (es. Parigi — `PAR1`).
4. Seleziona un tipo di nodo (**Play2-Pico** o **Pro2-XXS** funzionano bene).
5. Aggiungi il nome del database (`rebase_db`) e una password utente sicura.
6. Una volta distribuito, annota la **Connection string** (URI) dalla dashboard:
   `postgres://user:password@ip:port/rebase_db`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Compila il bundle e integralo in un'immagine

**Non c'è alcuna immagine applicativa da creare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tabelle compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

I Serverless Containers eseguono il pull da un registry, quindi integra il bundle in un'immagine derivata. Tre righe, e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vai su **Container Registry** nella Console Scaleway e crea un namespace (es. `rebase-apps`).
2. Accedi al registry dal tuo terminale seguendo le istruzioni mostrate.
3. Esegui la build e il push, dalla radice del progetto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Aggiornare Rebase in futuro richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimane invariato.

## 3. Distribuisci il Serverless Container

1. Vai su **Serverless Containers**.
2. Fai clic su **Create a Container**.
3. Scegli l'immagine che hai appena caricato.
4. Imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto a meno che `PORT` non indichi diversamente.
5. Sotto Environment Variables, aggiungi:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | L'URI ottenuto dal passaggio del database Postgres gestito |
| `JWT_SECRET` | Una stringa casuale e sicura di oltre 32 caratteri per firmare i token di autenticazione |
| `REBASE_SERVICE_KEY` | Una stringa casuale e sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Gli ultimi tre sono il modo in cui questa distribuzione ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso automaticamente, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Contrassegna i secret come variabili d'ambiente segrete anziché in chiaro.

6. Indirizza l'health check verso `/livez`. Non `/health`: quest'ultimo esegue un round-trip con il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti sano durante un breve disservizio del database.
7. Fai clic su **Deploy Container**.

Scaleway effettuerà il provisioning del container e ti fornirà un endpoint pubblico (es. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Per una rigorosa conformità dei dati, verifica che i dettagli della tua Scaleway Organization riflettano la tua entità aziendale europea.*

## 4. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security, così il primo avvio su un database vuoto rende subito disponibili le tue collection.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Un aspetto richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job CI con `DATABASE_URL` puntato al tuo Managed Database:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione file

I Serverless Containers non dispongono di un disco persistente, pertanto lo storage locale dei file comporta una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Scaleway Object Storage è compatibile con S3 e si trova negli stessi data center:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulta [Storage](/docs/backend/storage) per una panoramica completa.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
