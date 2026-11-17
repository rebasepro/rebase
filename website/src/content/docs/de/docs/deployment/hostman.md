---
sourceHash: 775bcc753ac34527
title: Rebase auf Hostman bereitstellen
description: Ein rebase init-Projekt auf Hostman bereitstellen – App Platform mit Managed PostgreSQL und S3-Speicher oder ein Cloud-Server mit der projekteigenen Compose-Datei.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) bietet zwei Modelle, die zu einem Rebase-Backend passen, mit Rechenzentren in Europa und den USA:

- **App Platform mit Managed PostgreSQL.** Hostman baut und betreibt Ihre App aus einem GitHub-Repository und verwaltet die Datenbank. Die Container starten bei jedem Deployment frisch, daher **benötigen Datei-Uploads vom ersten Tag an einen S3-kompatiblen Bucket**.
- **Ein einzelner Cloud-Server.** Postgres und die Runtime auf einem VPS unter der `docker-compose.yml`, die Ihr Projekt bereits besitzt. **Uploads können auf der Festplatte des Servers verbleiben.**

Nichts auf dieser Seite bezüglich Ihres Projekts ist spezifisch für Hostman. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft auf einem Laptop, in Rebase Cloud und hier.

## App Platform

### 1. Datenbank erstellen

Erstellen Sie im Hostman-Panel einen **Managed PostgreSQL**-Cluster:

- **Version:** 16 oder neuer.
- **Region:** diejenige, in der Sie die App betreiben möchten.
- **Network:** ein privates Netzwerk. Fügen Sie die App in Schritt 4 demselben Netzwerk hinzu. Das Netzwerk einer App wird bei deren Erstellung ausgewählt und kann nachträglich nicht mehr geändert werden.

Der Cluster wird mit dem Benutzer `gen_user` und der Datenbank `default_db` bereitgestellt. Kopieren Sie aus dem Reiter **Connection** den Verbindungs-String für die **private IP**. Dies ist Ihre `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Falls der Cluster TLS erfordert, fügen Sie am Ende `?sslmode=no-verify` an: verschlüsselt, ohne das Zertifikat gegen eine öffentliche Zertifizierungsstelle zu prüfen. Ein bloßes `sslmode=require` wird vom Node-Treiber, auf dem Rebase läuft, als „überprüfen“ interpretiert und schlägt bei Zertifikaten fehl, die nicht von einer öffentlichen Zertifizierungsstelle signiert wurden. Siehe [Konfiguration](/docs/getting-started/configuration/#required).

#### Rolle erstellen, zu der Rebase wechselt

Rebase setzt Row-Level Security durch, indem es bei jeder angemeldeten Anfrage zu einer eingeschränkten Rolle, `rebase_user`, wechselt. `gen_user` muss die Berechtigung haben, diese Rolle zu erstellen und zu ihr zu wechseln.

1. Weisen Sie `gen_user` auf dem Reiter **Users** des Clusters das **CREATE ROLE**-Privileg zu. Hostmans kleinste Konfiguration (1 CPU, 1 GB RAM, 20 GB) erlaubt das Hinzufügen von Benutzern oder Datenbanken nicht. Wenn das Zuweisen des Privilegs nicht möglich ist, wählen Sie die nächsthöhere Konfiguration.
2. Verbinden Sie sich vor dem ersten Deployment einmalig als `gen_user` mittels `psql` und führen Sie Folgendes aus:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   Die Datenbank befindet sich in einem privaten Netzwerk; führen Sie dies also von einem Cloud-Server im selben Netzwerk aus oder aktivieren Sie für diesen Zeitraum den öffentlichen Zugriff.

Die zweite Anweisung ist die entscheidende. Ab PostgreSQL 16 wird ein Benutzer, der eine Rolle erstellt, ohne Superuser zu sein, zwar Mitglied dieser Rolle, darf jedoch nicht zu ihr wechseln. Wenn die Runtime die Rolle selbst erstellt, gelingt der Start zwar, aber jede authentifizierte Anfrage schlägt anschließend mit `DB_PERMISSION_DENIED` fehl. Sollte dies bereits passiert sein, führen Sie die `GRANT`-Zeile aus und starten Sie die App neu.

Falls Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie **pgvector** unter **Configuration → Extensions**. Das Scaffold-Projekt deklariert keine.

### 2. Bucket erstellen

Erstellen Sie einen S3-kompatiblen Bucket – entweder Hostmans eigenen S3-Speicher oder den eines beliebigen anderen Anbieters. Notieren Sie sich aus den Bucket-Einstellungen den Endpunkt, die Region, den Access Key und den Secret Key. Halten Sie den Bucket **privat**: Rebase signiert jeden Download, und `storageAuthorize` in `backend/storage.ts` entscheidet, wer lesen, schreiben und auflisten darf.

### 3. Dockerfile hinzufügen

App Platform baut Ihre Anwendung aus Ihrem Repository, und da `dist-bundle/` in `.gitignore` aufgeführt ist, baut das Image das Bundle selbst und übergibt es anschließend an die veröffentlichte Runtime. Committen Sie Folgendes im Projektstamm:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.33.2
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Drei Details sind hier wichtig:

- **`node:22`, nicht `node:22-slim`.** Bei der Installation des CLI wird die Atlas-Schema-Engine heruntergeladen, wofür `curl` und CA-Zertifikate erforderlich sind. Das Slim-Image enthält beides nicht, weshalb die Installation fehlschlägt.
- **`--chown=node:node`.** Die Runtime läuft als Benutzer `node` und verlinkt beim Start ihre eigenen Packages in das Bundle. Ein Bundle im Besitz von `root` funktioniert zwar weiterhin, protokolliert jedoch für jedes Package, das nicht verlinkt werden konnte, eine Warnung.
- **Kein Quellcode im finalen Image.** Es enthält nur die Runtime und Ihr kompiliertes Bundle. Ein späteres Rebase-Upgrade erfordert lediglich eine Änderung der zweiten `FROM`-Zeile.

Das Runtime-Image lauscht auf Port 8080 und deklariert diesen via `EXPOSE`. Dies ist der Port, an den App Platform Anfragen weiterleitet.

### 4. App erstellen

Erstellen Sie in **App Platform** eine **Backend**-App:

1. Verbinden Sie das GitHub-Repository und den Branch.
2. Setzen Sie **Framework** auf **Dockerfile**.
3. Wählen Sie dieselbe Region wie bei der Datenbank und das **private Netzwerk** der Datenbank.
4. Wählen Sie eine Konfiguration mit **2 GB RAM**. Das Bundle wird als Teil des Images gebaut und der Build erreicht in Spitzenzeiten etwa 1 GB, sodass bei einer 1-GB-Konfiguration der Arbeitsspeicher ausgehen kann.
5. Setzen Sie den **Health-Check-Pfad** auf `/livez`. Der Standardwert `/` funktioniert ebenfalls, aber `/livez` antwortet, ohne die Datenbank zu kontaktieren, sodass ein kurzer Datenbankaussetzer eine ansonsten funktionierende App nicht neu startet.

Fügen Sie unter **Advanced settings** die Umgebungsvariablen hinzu:

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` bestimmen den ersten Administrator. In der Produktionsumgebung wird das erste registrierte Konto nicht hochgestuft; es gibt also keinen anderen Weg, eines zu erstellen. Die Runtime erstellt das Konto einmalig, solange die Benutzer-Tabelle leer ist. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

Die Adresse der App ist erst bekannt, wenn sie erstellt wurde. Erstellen Sie die App, lesen Sie die technische Domain im Reiter **Dashboard** ab und tragen Sie diese in `CORS_ORIGINS` und `FRONTEND_URL` ein. Das Speichern der Einstellungen löst ein erneutes Deployment der App aus.

### 5. Öffnen

Öffnen Sie die Domain der App. Ein einzelner Container stellt das Admin-Panel unter `/` und die API unter `/api` bereit. Melden Sie sich mit `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` an und ändern Sie anschließend das Passwort.

Jeder Push auf den Branch führt zu einem Re-Deployment. Um eine eigene Domain hinzuzufügen, nutzen Sie **Settings → Domains**. Hostman stellt das Zertifikat aus. Fügen Sie die neue Origin zu `CORS_ORIGINS` und `FRONTEND_URL` hinzu.

## Ein einzelner Cloud-Server

Ein Hostman-Cloud-Server betreibt denselben Stack wie jeder VPS: Postgres und die Runtime unter der projekteigenen `docker-compose.yml`, mit Caddy davor für HTTPS. Ein Server mit 2 vCPUs und 2 GB RAM reicht für den Anfang aus.

Erstellen Sie ihn mit **Ubuntu 24.04** und Ihrem SSH-Schlüssel und folgen Sie anschließend den [Schritten für einen einzelnen Server auf der Hetzner-Seite](/docs/deployment/hetzner/#one-server-from-your-project). Nichts daran hängt von Hetzner ab.

Auf einem Server verbleiben Uploads auf dessen Festplatte: Die Compose-Datei speichert sie in einem benannten Volume und setzt `FORCE_LOCAL_STORAGE=true`. Sie überstehen Neustarts und Re-Deployments, jedoch nicht den Verlust des Servers. Aktivieren Sie daher die Server-Backups von Hostman oder verschieben Sie die Dateien in einen Bucket, sobald sie wichtiger werden.

## Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derjenigen, die in `backend/schema` deklariert sind.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt. Es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an, sodass eine neue Tabelle beim nächsten Deployment direkt live ist.

`ensure` ändert niemals etwas, das bereits existiert. Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Labels eines bestehenden Enums, da ein Deployment ein Schema nicht als Nebeneffekt umgestalten darf.

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld – erfordert `rebase db push`, ausgeführt aus einem Checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Prüfen Sie das SQL, das der Testlauf (Dry-Run) ausgibt, und führen Sie den Befehl anschließend ohne `--dry-run` erneut aus. Zwei Dinge müssen bei Managed PostgreSQL zuvor eingerichtet werden:

- **Erreichbarkeit.** Eine Datenbank in einem privaten Netzwerk ist von Ihrem Laptop aus nicht erreichbar. Aktivieren Sie für diese Dauer den öffentlichen Zugriff oder führen Sie den Befehl von einem Server im selben Netzwerk aus.
- **Die Scratch-Datenbank.** `db push` plant jede Änderung in einer Wegwerf-Kopie des Schemas in einer Datenbank, die nach Ihrer benannt ist und auf `_dev_diff` endet. Weisen Sie `gen_user` das **CREATEDB**-Privileg zu oder erstellen Sie `default_db_dev_diff` einmalig über das Panel. Beides ist auf der kleinsten Konfiguration nicht möglich.

Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) — die Produktions-Checkliste und die Regeln für den ersten Admin, die auf jeder Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) — jede Umgebungsvariable, die von der Runtime gelesen wird.
- [Storage](/docs/backend/storage) — Buckets, Zugriffsregeln und mehrere Speicherquellen gleichzeitig.
