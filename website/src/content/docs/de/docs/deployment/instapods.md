---
sourceHash: 00f5a2af4d9eec17
title: Rebase auf InstaPods bereitstellen
description: Bringen Sie ein frisches rebase init-Projekt auf eine Live-HTTPS-URL auf einem InstaPods-Pod – Node, PostgreSQL und Datei-Uploads auf derselben Maschine, ohne Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) führt Ihre App in einem persistenten Container aus – einem *Pod* – mit Node.js, einem optionalen PostgreSQL-Dienst auf `localhost`, automatischem HTTPS und Bereitstellungen aus einem GitHub-Repository. Ein Rebase-Backend besteht aus einem Node-Prozess und einer Postgres-Datenbank, sodass das Ganze auf einen einzigen Pod passt: die API, Authentifizierung, Echtzeitfunktionen, Cron-Jobs, das Admin-Panel und Dateispeicher.

Diese Seite führt Sie von einem frisch mit `rebase init` erstellten Projekt zu einer Live-URL. Alles läuft auf dem Pod selbst; es gibt kein Docker-Image und nichts weiter bereitzustellen.

**Datei-Uploads können auf der Festplatte des Pods selbst starten.** Das Dateisystem eines Pods übersteht Neustarts und erneute Deployments, sodass lokaler Speicher dort sicher ist und Sie später ohne Codeänderungen zu einem S3-kompatiblen Bucket wechseln können. Siehe [Dateispeicher](#dateispeicher).

## Was Sie benötigen

- Den **Build**-Tarif oder höher (7 $/Monat: 2 vCPU, 2 GB RAM, 25 GB Festplattenspeicher). Der Launch-Tarif kann den PostgreSQL-Dienst nicht ausführen.
- Ein GitHub-Repository für das Projekt.
- Die [InstaPods CLI](https://docs.instapods.com/) für die Datenbank- und Umgebungsschritte. Das Dashboard bietet dieselben Funktionen.

## 1. Projekt erstellen und pushen

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Comnitten und pushen Sie es in ein GitHub-Repository. `.env` wird von Git ignoriert und das bleibt auch so: Der Pod erhält in Schritt 4 seine eigenen Werte.

## 2. Pod erstellen

Erstellen Sie im InstaPods-Dashboard einen Pod mit der Vorlage **Node.js** im **Build**-Tarif.

Das Scaffold deklariert Node `>=22.22.0` und verweigert die Installation auf älteren Versionen. Überprüfen Sie die Node-Version des Pods und wechseln Sie zu Node 24, falls dessen Node 22 veraltet ist:

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

Erstellen Sie anschließend die Rolle, unter der Rebase authentifizierte Anfragen ausführt. Rebase setzt Row-Level Security durch, indem jede Anfrage zu einer eingeschränkten Rolle, `rebase_user`, wechselt, und der Benutzer `instapod` benötigt die Berechtigung, zu dieser Rolle zu wechseln. Erstellen Sie sie einmalig als Postgres-Superuser vor dem ersten Deployment:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

Die Runtime übernimmt beim ersten Start den Rest: Die Berechtigungen und Policies für Ihre Tabellen gehören `instapod`, dem Eigentümer der Datenbank.

Führen Sie dies auch dann aus, wenn die Runtime die Rolle selbst erstellen könnte. Ein Benutzer, der Rollen erstellen darf, aber kein Superuser ist, erhält unter PostgreSQL 16 und neuer eine Mitgliedschaft in der von ihm erstellten Rolle, die es ihm nicht erlaubt, in diese zu wechseln. Der Startvorgang gelingt dann zwar, aber jede authentifizierte Anfrage schlägt mit `DB_PERMISSION_DENIED` fehl. Falls dies bereits passiert ist, führen Sie `GRANT rebase_user TO instapod WITH SET TRUE;` auf dieselbe Weise aus und starten Sie die App neu.

## 4. Umgebungsvariablen setzen

Generieren Sie die beiden Secrets mit `openssl rand -hex 32` (einmal für jedes Secret) und setzen Sie dann alles mit einem einzigen Aufruf:

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

Verwenden Sie die eigene URL Ihres Pods für `CORS_ORIGINS` und `FRONTEND_URL`: Das Dashboard zeigt sie an, und es ist die Adresse, unter der Sie das Admin-Panel öffnen. Fügen Sie später eine benutzerdefinierte Domain hinzu und tragen Sie diese in beide Variablen ein.

Wofür die weniger offensichtlichen Zeilen da sind:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** In der Produktionsumgebung lehnt die Runtime eine `DATABASE_URL` ab, die auf `localhost` verweist, da diese Adresse innerhalb eines Containers normalerweise ein Fehler ist. Auf einem Pod befindet sich die Datenbank tatsächlich auf derselben Maschine, und diese Zeile bestätigt das.
- **`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`.** In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch zum Administrator ernannt, daher definieren diese Variablen das erste Administratorkonto. Die Runtime erstellt das Konto einmalig, solange die Benutzertabelle leer ist. Melden Sie sich damit an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).
- **Die drei Speicher-Zeilen.** Erläutert unter [Dateispeicher](#dateispeicher).

`instapods env set` schreibt `/home/instapod/app/.env`, was die Datei ist, die von `rebase start` gelesen wird. InstaPods setzt `PORT` selbst, und die Runtime bindet sich daran.

## 5. Repository verbinden

Verbinden Sie im Reiter **Git** des Pods das Repository und den Branch und legen Sie anschließend die Befehle fest:

| Feld | Wert |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(leer lassen)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Warum die einzelnen Befehle so aufgebaut sind:

- **Install** führt pnpm über `npx` aus, da das Projekt eine `pnpm-lock.yaml` mitliefert und auf dem Pod pnpm möglicherweise nicht vorinstalliert ist. `--prod=false` behält die Dev-Dependencies bei – die Rebase-CLI und TypeScript, die für den Build benötigt werden –, selbst wenn `NODE_ENV` während der Installation bereits auf `production` steht.
- **Build** führt `rebase build` aus. Es kompiliert Ihre Tabellen, Funktionen und Cron-Jobs nach `dist-bundle/` und baut das Admin-Panel in dasselbe Bundle. Die Speichernutzung erreicht in der Spitze etwa 1 GB RAM.
- **Start** führt das kompilierte Bundle aus. `NODE_ENV=production` wird direkt im Befehl gesetzt, damit die Runtime niemals im Entwicklungsmodus startet – in dem jeder beliebige erste Benutzer zum Administrator werden würde.

Führen Sie das Deployment durch. Jeder spätere Push in diesen Branch löst ein erneutes Deployment aus.

## 6. App aufrufen

Öffnen Sie die URL des Pods. Ein einziger Prozess stellt das Admin-Panel unter `/` und die API unter `/api` bereit. Melden Sie sich mit `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` an.

Beim ersten Start werden alle benötigten Tabellen einschließlich Ihrer Tabellen zusammen mit deren Row-Level-Security-Policies erstellt. Es muss vorab keine Migration ausgeführt werden.

Wenn das Protokoll `Failed to create the "rebase_user" role` anzeigt, wurde der Schritt am Ende von [PostgreSQL hinzufügen](#3-postgresql-hinzufügen) übersprungen: Führen Sie ihn aus und rufen Sie anschließend `instapods pods restart my-app` auf.

## Dateispeicher

Uploads werden auf der Festplatte des Pods unter `/home/instapod/app/uploads` gespeichert, einem Verzeichnis, das von der `.gitignore` des Scaffolds bereits aus dem Repository ausgeschlossen wird.

In der Produktionsumgebung verweigert die Runtime lokalen Speicher, es sei denn, Sie geben an, dass die Festplatte persistent ist. Auf den meisten Container-Plattformen ist sie das nämlich nicht: Das Dateisystem wird bei jedem Deployment ersetzt und alle hochgeladenen Dateien gehen verloren. Bei einem Pod ist das anders, da seine Dateien über Neustarts und Deployments hinweg erhalten bleiben. `FORCE_LOCAL_STORAGE=true` teilt der Runtime genau das mit.

Indem das Verzeichnis innerhalb von `/home/instapod/app` verbleibt, ist es auch im täglichen Backup des Pods von InstaPods enthalten, das dieses Verzeichnis abdeckt und zusätzlich einen Dump der Datenbank erstellt.

Was lokaler Speicher nicht leistet:

- **Bereitstellung von mehr als einer Maschine.** Die Dateien existieren ausschließlich auf diesem Pod. Eine zweite Instanz oder ein CDN vor den Dateien erfordert einen Bucket.
- **Über den Festplattenspeicher des Tarifs hinaus wachsen.** Uploads teilen sich die 25 GB mit der Datenbank und der App.

Wenn Sie darüber hinauswachsen, binden Sie einen beliebigen S3-kompatiblen Bucket an und entfernen Sie die drei lokalen Zeilen:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Bereits auf dem Pod vorhandene Dateien werden nicht automatisch verschoben: Kopieren Sie sie unter Beibehaltung ihrer Keys in den Bucket. Wer Dateien lesen, schreiben und auflisten darf, wird von `storageAuthorize` in `backend/storage.ts` bestimmt – unabhängig davon, welches Backend sie speichert. Siehe [Speicher](/docs/backend/storage).

## Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich der in `backend/schema` deklarierten.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt. Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an, sodass eine neue Tabelle beim nächsten Deployment sofort live ist.

`ensure` ändert niemals etwas, das bereits existiert. Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Werte eines bestehenden Enums, da ein Deployment ein Schema nicht als Nebeneffekt umstrukturieren darf.

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld –, erfordert `rebase db push`, ausgeführt von Ihrem lokalen Rechner aus.

`db push` plant jede Änderung in einer temporären Kopie des Schemas in einer Datenbank, die nach Ihrer benannt ist und auf `_dev_diff` endet; der Benutzer `instapod` hat jedoch keine Berechtigung, Datenbanken zu erstellen. Erstellen Sie diese einmalig als Superuser:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

Das Postgres des Pods lauscht nur auf `localhost`; greifen Sie daher über einen SSH-Tunnel darauf zu und führen Sie dann den Push durch:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Prüfen Sie das SQL, das beim Probelauf ausgegeben wird, und führen Sie den Befehl anschließend ohne `--dry-run` erneut aus. Eine Änderung, die Daten löscht, erfordert zusätzlich `--allow-destructive`.

Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und tragen `node_modules/.bin/rebase db migrate` in das Feld **Release** ein, welches InstaPods bei jedem Deployment ausführt.

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, benötigt das Postgres des Pods die pgvector-Erweiterung: auf dem Pod installiert und anschließend vom Superuser mit `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"` erstellt. Das Scaffold deklariert keine solche Spalte.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
- [Speicher](/docs/backend/storage) – Buckets, Zugriffsregeln und mehrere Speicherquellen gleichzeitig.
