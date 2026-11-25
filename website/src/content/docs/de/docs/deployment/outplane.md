---
sourceHash: 72d2830a213ccda1
title: Rebase auf Out Plane deployen
description: Deployen Sie ein rebase init-Projekt auf Out Plane – eine aus Ihrem Repository erstellte App, verwaltetes PostgreSQL von Out Plane und Datei-Uploads in einem Out Plane-Bucket.
sidebar_label: Out Plane
---

[Out Plane](https://outplane.com) erstellt und betreibt Apps aus einem GitHub-Repository mit verwaltetem PostgreSQL und S3-kompatiblen Buckets in derselben Konsole in Deutschland. Ein Rebase-Backend besteht aus einem Container und einer Postgres-Datenbank, sodass es auf drei Out Plane-Ressourcen abgebildet wird: eine **App**, eine **Datenbank** und einen **Bucket**.

Diese Seite führt Sie von einem frisch mit `rebase init` erstellten Projekt bis hin zu einer Live-URL auf einer einzelnen Instanz.

**Geschrieben für Rebase 0.32.0.** Die Version ist im Dockerfile in Schritt 3 fest vorgegeben; ein späteres Upgrade erfordert lediglich eine Änderung dieser einen Zeile.

**Datei-Uploads landen vom ersten Tag an in einem Bucket.** Das Dateisystem einer Out Plane-App wird bei jedem erneuten Deployment zurückgesetzt, sodass auf die Festplatte geschriebene Dateien beim nächsten Push verloren gehen würden. Siehe [Dateispeicher](#dateispeicher).

## Was Sie benötigen

- Ein Out Plane-Konto. Der **Starter**-Tarif deckt diese Anleitung ab: eine App, eine verwaltete Datenbank und ein Bucket.
- Ein GitHub-Repository für das Projekt.
- Optional die [`outplane`-CLI](https://docs.outplane.com). Jeder der folgenden Schritte kann in der Konsole ausgeführt werden; die CLI-Entsprechungen sind dort angegeben, wo sie Zeit sparen.

## 1. Projekt erstellen und pushen

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Committen Sie es und pushen Sie es in ein GitHub-Repository. Die Datei `.env` befindet sich in der `.gitignore` und bleibt dort auch: Die App erhält ihre eigenen Werte in Schritt 5.

## 2. Datenbank erstellen

Wählen Sie in der Konsole **Create → Database**:

- **Version:** 17 (Standard) oder 16. Alles ab 16 funktioniert.
- **Region:** Frankfurt, in der Nähe Ihrer App.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

Kopieren Sie aus dem Bereich **Connection** der Datenbank die Verbindungszeichenfolge (im `psql`-Format) oder lassen Sie sie mit `outplane db url my-app-db` ausgeben. Out Plane erfordert SSL für jede Verbindung. Ihre `DATABASE_URL` ist diese Zeichenfolge mit `sslmode=no-verify` am Ende, anstelle eines eventuell bereits vorhandenen `sslmode`:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Verwenden Sie `no-verify`, nicht `require`.** Beide verschlüsseln die Verbindung. Für `psql` bedeutet `require` zusätzlich „Zertifikat nicht anhand einer öffentlichen Zertifizierungsstelle überprüfen“, aber der Postgres-Treiber, auf dem Rebase läuft, interpretiert dies als „überprüfen“. Ein Datenbankzertifikat, das nicht öffentlich signiert ist, schlägt dann bei der ersten Verbindung mit `self-signed certificate` fehl. `no-verify` ist die Schreibweise dieses Treibers für das, was `require` überall sonst bedeutet. Die Node.js-Anleitung von Out Plane schaltet die Überprüfung aus demselben Grund ab. Dieselbe URL funktioniert auch für `rebase db push` von Ihrem Rechner aus: Die CLI übergibt sie als `sslmode=require` an die Atlas-Schema-Engine.

### Die Rolle, zu der Rebase wechselt

Rebase erzwingt Row-Level Security, indem jede authentifizierte Anfrage zu einer eingeschränkten Rolle, `rebase_user`, gewechselt wird. Beim ersten Start erstellt die Runtime diese Rolle, gewährt der Rolle in Ihrer Verbindungszeichenfolge das Recht, zu ihr zu wechseln, und überprüft vor der Bereitstellung von Anfragen, ob der Wechsel funktioniert. Sie müssen nichts manuell ausführen.

Wenn der erste Start mit einem `AppRoleSetupError` abbricht, der `rebase_user` nennt, ist es der Rolle in Ihrer Verbindungszeichenfolge nicht gestattet, Rollen zu erstellen oder sich selbst das Recht zum Wechseln zu gewähren. Der Fehler gibt das stattdessen auszuführende SQL aus: Führen Sie es einmal als Rolle auf der Datenbank aus, die Rollen erstellen darf, und deployen Sie dann erneut.

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, benötigt die Datenbank die pgvector-Erweiterung. Das Scaffold deklariert keine.

## 3. Bucket erstellen

Erstellen Sie unter **Buckets → Create bucket** einen Bucket und belassen Sie ihn auf **private** (Standardeinstellung). Rebase stellt jeden Download über seine eigene API bereit, und `storageAuthorize` in `backend/storage.ts` entscheidet, wer lesen, schreiben und auflisten darf.

Out Plane fügt dem Namen ein zufälliges Suffix hinzu. Verwenden Sie den **vollständigen** Namen, der angezeigt wird, nicht den kurzen Namen, den Sie eingegeben haben.

Erstellen Sie auf dem Reiter **Access** des Buckets einen Schlüssel mit der Berechtigung **Read and write**. Das Secret wird nur einmal angezeigt: Kopieren Sie es jetzt.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

Die Hinweise von Out Plane bezüglich CORS-Regeln für Browser-Uploads gelten hier nicht: Das Rebase-Admin-Panel und das SDK laden Dateien über die API hoch, und die Runtime schreibt vom Server aus in den Bucket.

## 4. Dockerfile hinzufügen

Out Plane baut entweder aus einem Dockerfile oder mit Buildpacks. Verwenden Sie ein Dockerfile: Das Projekt wird mit pnpm installiert, und das Image baut das Bundle selbst und übergibt es dann an die veröffentlichte Runtime. Committen Sie dies im Stammverzeichnis des Projekts:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.38.0
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Hierbei sind drei Details wichtig:

- **`node:22`, nicht `node:22-slim`.** Bei der Installation der CLI wird die Atlas-Schema-Engine heruntergeladen, die `curl` und CA-Zertifikate benötigt. Das Slim-Image enthält keines von beidem, und die Installation schlägt fehl.
- **`--chown=node:node`.** Die Runtime läuft als `node` und verlinkt beim Start ihre eigenen Pakete in das Bundle. Ein Bundle im Besitz von `root` funktioniert zwar weiterhin, protokolliert jedoch für jedes Paket, das nicht verlinkt werden konnte, eine Warnung.
- **Kein Quellcode im finalen Image.** Es enthält nur die Runtime und Ihr kompiliertes Bundle; `dist-bundle/` bleibt in der `.gitignore`.

Das Runtime-Image lauscht auf Port **8080** und deklariert dies mit `EXPOSE`, sodass Out Plane den Port automatisch ausfüllt, wenn es das Dockerfile liest.

## 5. App erstellen

Erstellen Sie eine Anwendung über die Konsole, verknüpfen Sie das Repository sowie den Branch und legen Sie Folgendes fest:

| Feld | Wert |
| --- | --- |
| Build method | **Dockerfile** |
| Root directory | `/` |
| Port | `8080`, **HTTP**, **public** |
| Start command | *(leer lassen – das des Images selbst)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

Wählen Sie unter **Settings → Environment** die Option **Edit as .env** und fügen Sie Folgendes ein:

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Klicken Sie anschließend auf **Save & deploy**. Out Plane wendet Änderungen an den Umgebungsvariablen erst beim nächsten Deployment an. Mit der CLI fügen Sie dieselben Zeilen in eine Datei ein und führen `outplane env push --app my-app --deploy` aus.

Wozu die weniger offensichtlichen Zeilen dienen:

- **`NODE_ENV=production`.** Out Plane setzt dies nicht automatisch. Ohne diese Angabe startet die Runtime im Entwicklungsmodus, in dem der erste fremde Benutzer, der sich registriert, zum Administrator wird.
- **`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD`.** In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch hochgestuft. Diese Variablen bestimmen daher den ersten Administrator. Die Runtime erstellt das Konto einmalig, solange die Benutzertabelle leer ist. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Rebase spricht einen benutzerdefinierten S3-Endpunkt standardmäßig im Path-Style an, da MinIO und die meisten selbst gehosteten Speicher dies erfordern. Out Plane-Buckets akzeptieren jedoch nur Virtual-Hosted-Anfragen (`https://<bucket>.obj.outplane.dev/…`), und Anfragen im Path-Style schlagen fehl. Diese Zeile ist erforderlich.
- **`S3_REGION=auto`.** Out Plane-Buckets sind global, und Clients signieren mit `auto`.

Die `outplane.app`-Adresse der App wird angezeigt, sobald die App existiert. Weicht sie von Ihrer Annahme ab, korrigieren Sie `CORS_ORIGINS` und `FRONTEND_URL` und klicken Sie erneut auf **Save & deploy**.

## 6. App öffnen

Öffnen Sie die URL der App. Ein Container stellt das Admin-Panel unter `/` und die API unter `/api` bereit. Melden Sie sich mit `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` an und ändern Sie anschließend das Passwort.

Der erste Start erstellt alle erforderlichen Tabellen – einschließlich Ihrer eigenen Tabellen – zusammen mit deren Row-Level-Security-Richtlinien. Es muss vorab keine Migration ausgeführt werden. Laden Sie eine Datei über das Admin-Panel hoch, um die Bucket-Einstellungen zu überprüfen: Ein Fehler an dieser Stelle deutet fast immer darauf hin, dass dem Bucket-Namen das Suffix fehlt oder `S3_FORCE_PATH_STYLE=false` nicht gesetzt ist.

Jeder Push auf den Branch führt zu einem erneuten Deployment. Um eine eigene Domain zu verwenden, fügen Sie diese unter **Domains** hinzu, verbinden Sie sie mit Port 8080 der App und erstellen Sie den CNAME-Eintrag (oder für eine Root-Domain den A-Record), den die Konsole anzeigt. HTTPS wird ausgestellt, sobald der Eintrag aufgelöst werden kann. Fügen Sie dann den neuen Origin zu `CORS_ORIGINS` und `FRONTEND_URL` hinzu.

## Eine Instanz

Diese Seite läuft auf **einer Instanz**, was der Standard von Out Plane und das Limit des Starter-Tarifs ist. Ein einzelner Container bedient die API, das Admin-Panel, Realtime, Cron-Jobs und die Job-Queue.

Geplante Jobs würden auch mit mehreren Instanzen korrekt bleiben: Jede Cron-Ausführung wird vor dem Start in Postgres reserviert (claimed), sodass ein Slot nur einmal ausgeführt wird, unabhängig davon, wie viele Instanzen dafür getriggert werden. Andere Dinge sind instanzspezifisch – Rate Limiter, Caches für Bildtransformationen, laufende fortsetzbare Uploads – lesen Sie daher [Mehr als eine Instanz](/docs/deployment/multiple-instances/), bevor Sie die Anzahl unter **Settings → Scale** erhöhen.

## Dateispeicher

Uploads liegen im Out Plane-Bucket aus Schritt 3, sodass sie Re-Deployments überstehen, und die Festplatte der App selbst enthält keine relevanten Daten.

Um den Schlüssel zu rotieren: Erstellen Sie einen neuen Schlüssel auf dem Reiter **Access** des Buckets, tragen Sie ihn als `S3_ACCESS_KEY_ID` und `S3_SECRET_ACCESS_KEY` ein, klicken Sie auf **Save & deploy** und löschen Sie anschließend den alten Schlüssel. Out Plane weist darauf hin, dass ein gelöschter Schlüssel noch bis zu 15 Minuten lang funktionieren kann.

Wer Dateien lesen, schreiben und auflisten darf, wird durch `storageAuthorize` in `backend/storage.ts` geregelt, unabhängig davon, welcher Bucket sie enthält. Siehe [Speicher](/docs/backend/storage).

## Das Schema

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich derer, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg rein additiv arbeitet. Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an, sodass eine neue Tabelle beim nächsten Deployment direkt live ist.

`ensure` ändert niemals etwas, das bereits existiert. Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Bezeichnungen eines bestehenden Enums, da ein Deployment ein Schema nicht als Nebeneffekt umgestalten darf.

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld – erfordert `rebase db push`, ausgeführt aus einem lokalen Checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Prüfen Sie das SQL, das der Testlauf ausgibt, und führen Sie den Befehl dann erneut ohne `--dry-run` aus. Eine Änderung, bei der Daten gelöscht werden, erfordert zusätzlich `--allow-destructive`.

`db push` plant jede Änderung in einer temporären Arbeitskopie des Schemas in einer Datenbank, die nach Ihrer Datenbank mit dem Suffix `_dev_diff` benannt ist. Erstellen Sie diese einmalig auf dem Reiter **Access** der Datenbank, mit derselben Besitzer-Rolle wie Ihre Hauptdatenbank.

Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen vor dem Pushen `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` aus einem Checkout aus. Out Plane bietet keinen Release-Schritt, der vor einem Deployment läuft.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für die Produktion und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime einliest.
- [Speicher](/docs/backend/storage) – Buckets, Zugriffsregeln und mehrere Speicherquellen gleichzeitig.
