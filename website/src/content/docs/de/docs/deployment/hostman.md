---
sourceHash: 5f650040f2d3d2f9
title: Rebase auf Hostman bereitstellen
description: Ein mit rebase init erstelltes Projekt auf Hostman bereitstellen — App Platform mit Managed PostgreSQL und S3-Speicher oder ein einzelner Cloud-Server mit der projekt-eigenen Compose-Datei.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) bietet zwei Betriebsmodelle, die zu einem Rebase-Backend passen, mit Rechenzentren in Europa und den USA:

- **App Platform mit Managed PostgreSQL.** Hostman baut und betreibt Ihre App aus einem GitHub-Repository und verwaltet die Datenbank. Die Container starten bei jedem Deployment im Ursprungszustand, daher **erfordern Datei-Uploads vom ersten Tag an ein S3-kompatibles Bucket**.
- **Ein einzelner Cloud-Server.** Postgres und die Runtime auf einem VPS, unter Verwendung der `docker-compose.yml`, die Ihr Projekt bereits enthält. **Uploads können auf der Festplatte des Servers verbleiben.**

Nichts auf dieser Seite bezüglich Ihres Projekts ist spezifisch für Hostman. Ein Rebase-Deployment besteht aus zwei trennbaren Bestandteilen — dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt — und dasselbe Bundle läuft auf einem Laptop, in der Rebase Cloud und hier.

## App Platform

### 1. Datenbank erstellen

Erstellen Sie im Hostman-Panel einen **Managed PostgreSQL**-Cluster:

- **Version:** 16 oder neuer.
- **Region:** die Region, in der Sie die App betreiben werden.
- **Netzwerk:** ein privates Netzwerk. Platzieren Sie die App in Schritt 4 im selben Netzwerk. Das Netzwerk einer App wird bei deren Erstellung festgelegt und kann nachträglich nicht mehr geändert werden.

Der Cluster wird mit einem Benutzer `gen_user` und einer Datenbank `default_db` bereitgestellt. Kopieren Sie aus dem Reiter **Connection** den Verbindungs-String für die **private IP**. Dies ist Ihre `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Wenn der Cluster TLS erfordert, fügen Sie am Ende `?sslmode=require` hinzu.

#### Rolle erstellen, zu der Rebase wechselt

Rebase erzwingt Row-Level Security, indem bei jeder authentifizierten Anfrage zu einer eingeschränkten Rolle, `rebase_user`, gewechselt wird. `gen_user` muss die Berechtigung haben, diese Rolle zu erstellen und zu ihr zu wechseln.

1. Weisen Sie `gen_user` im Reiter **Users** des Clusters das Privileg **CREATE ROLE** zu. Die kleinste Konfiguration von Hostman (1 CPU, 1 GB RAM, 20 GB) erlaubt das Hinzufügen von Benutzern oder Datenbanken nicht. Wenn das Zuweisen des Privilegs nicht möglich ist, wählen Sie die nächstgrößere Konfiguration.
2. Verbinden Sie sich vor dem ersten Deployment einmalig als `gen_user` über `psql` und führen Sie Folgendes aus:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   Die Datenbank befindet sich in einem privaten Netzwerk; führen Sie dies daher von einem Cloud-Server im selben Netzwerk aus oder aktivieren Sie für die Dauer des Vorgangs den öffentlichen Zugriff.

Die zweite Anweisung ist die entscheidende. Unter PostgreSQL 16 und neuer wird ein Benutzer, der eine Rolle erstellt, ohne Superuser zu sein, zwar Mitglied dieser Rolle, darf jedoch nicht zu ihr wechseln. Wenn die Runtime die Rolle selbst erstellt, gelingt der Systemstart zwar, aber jede authentifizierte Anfrage schlägt anschließend mit `DB_PERMISSION_DENIED` fehl. Sollte das bereits passiert sein, führen Sie die `GRANT`-Zeile aus und starten Sie die App neu.

Falls Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie **pgvector** unter **Configuration → Extensions**. Das Scaffold deklariert keine.

### 2. Bucket erstellen

Erstellen Sie ein S3-kompatibles Bucket — Hostmans eigenen S3-Speicher oder den eines beliebigen anderen Anbieters. Notieren Sie sich aus den Bucket-Einstellungen den Endpunkt, die Region sowie den Access Key und Secret Key. Halten Sie das Bucket **privat**: Rebase signiert jeden Download, und `storageAuthorize` in `backend/storage.ts` bestimmt, wer lesen, schreiben und auflisten darf.

### 3. Dockerfile hinzufügen

App Platform baut aus Ihrem Repository, und `dist-bundle/` wird von Git ignoriert, daher baut das Image das Bundle selbst und übergibt es anschließend an die veröffentlichte Runtime. Committen Sie dies im Root-Verzeichnis des Projekts:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Drei Details sind hier wichtig:

- **`node:22`, nicht `node:22-slim`.** Die Installation der CLI lädt die Atlas-Schema-Engine herunter, die `curl` und CA-Zertifikate benötigt. Das Slim-Image enthält beides nicht, wodurch die Installation fehlschlägt.
- **`--chown=node:node`.** Die Runtime läuft als Benutzer `node` und verlinkt beim Start ihre eigenen Pakete in das Bundle. Ein Bundle im Besitz von `root` liefert zwar weiterhin Inhalte aus, protokolliert jedoch für jedes Paket, das nicht verlinkt werden konnte, eine Warnung.
- **Kein Quellcode im finalen Image.** Es enthält nur die Runtime und Ihr kompiliertes Bundle. Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung an der zweiten `FROM`-Zeile.

Das Runtime-Image lauscht auf Port 8080 und deklariert diesen mit `EXPOSE`; dies ist der Port, an den App Platform weiterleitet.

### 4. App erstellen

Erstellen Sie in **App Platform** eine **Backend**-App:

1. Verbinden Sie das GitHub-Repository und den Branch.
2. Setzen Sie **Framework** auf **Dockerfile**.
3. Wählen Sie dieselbe Region wie bei der Datenbank und das **private Netzwerk** der Datenbank.
4. Wählen Sie eine Konfiguration mit **2 GB RAM**. Das Bundle wird im Rahmen des Image-Builds gebaut, und der Build-Prozess benötigt in der Spitze etwa 1 GB, sodass bei einer 1-GB-Konfiguration der Arbeitsspeicher ausgehen kann.
5. Setzen Sie den **Health-Check-Pfad** auf `/livez`. Der Standardwert `/` funktioniert ebenfalls, aber `/livez` antwortet, ohne die Datenbank abzufragen, sodass eine kurze Datenbank-Störung eine ansonsten gesunde App nicht neu startet.

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

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` definieren den ersten Administrator. In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch hochgestuft, sodass auf keinem anderen Weg eines erstellt wird. Die Runtime erstellt das Konto einmalig, solange die Benutzertabelle leer ist. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

Die Adresse der App ist erst bekannt, wenn sie existiert. Erstellen Sie die App, lesen Sie deren technische Domain im Reiter **Dashboard** ab und setzen Sie dann `CORS_ORIGINS` sowie `FRONTEND_URL` darauf. Das Speichern der Einstellungen löst ein erneutes Deployment der App aus.

### 5. App aufrufen

Rufen Sie die Domain der App auf. Ein einzelner Container stellt das Admin-Panel unter `/` und die API unter `/api` bereit. Melden Sie sich mit `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` an und ändern Sie anschließend das Passwort.

Jeder Push in den Branch löst ein erneutes Deployment aus. Um eine eigene Domain hinzuzufügen, navigieren Sie zu **Settings → Domains**. Hostman stellt das Zertifikat aus. Fügen Sie den neuen Origin zu `CORS_ORIGINS` und `FRONTEND_URL` hinzu.

## Ein einzelner Cloud-Server

Ein Hostman-Cloud-Server betreibt denselben Stack wie jeder andere VPS: Postgres und die Runtime unter der projekt-eigenen `docker-compose.yml`, mit Caddy davor für HTTPS. Ein Server mit 2 vCPUs und 2 GB RAM reicht für den Einstieg aus.

Erstellen Sie ihn mit **Ubuntu 24.04** und Ihrem SSH-Schlüssel und folgen Sie anschließend den [Schritten für einen einzelnen Server auf der Hetzner-Seite](/docs/deployment/hetzner/#one-server-from-your-project). Nichts daran hängt von Hetzner ab.

Auf einem Server verbleiben Uploads auf dessen Festplatte: Die Compose-Datei speichert sie auf einem benannten Volume und setzt `FORCE_LOCAL_STORAGE=true`. Sie überstehen Neustarts und erneute Deployments, jedoch nicht den Verlust des Servers. Aktivieren Sie daher die Server-Backups von Hostman oder verschieben Sie sie in ein Bucket, sobald sie wichtig werden.

## Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Systemstart, einschließlich derer, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt. Es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an, sodass eine neue Collection beim nächsten Deployment direkt live ist.

`ensure` ändert niemals etwas, das bereits existiert. Es ändert weder einen Spaltentyp noch löscht es etwas oder bearbeitet die Bezeichner eines bestehenden Enums, da ein Deployment ein Schema nicht als Nebeneffekt umstrukturieren darf.

Jede Änderung, die nicht rein additiv ist — eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld —, erfordert `rebase db push`, ausgeführt aus einem lokalen Checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Prüfen Sie das SQL, das der Testlauf (Dry Run) ausgibt, und führen Sie den Befehl anschließend ohne `--dry-run` erneut aus. Zuvor sind bei Managed PostgreSQL zwei Dinge einzurichten:

- **Erreichbarkeit.** Eine Datenbank in einem privaten Netzwerk ist von Ihrem Laptop aus nicht erreichbar. Aktivieren Sie für die Dauer des Vorgangs den öffentlichen Zugriff oder führen Sie den Befehl von einem Server im selben Netzwerk aus.
- **Die Scratch-Datenbank.** `db push` plant jede Änderung in einer temporären Kopie des Schemas, in einer Datenbank, die nach Ihrer benannt ist und auf `_dev_diff` endet. Weisen Sie `gen_user` das Privileg **CREATEDB** zu oder erstellen Sie `default_db_dev_diff` einmalig über das Panel. Beides ist auf der kleinsten Konfiguration nicht möglich.

Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) — die Produktions-Checkliste und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) — alle Umgebungsvariablen, die die Runtime einliest.
- [Speicher](/docs/backend/storage) — Buckets, Zugriffsregeln und mehrere Speicherquellen gleichzeitig.
