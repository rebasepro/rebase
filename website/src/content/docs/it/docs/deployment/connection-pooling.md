---
sourceHash: 4561f107537e7ada
title: Connection pooling
sidebar_label: Connection pooling
description: Il servizio pgbouncer fornito dal file compose self-hosted per i chiamanti che non possono mantenere una connessione, e cosa smette di funzionare tramite la sua porta con il transaction pooling.
---

Il runtime mantiene un pool ridotto e a lunga durata e non necessita di un pooler. Ciò che invece ne ha bisogno è tutto il resto che comunica con lo stesso database e non può mantenere una connessione: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di code che scala fino a cinquanta. Il parametro `max_connections` di Postgres è un limite rigido nell'ordine di poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda lo esaurisce molto prima che il database sia effettivamente occupato.

Il file compose include un servizio `pgbouncer` per tale traffico, protetto da un profilo in modo che una distribuzione priva di questi chiamanti non esegua un processo superfluo:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

L'autenticazione del client viene generata all'avvio a partire da `DATABASE_URL`, evitando di dover scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, memorizzato da Postgres 18 — il valore predefinito `md5` dell'immagine causa il fallimento del login del *server* con `FATAL: server login failed: wrong password type`, che sembra un errore di password errata ma non lo è.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler abbondantemente al di sotto del valore `max_connections` del database — il runtime attinge allo stesso budget.

## Cosa cambia con il transaction pooling

Un client in pooling trattiene una connessione al server per la durata di una transazione e poi la restituisce, permettendo così a 500 client di condividere 20 connessioni. Tre cose smettono di funzionare attraverso quella porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata ad altri chiamanti:

- **`LISTEN`/`NOTIFY`.** [Realtime](/docs/backend/realtime/) si basa su questo, e un listener richiede una connessione che sopravviva alla transazione. Il comando `LISTEN` viene *accettato* dal pooler — risponde a `LISTEN`, ma poi non arriva alcuna notifica.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe finire su una connessione server diversa, che non vedrà nulla di tutto ciò. Entrambi falliscono nello stesso modo ingannevole: con un solo client inattivo lo stato è di solito ancora presente, quindi funziona durante i test ma smette di funzionare sotto la concorrenza per cui è stato introdotto il pooler.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver si può indicare di non usarli — node-postgres non lo fa per impostazione predefinita; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha un ambito limitato alla transazione e funziona, ed è ciò con cui viene impostata la row-level security — pertanto RLS si comporta in modo identico tramite la porta in pooling.

Lascia il profilo disattivato se nessun elemento al di fuori del runtime si connette al database. Una porta inutilizzata rappresenta superficie di attacco.

## Passaggi successivi

- [Self-hosting](/docs/deployment/self-hosting/): il file compose di cui questo servizio fa parte.
- [Più di un'istanza](/docs/deployment/multiple-instances/): lo stato mantenuto da ciascun processo di runtime, prima di aggiungere una replica.
