---
sourceHash: 27f3eaf8b78d59e8
title: Rebase auf Railway bereitstellen
description: Stellen Sie Rebase auf Railway über das veröffentlichte Runtime-Image und Ihr Projekt-Bundle bereit. Behalten Sie den EU-Fokus bei.
sidebar_label: Railway
---

Railway ist ein modernes PaaS, das DevOps vereinfacht und europäische Bereitstellungsregionen (Amsterdam) unterstützt, sodass Sie regionale Hosting-Compliance einhalten.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Railway-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. Ein Projekt und eine EU-Region erstellen

1. Melden Sie sich bei Ihrem [Railway-Konto](https://railway.app/) an.
2. Klicken Sie auf **New Project**.
3. Gehen Sie zu **Settings → Default Region** und stellen Sie diese auf **Europe (Amsterdam)** ein. Wenn Sie dies *nach* dem Erstellen von Diensten tun, müssen Sie diese manuell migrieren.

## 2. PostgreSQL bereitstellen

1. Klicken Sie in Ihrem Projekt auf **New → Database → Add PostgreSQL**.
2. Warten Sie, bis die Bereitstellung abgeschlossen ist.
3. Railway stellt eine interne `DATABASE_URL`-Variable auf dem Reiter **Variables** des Postgres-Widgets bereit.

Falls Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Erweiterung einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 3. Das Bundle erstellen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Committen Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis des Repositories, damit der Build-Schritt von Railway nur ein Kopiervorgang und keine Kompilierung ist:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Erstellen Sie das Bundle in der CI und committen oder laden Sie es als Teil Ihres Releases hoch, oder führen Sie `rebase build` vor dem Pushen aus. In beiden Fällen enthält das von Railway erstellte Image weder eine Toolchain noch Quellcode – ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile, während Ihr Bundle unberührt bleibt.

Dann: **New → GitHub Repo**, wählen Sie Ihr Repository aus und lassen Sie Railway das Dockerfile im Root-Verzeichnis erkennen.

## 4. Umgebungsvariablen setzen

1. Klicken Sie auf die Service-Karte.
2. Gehen Sie zum Reiter **Variables**.
3. Fügen Sie hinzu:
   - `JWT_SECRET`: eine sichere, zufällige Zeichenkette mit mindestens 32 Zeichen.
   - `REBASE_SERVICE_KEY`: eine weitere sichere, zufällige Zeichenkette mit mindestens 32 Zeichen.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: Ihre Frontend-Domain (z. B. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: identisch mit `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: die Adresse des ersten Administrators
   - `REBASE_ADMIN_PASSWORD`: mindestens 12 Zeichen

   Über die letzten drei erhält dieser Dienst überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass sonst kein erster angemeldeter Aufrufer entsteht. Setzen Sie diese, bevor der Dienst zum ersten Mal Datenverkehr verarbeitet – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

4. Klicken Sie auf **Reference Variable** und wählen Sie `DATABASE_URL` aus dem PostgreSQL-Dienst aus. Railway injiziert die interne Postgres-URL zur Laufzeit.

Railway setzt `PORT` und die Runtime bindet daran, sodass kein Port konfiguriert werden muss. Richten Sie den Health Check auf `/livez` statt auf `/health` aus: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf einen fehlerfreien Container bei einem kurzen Schluckauf der Datenbank neu starten würde.

## 5. Domain freigeben

1. Gehen Sie in der Service-Karte zu **Settings → Networking**.
2. Klicken Sie unter **Public Networking** auf **Generate Domain** für eine `.up.railway.app`-URL oder binden Sie eine benutzerdefinierte Domain an.

## 6. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Booten fehlende Tabellen, einschließlich derjenigen, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv ist – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere Datenbank direkt mit Ihren Tabellen bereitsteht.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umgestalten darf.

Für eines wird daher weiterhin die CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Lassen Sie `DATABASE_URL` auf den **öffentlichen** Verbindungs-String Ihres Postgres-Dienstes verweisen (Postgres-Widget → **Connect**); die referenzierte interne URL ist nur innerhalb von Railway erreichbar. Das Runtime-Image wird ohne die CLI ausgeliefert, daher wird dies niemals innerhalb des Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Railway-Container werden bei jedem Deployment ersetzt, daher bedeutet lokaler Dateispeicher stillen Datenverlust, und die Runtime verweigert diesen in der Produktion. Binden Sie einen S3-kompatiblen Bucket mit `STORAGE_TYPE=s3` an – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
