---
sourceHash: 4561f107537e7ada
title: Connection-Pooling
sidebar_label: Connection-Pooling
description: Der pgbouncer-Dienst, den die selbstgehostete Compose-Datei für Aufrufer bereitstellt, die keine Verbindung aufrechterhalten können, und was durch Transaction-Pooling über seinen Port nicht mehr funktioniert.
---

Die Runtime hält einen kleinen, langlebigen Pool und benötigt keinen Pooler. Was hingegen einen benötigt, ist alles andere, was mit derselben Datenbank kommuniziert und keine Verbindung aufrechterhalten kann: eine Serverless-Funktion, ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen skaliert. `max_connections` von Postgres ist ein hartes Limit im niedrigen Hunderterbereich, und jede Verbindung ist ein *Prozess*, sodass ein Lambda-Fan-out dieses Limit erschöpft, lange bevor die Datenbank ausgelastet ist.

Die Compose-Datei enthält einen `pgbouncer`-Dienst für diesen Datenverkehr, gekoppelt an ein Profil, sodass ein Deployment ohne solche Aufrufer keinen Prozess ausführt, für den es keine Verwendung hat:

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

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert, sodass das Passwort nicht doppelt geschrieben werden muss. Der Pooler authentifiziert sich bei Postgres mit `scram-sha-256`, was Postgres 18 speichert – die Standardeinstellung des Images (`md5`) schlägt beim *Server*-Login mit `FATAL: server login failed: wrong password type` fehl, was wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich unter dem `max_connections`-Wert der Datenbank – die Runtime bedient sich aus demselben Budget.

## Was Transaction-Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion und gibt sie anschließend wieder frei. Genau das ermöglicht es 500 Clients, sich 20 Verbindungen zu teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und jedes davon wird von Rebase selbst genutzt – weshalb sich die Runtime direkt verbindet und dieser Port für andere Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** [Realtime](/docs/backend/realtime/) basiert darauf, und ein Listener benötigt eine Verbindung, die über eine Transaktion hinaus fortbesteht. `LISTEN` wird über den Pooler *akzeptiert* – er antwortet auf `LISTEN`, und danach kommt keine Benachrichtigung mehr an.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifend gehaltene Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion landet möglicherweise auf einer anderen Serververbindung, die nichts davon sieht. Beides schlägt auf dieselbe wenig hilfreiche Weise fehl: Mit einem einzelnen untätigen Client ist der Status meist noch vorhanden, sodass es beim Testen funktioniert und erst unter der Nebenläufigkeit fehlschlägt, für die der Pooler eigentlich eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Die meisten Treiber können angewiesen werden, diese nicht zu verwenden – node-postgres tut dies standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsbezogen und funktioniert; damit wird auch Row-Level Security konfiguriert – RLS verhält sich über den gepoolten Port also identisch.

Lassen Sie das Profil deaktiviert, wenn sich außerhalb der Runtime nichts mit Ihrer Datenbank verbindet. Ein ungenutzter Port ist Angriffsfläche.

## Nächste Schritte

- [Self-hosting](/docs/deployment/self-hosting/): die Compose-Datei, zu der dieser Dienst gehört.
- [More than one instance](/docs/deployment/multiple-instances/): der Status, den jeder Runtime-Prozess behält, bevor Sie ein Replikat hinzufügen.
