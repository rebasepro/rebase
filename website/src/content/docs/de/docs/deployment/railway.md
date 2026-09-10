---
sourceHash: 32d97963eacb9f50
title: Bereitstellung von Rebase auf Railway
description: Stellen Sie Rebase auf Railway über das veröffentlichte Runtime-Image und Ihr Projekt-Bundle bereit. Behalten Sie den EU-Fokus bei.
sidebar_label: Railway
---

Railway ist ein modernes PaaS, das DevOps deutlich vereinfacht, und es unterstützt europäische Deployment-Regionen (Amsterdam), sodass Sie regionale Hosting-Compliance gewährleisten.

Nichts auf dieser Seite ist für Ihr Projekt Railway-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. Ein Projekt und eine EU-Region erstellen

1. Melden Sie sich bei Ihrem [Railway-Konto](https://railway.app/) an.
2. Klicken Sie auf **New Project**.
3. Gehen Sie zu **Settings → Default Region** und stellen Sie diese auf **Europe (Amsterdam)** ein. Wenn Sie dies *nach* dem Erstellen von Diensten tun, müssen Sie diese manuell migrieren.

## 2. PostgreSQL bereitstellen

1. Klicken Sie in Ihrem Projekt auf **New → Database → Add PostgreSQL**.
2. Warten Sie, bis die Bereitstellung abgeschlossen ist.
3. Railway stellt auf dem Reiter **Variables** des Postgres-Widgets eine interne Variable `DATABASE_URL` bereit.

Falls Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 3. Das Bundle erstellen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Committen Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis des Repositorys, sodass der Build-Schritt von Railway ein Kopiervorgang und keine Kompilierung ist:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Bauen Sie das Bundle in der CI und committen oder laden Sie es als Teil Ihres Releases hoch, oder führen Sie `rebase build` vor dem Pushen aus. In jedem Fall enthält das von Railway gebaute Image weder Toolchain noch Quellcode – ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile, während Ihr Bundle unberührt bleibt.

Dann: **New → GitHub Repo**, wählen Sie Ihr Repository aus und lassen Sie Railway das Dockerfile im Root-Verzeichnis erkennen.

## 4. Umgebungsvariablen setzen

1. Klicken Sie auf die Service-Karte.
2. Gehen Sie zum Reiter **Variables**.
3. Fügen Sie hinzu:
   - `JWT_SECRET`: eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen.
   - `REBASE_SERVICE_KEY`: eine weitere sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: Ihre Frontend-Domain (z. B. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: identisch mit `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: die E-Mail-Adresse des ersten Administrators
   - `REBASE_ADMIN_PASSWORD`: mindestens 12 Zeichen

   Über die letzten drei erhält dieser Dienst überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass andernfalls kein erster angemeldeter Aufrufer existiert. Setzen Sie diese, bevor der Dienst zum ersten Mal Traffic bedient – siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

4. Klicken Sie auf **Reference Variable** und wählen Sie `DATABASE_URL` aus dem PostgreSQL-Dienst aus. Railway injiziert die interne Postgres-URL zur Laufzeit.

Railway setzt `PORT` und die Runtime bindet sich daran, daher muss kein Port konfiguriert werden. Richten Sie den Health-Check auf `/livez` statt auf `/health` aus: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf einen gesunden Container bei einem kurzen Datenbank-Schluckauf neu starten würde.

## 5. Die Domain freigeben

1. Gehen Sie auf der Service-Karte zu **Settings → Networking**.
2. Klicken Sie unter **Public Networking** auf **Generate Domain** für eine `.up.railway.app`-URL oder binden Sie eine eigene Domain an.

## 6. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere Datenbank direkt Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern von etwas, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels eines bestehenden Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deploys umgestalten darf.

Zwei Dinge erfordern daher weiterhin das CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeengter Typ, ein entferntes Feld.

Richten Sie `DATABASE_URL` auf den **öffentlichen** Connection-String Ihres Postgres-Dienstes aus (Postgres-Widget → **Connect**); die referenzierte interne URL ist nur von innerhalb von Railway erreichbar. Das Runtime-Image wird ohne das CLI ausgeliefert, daher wird dies niemals innerhalb des Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Railway-Container werden bei jedem Deploy ersetzt, daher führt lokaler Dateispeicher zu stillem Datenverlust und die Runtime verweigert diesen in der Produktion. Binden Sie einen S3-kompatiblen Bucket mit `STORAGE_TYPE=s3` an – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die First-Admin-Regeln, die für jede Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime liest.

---
