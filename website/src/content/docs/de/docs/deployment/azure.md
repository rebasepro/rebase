---
sourceHash: fcd75234f992e56c
title: Bereitstellung von Rebase auf Microsoft Azure
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure mit Azure Database for PostgreSQL und Azure Container Apps bereit.
sidebar_label: Azure
---

Microsoft Azure bietet tiefe Integrationen und Enterprise-Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure nutzt **Azure Database for PostgreSQL – Flexible Server** für die Datenschicht und **Azure Container Apps** für die Runtime.

Um europäische Datenschutzanforderungen zu erfüllen und schnelle lokale Antwortzeiten zu gewährleisten, stellen Sie Ihre Ressourcen in Regionen wie **West Europe (Amsterdam)**, **North Europe (Irland)** oder **France Central (Paris)** bereit.

Nichts auf dieser Seite ist für Ihr Projekt Azure-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. PostgreSQL Flexible Server bereitstellen

1. Suchen Sie im Azure-Portal nach **Azure Database for PostgreSQL servers** und wählen Sie diesen Dienst aus.
2. Klicken Sie auf **Create** und wählen Sie **Flexible Server** aus.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Compute-Größe (z. B. General Purpose oder Burstable `B2s` für kleinere Bereitstellungen).
5. Richten Sie den Tab **Authentication** mit einem Administrator-Benutzernamen und einem sicheren Passwort ein.
6. Stellen Sie unter **Networking** sicher, dass „Allow public access from any Azure service within Azure to this server“ aktiviert ist, damit Ihre Container App eine Verbindung herstellen kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie Ihren Servernamen und stellen Sie die Verbindungs-URI zusammen:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Falls Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig: Azure schützt dies hinter dem Serverparameter `azure.extensions`, gefolgt von `CREATE EXTENSION vector;`.

## 2. Bundle bauen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dies aus:

```bash
rebase build
```

Container Apps zieht Images aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Erstellen Sie eine **Container Registry** in Ihrer gewählten EU-Region.
2. Melden Sie sich über Ihre CLI an:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Bauen und pushen Sie aus dem Projekt-Root-Verzeichnis:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Create**.
2. Erstellen Sie eine neue Container Apps Environment in Ihrer EU-Region.
3. Verweisen Sie im Tab **Container** auf Ihre ACR-Registry und wählen Sie das Image `rebase-backend:latest` aus.
4. Legen Sie die **Umgebungsvariablen** fest:

| Name | Wert |
|------|-------|
| `DATABASE_URL` | Ihre Azure-Postgres-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht hochgestuft, sodass sonst kein erster authentifizierter Aufrufer vorhanden wäre. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Speichern Sie die Secrets als Container Apps Secrets und referenzieren Sie diese, anstatt sie als Klartext-Umgebungswerte zu hinterlegen.

5. Aktivieren Sie im Tab **Ingress** den Ingress.
6. Setzen Sie den Target Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern durch `PORT` nicht anders angegeben.
7. Richten Sie die Health Probe auf `/livez` aus. Nicht auf `/health`: Letzteres führt einen Datenbank-Roundtrip durch, weshalb eine Liveness Probe darauf einen ansonsten intakten Container bei einem kurzen Schluckauf der Datenbank neu starten würde.
8. Schließen Sie die Erstellung ab. Azure stellt den Container bereit und stellt Ihnen eine mit TLS gesicherte Anwendungs-URL zur Verfügung.

## 4. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derjenigen Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start auf einem leeren Server direkt mit der Bereitstellung Ihrer Collections beginnt.

Was `ensure` niemals tut, ist, etwas bereits Existierendes zu verändern: Es ändert weder einen Spaltentyp noch löscht es etwas oder bearbeitet die Labels eines bestehenden Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umformen darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job, bei dem `DATABASE_URL` auf Ihren Flexible Server zeigt (fügen Sie bei Bedarf eine Firewall-Regel hinzu, die Ihre Client-IP zulässt):

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Container-Apps-Replikate verfügen über keinen persistenten Speicher (durable disk). Lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktion verweigert. Erstellen Sie ein Azure-Speicherkonto und nutzen Sie dessen S3-kompatible Schnittstelle oder ein S3-kompatibles Bucket in derselben Region mit `STORAGE_TYPE=s3` – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Bereitstellung](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.

---
