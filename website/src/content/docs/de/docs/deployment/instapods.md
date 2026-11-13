---
sourceHash: ecae5803328dcd65
title: Deployment von Rebase auf InstaPods
description: Bringen Sie ein frisches rebase init-Projekt auf eine Live-HTTPS-URL auf einem InstaPods-Pod – Node, PostgreSQL und Datei-Uploads auf derselben Maschine, ohne Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) führt Ihre App in einem persistenten Container – einem *Pod* – mit Node.js, einem optionalen PostgreSQL-Dienst auf `localhost`, automatischem HTTPS und Deployments aus einem GitHub-Repository aus. Ein Rebase-Backend besteht aus einem Node-Prozess und einem Postgres-Dienst, sodass das Ganze auf einen einzigen Pod passt: die API, Authentifizierung, Realtime, Cron, das Admin-Panel und die Dateispeicherung.

Diese Seite führt Sie von einem Projekt frisch aus `rebase init` zu einer Live-URL. Alles läuft auf dem Pod selbst; es gibt kein Docker-Image und nichts weiter bereitzustellen.

**Datei-Uploads können auf der Festplatte des Pods selbst beginnen.** Das Dateisystem eines Pods übersteht Neustarts und erneute Deployments, sodass lokaler Speicher dort sicher ist und Sie später ohne Codeänderungen zu einem S3-kompatiblen Bucket wechseln können. Siehe [Dateispeicherung](#dateispeicherung).

## Was Sie benötigen

- Den **Build**-Tarif oder höher (7 $/Monat: 2 vCPU, 2 GB RAM, 25 GB Festplattenspeicher). Der Launch-Tarif kann den PostgreSQL-Dienst nicht ausführen.
- Ein GitHub-Repository für das Projekt.
- Die [InstaPods CLI](https://docs.instapods.com/) für die Datenbank- und Umgebungsschritte. Das Dashboard bietet dieselben Funktionen.

## 1. Projekt erstellen und pushen

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Committen Sie es und pushen Sie es in ein GitHub-Repository. `.env` wird per Git ignoriert und bleibt es auch: Der Pod erhält in Schritt 4 seine eigenen Werte.

## 2. Pod erstellen

Erstellen Sie im InstaPods-Dashboard einen Pod mit der Voreinstellung **Node.js** im **Build**-Tarif.

Das Scaffold deklariert Node `>=22.22.0` und verweigert die Installation auf älteren Versionen. Überprüfen Sie die Version des Pods und aktualisieren Sie sie auf Node 24, falls dessen Node 22 veraltet ist:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. PostgreSQL hinzufügen

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

Der zweite Befehl gibt die Anmeldedaten aus: Host `localhost`, Port `5432`, Benutzer und Datenbank `instapod` sowie ein generiertes Passwort. Ihr Verbindungs-String lautet:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Erstellen Sie anschließend die Rolle, unter der Rebase Anfragen angemeldeter Benutzer ausführt. Rebase erzwingt Row-Level Security, indem jede Anfrage zu einer eingeschränkten Rolle, `rebase_user`, gewechselt wird, und der Benutzer `instapod` benötigt die Berechtigung, zu dieser Rolle zu wechseln. Erstellen Sie diese einmalig als Postgres-Superuser vor dem ersten Deployment:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

Die Runtime erledigt den Rest beim ersten Start: Die Berechtigungen (Grants) und Richtlinien (Policies) für Ihre Tabellen gehören `instapod`, dem die Datenbank gehört.

Führen Sie diesen Schritt auch dann aus, wenn die Runtime die Rolle selbst erstellen könnte. Ein Benutzer, der Rollen erstellen darf, aber kein Superuser ist, erhält unter PostgreSQL 16 und neuer eine Mitgliedschaft in der erstellten Rolle, die es ihm nicht erlaubt, in diese zu wechseln. Der Start ist dann zwar erfolgreich, aber jede Anfrage eines angemeldeten Benutzers schlägt mit `DB_PERMISSION_DENIED` fehl. Falls das bereits passiert ist, führen Sie auf dieselbe Weise `GRANT rebase_user TO instapod WITH SET TRUE;` aus und starten Sie die App neu.

## 4. Umgebungsvariablen setzen

Generieren Sie die beiden Secrets mit `openssl rand -hex 32` (jeweils einmal) und setzen Sie dann alles mit einem einzigen Aufruf:

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Verwenden Sie die eigene URL Ihres Pods für `CORS_ORIGINS` und `FRONTEND_URL`: Das Dashboard zeigt sie an, und es ist die Adresse, unter der Sie das Admin-Panel öffnen werden. Fügen Sie später eine benutzerdefinierte Domain hinzu und tragen Sie diese in beide Variablen ein.

Wozu die weniger offensichtlichen Zeilen dienen:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** In der Produktionsumgebung lehnt die Runtime eine `DATABASE_URL` ab, die auf `localhost` verweist, da diese Adresse innerhalb eines Containers üblicherweise ein Fehler ist. Auf einem Pod befindet sich die Datenbank tatsächlich auf derselben Maschine, und diese Zeile bestätigt das.
- **`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`.** In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch zum Administrator gemacht, daher bestimmen diese Variablen das erste Konto. Die Runtime erstellt das Konto einmalig, solange die Benutzertabelle leer ist. Melden Sie sich damit an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).
- **Die drei Storage-Zeilen.** Erklärt unter [Dateispeicherung](#dateispeicherung).

`instapods env set` schreibt nach `/home/instapod/app/.env`, was die Datei ist, die `rebase start` einliest. InstaPods setzt `PORT` automatisch, und die Runtime bindet sich daran.

## 5. Repository verbinden

Verbinden Sie auf dem **Git**-Tab des Pods das Repository und den Branch und konfigurieren Sie anschließend die Befehle:

| Feld | Wert |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(leer lassen)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Warum jeder Befehl so aufgebaut ist:

- **Install** führt pnpm über `npx` aus, da das Projekt eine `pnpm-lock.yaml` enthält und auf dem Pod pnpm möglicherweise nicht installiert ist. `--prod=false` behält die Entwicklungsabhängigkeiten bei – die Rebase CLI und TypeScript, die der Build benötigt –, selbst wenn `NODE_ENV` während der Installation bereits `production` ist.
- **Build** führt `rebase build` aus. Es kompiliert Ihre Tabellen, Funktionen und Crons nach `dist-bundle/` und baut das Admin-Panel in dasselbe Bundle ein. Die Speichernutzung erreicht in der Spitze etwa 1 GB.
- **Start** führt das kompilierte Bundle aus. `NODE_ENV=production` wird im Befehl selbst gesetzt, damit die Runtime niemals im Entwicklungsmodus startet – in dem der erste fremde Benutzer, der sich registriert, zum Administrator werden würde.

Führen Sie das Deployment durch. Jeder spätere Push auf den Branch löst ein erneutes Deployment aus.

## 6. App aufrufen

Öffnen Sie die URL des Pods. Ein einziger Prozess bedient das Admin-Panel unter `/` und die API unter `/api`. Melden Sie sich mit `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` an.

Beim ersten Start werden alle benötigten Tabellen erstellt, einschließlich Ihrer eigenen Tabellen, zusammen mit deren Row-Level-Security-Richtlinien. Es muss vorab keine Migration ausgeführt werden.

Falls das Log `Failed to create the "rebase_user" role` meldet, wurde der Schritt am Ende von [PostgreSQL hinzufügen](#3-postgresql-hinzufügen) übersprungen: Führen Sie ihn aus und starten Sie den Pod anschließend mit `instapods pods restart my-app` neu.

## Dateispeicherung

Uploads werden auf der Festplatte des Pods unter `/home/instapod/app/uploads` gespeichert, einem Verzeichnis, das die `.gitignore` des Scaffolds bereits vom Repository ausschließt.

In der Produktionsumgebung verweigert die Runtime lokalen Speicher, es sei denn, Sie geben an, dass die Festplatte persistent ist. Auf den meisten Container-Plattformen ist dies nämlich nicht der Fall: Das Dateisystem wird bei jedem Deployment ersetzt, und alle hochgeladenen Dateien gehen verloren. Ein Pod verhält sich anders, da seine Dateien über Neustarts und Deployments hinweg erhalten bleiben. `FORCE_LOCAL_STORAGE=true` teilt der Runtime genau das mit.

Wenn Sie das Verzeichnis innerhalb von `/home/instapod/app` belassen, ist es zudem im täglichen Backup des Pods von InstaPods enthalten, welches dieses Verzeichnis sichert und parallel dazu die Datenbank dumpt.

Was lokaler Speicher nicht leisten kann:

- **Dateien von mehr als einer Maschine aus ausliefern.** Die Dateien existieren ausschließlich auf diesem Pod. Eine zweite Instanz oder ein CDN vor den Dateien erfordert einen Bucket.
- **Über den Speicherplatz des Tarifs hinaus wachsen.** Uploads teilen sich die 25 GB mit der Datenbank und der Anwendung.

Wenn Ihr Speicherbedarf darüber hinauswächst, binden Sie einen beliebigen S3-kompatiblen Bucket an und entfernen Sie die drei lokalen Zeilen:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Dateien, die sich bereits auf dem Pod befinden, werden nicht automatisch verschoben: Kopieren Sie diese in den Bucket und behalten Sie dabei deren Schlüssel (Keys) bei. Wer Dateien lesen, schreiben und auflisten darf, wird durch `storageAuthorize` in `backend/storage.ts` bestimmt – unabhängig davon, welches Backend die Dateien speichert. Siehe [Speicher](/docs/backend/storage).

## Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derjenigen, die in `backend/schema` deklariert sind.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` eingestellt, was über das gesamte Schema hinweg additiv wirkt. Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an, sodass eine neue Collection beim nächsten Deployment live ist.

`ensure` ändert niemals etwas, das bereits existiert. Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da ein Deployment ein Schema nicht als Seiteneffekt umstrukturieren darf.

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld –, erfordert `rebase db push`, ausgeführt von Ihrem lokalen Rechner.

`db push` plant jede Änderung in einer temporären Kopie des Schemas, in einer Datenbank, die nach Ihrer benannt ist und auf `_dev_diff` endet. Der Benutzer `instapod` ist jedoch nicht berechtigt, Datenbanken zu erstellen. Erstellen Sie diese einmalig als Superuser:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

Der Postgres-Dienst des Pods lauscht nur auf `localhost`. Greifen Sie daher über einen SSH-Tunnel darauf zu und führen Sie dann den Push aus:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Prüfen Sie das SQL, das der Testlauf (Dry-Run) ausgibt, und führen Sie den Befehl dann erneut ohne `--dry-run` aus. Eine Änderung, die Daten löscht, erfordert zusätzlich `--allow-destructive`.

Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und tragen Sie `node_modules/.bin/rebase db migrate` in das Feld **Release** ein, welches InstaPods bei jedem Deployment ausführt.

Falls Ihre Tabellen eine `col.vector()`-Spalte deklarieren, benötigt die Postgres-Datenbank des Pods die Erweiterung pgvector: Auf dem Pod installiert und anschließend vom Superuser mit `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"` erstellt. Das Scaffold deklariert standardmäßig keine solche Spalte.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) — die Produktions-Checkliste und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) — alle Umgebungsvariablen, die die Runtime einliest.
- [Speicher](/docs/backend/storage) — Buckets, Zugriffsregeln und mehrere Speicherquellen gleichzeitig.
