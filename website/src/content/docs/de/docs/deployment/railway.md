---
sourceHash: 10ade706e21556d1
title: Rebase auf Railway bereitstellen
description: Stellen Sie Rebase auf Railway über das veröffentlichte Runtime-Image und Ihr Projekt-Bundle bereit. Behalten Sie den EU-Fokus bei.
sidebar_label: Railway
---

Railway ist ein modernes PaaS, das DevOps vereinfacht, und unterstützt europäische Deployment-Regionen (Amsterdam), sodass Sie die Anforderungen an regionales Hosting einhalten können.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Railway-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, über das [Helm chart](/docs/deployment/kubernetes) sowie hier.

## 1. Projekt erstellen und eine EU-Region festlegen

1. Melden Sie sich bei Ihrem [Railway account](https://railway.app/) an.
2. Klicken Sie auf **New Project**.
3. Gehen Sie zu **Settings → Default Region** und stellen Sie diese auf **Europe (Amsterdam)** ein. Wenn Sie dies *nach* dem Erstellen von Diensten tun, müssen Sie diese manuell migrieren.

## 2. PostgreSQL bereitstellen

1. Klicken Sie in Ihrem Projekt auf **New → Database → Add PostgreSQL**.
2. Warten Sie, bis die Bereitstellung abgeschlossen ist.
3. Railway stellt eine interne `DATABASE_URL`-Variable auf dem Tab **Variables** des Postgres-Widgets bereit.

Falls Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 3. Das Bundle erstellen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Commiten Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis des Repositorys, sodass der Build-Schritt von Railway lediglich ein Kopiervorgang und keine Kompilierung ist:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Erstellen Sie das Bundle in der CI und committen oder laden Sie es als Teil Ihres Releases hoch, oder führen Sie `rebase build` vor dem Pushen aus. In beiden Fällen enthält das von Railway erstellte Image weder eine Toolchain noch Quellcode – ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile, während Ihr Bundle unberührt bleibt.

Anschließend: **New → GitHub Repo**, wählen Sie Ihr Repository aus und lassen Sie Railway das Dockerfile im Root-Verzeichnis erkennen.

## 4. Umgebungsvariablen festlegen

1. Klicken Sie auf die Service-Karte.
2. Wechseln Sie zum Tab **Variables**.
3. Fügen Sie hinzu:
   - `JWT_SECRET`: eine sichere, zufällige Zeichenkette mit mindestens 32 Zeichen.
   - `REBASE_SERVICE_KEY`: eine weitere sichere, zufällige Zeichenkette mit mindestens 32 Zeichen.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: Ihre Frontend-Domain (z. B. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: identisch mit `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: die Adresse des ersten Administrators
   - `REBASE_ADMIN_PASSWORD`: mindestens 12 Zeichen

   Über die letzten drei Variablen erhält dieser Service überhaupt einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch hochgestuft, sodass auf anderem Wege kein erster angemeldeter Aufrufer entsteht. Setzen Sie diese, bevor der Service den ersten Datenverkehr bedient – siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin).

4. Klicken Sie auf **Reference Variable** und wählen Sie `DATABASE_URL` aus dem PostgreSQL-Service aus. Railway injiziert die interne Postgres-URL zur Laufzeit.

Railway setzt `PORT` und die Runtime bindet daran, sodass kein Port konfiguriert werden muss. Richten Sie den Health-Check auf `/livez` anstelle von `/health` aus: Letzteres führt einen Datenbank-Roundtrip durch, sodass ein darauf basierender Liveness-Probe einen eigentlich gesunden Container bei kurzen Datenbankaussetzern neu starten würde.

## 5. Domain freigeben

1. Gehen Sie auf der Service-Karte zu **Settings → Networking**.
2. Klicken Sie unter **Public Networking** auf **Generate Domain** für eine `.up.railway.app`-URL oder binden Sie eine benutzerdefinierte Domain ein.

## 6. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich der Tabellen Ihrer Collections.** Der Standardwert von `REBASE_MIGRATE_ON_BOOT` ist `ensure`, was über das gesamte Schema hinweg rein additiv ist – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere Datenbank sofort Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist, etwas bereits Existierendes zu verändern: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels eines bestehenden Enums, da ein Container-Neustart das Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Richten Sie `DATABASE_URL` auf den **öffentlichen** Connection-String Ihres Postgres-Services aus (Postgres-Widget → **Connect**); die referenzierte interne URL ist nur von innerhalb Railways erreichbar. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Railway-Container werden bei jedem Deployment ersetzt. Lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktionsumgebung verweigert. Binden Sie einen S3-kompatiblen Bucket mit `STORAGE_TYPE=s3` an – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die First-Admin-Regeln, die für alle Plattformen gelten.
- [Configuration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
