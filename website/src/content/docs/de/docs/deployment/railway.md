---
sourceHash: 7ec305359558821f
title: Rebase auf Railway bereitstellen
description: Stellen Sie Rebase auf Railway über das veröffentlichte Laufzeit-Image und Ihr Projekt-Bundle bereit. Behalten Sie den EU-Fokus bei.
sidebar_label: Railway
---

Railway ist ein modernes PaaS, das DevOps vereinfacht und europäische Bereitstellungsregionen (Amsterdam) unterstützt, sodass Sie regionale Hosting-Compliance gewährleisten können.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Railway-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Laufzeit-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, mit dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Ein Projekt und eine EU-Region erstellen

1. Melden Sie sich bei Ihrem [Railway-Konto](https://railway.app/) an.
2. Klicken Sie auf **New Project**.
3. Gehen Sie zu **Settings → Default Region** und stellen Sie sie auf **Europe (Amsterdam)** ein. Wenn Sie dies *nach* dem Erstellen von Diensten tun, müssen Sie diese manuell migrieren.

## 2. PostgreSQL bereitstellen

1. Klicken Sie in Ihrem Projekt auf **New → Database → Add PostgreSQL**.
2. Warten Sie, bis die Bereitstellung abgeschlossen ist.
3. Railway stellt eine interne Variable `DATABASE_URL` auf dem Tab **Variables** des Postgres-Widgets bereit.

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig für diese Datenbank: `CREATE EXTENSION vector;`.

## 3. Das Bundle erstellen und in ein Image einbinden

Es muss **kein Anwendungs-Image aus Ihrem Quellcode erstellt werden**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Laufzeit-Image führt dieses aus:

```bash
rebase build
```

Committen Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis des Repositorys, sodass der Build-Schritt von Railway lediglich ein Kopiervorgang statt einer Kompilierung ist:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Erstellen Sie das Bundle in CI und committen oder laden Sie es als Teil Ihres Releases hoch, oder führen Sie `rebase build` vor dem Pushen aus. In beiden Fällen enthält das von Railway erstellte Image weder eine Toolchain noch Quellcode – ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile, während Ihr Bundle unberührt bleibt.

Dann: **New → GitHub Repo**, wählen Sie Ihr Repository aus und lassen Sie Railway das Dockerfile im Root-Verzeichnis erkennen.

## 4. Umgebungsvariablen setzen

1. Klicken Sie auf die Dienstkarte.
2. Gehen Sie zum Tab **Variables**.
3. Fügen Sie Folgendes hinzu:
   - `JWT_SECRET`: eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen.
   - `REBASE_SERVICE_KEY`: eine weitere sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: Ihre Frontend-Domain (z. B. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: identisch mit `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: die E-Mail-Adresse des ersten Administrators
   - `REBASE_ADMIN_PASSWORD`: mindestens 12 Zeichen

   Über die letzten drei erhält dieser Dienst überhaupt einen Administrator: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass sonst kein erster angemeldeter Aufrufer zustande kommt. Setzen Sie diese Variablen, bevor der Dienst zum ersten Mal Datenverkehr verarbeitet – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

4. Klicken Sie auf **Reference Variable** und wählen Sie `DATABASE_URL` aus dem PostgreSQL-Dienst aus. Railway fügt die interne Postgres-URL zur Laufzeit ein.

Railway setzt `PORT` und die Laufzeitumgebung bindet daran, sodass kein Port konfiguriert werden muss. Richten Sie den Health Check auf `/livez` anstelle von `/health` ein: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness Probe darauf bei einem kurzen Datenbankproblem einen fehlerfreien Container neu starten würde.

## 5. Domain freigeben

1. Gehen Sie in der Service-Karte zu **Settings → Networking**.
2. Klicken Sie unter **Public Networking** auf **Generate Domain** für eine `.up.railway.app`-URL oder binden Sie eine eigene Domain an.

## 6. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Laufzeitumgebung erstellt fehlende Tabellen beim Start, einschließlich derjenigen, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` eingestellt, was für das gesamte Schema additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Datenbank direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Labels eines vorhandenen Enums, da ein Container-Neustart ein Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf.

Eine Sache erfordert daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Richten Sie `DATABASE_URL` auf den **öffentlichen** Verbindungsstring Ihres Postgres-Dienstes aus (Postgres-Widget → **Connect**); die referenzierte interne URL ist nur innerhalb von Railway erreichbar. Das Laufzeit-Image wird ohne die CLI ausgeliefert, daher wird dies niemals innerhalb des Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Railway-Container werden bei jedem Deployment ersetzt, daher führt lokaler Dateispeicher zu stillem Datenverlust und die Laufzeitumgebung verweigert dies in der Produktion. Binden Sie einen S3-kompatiblen Bucket mit `STORAGE_TYPE=s3` an – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) — die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Configuration](/docs/getting-started/configuration) — alle Umgebungsvariablen, die die Laufzeitumgebung liest.
