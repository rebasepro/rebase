---
sourceHash: c8c26c456236b255
title: Rebase auf Microsoft Azure bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure mithilfe von Azure Database for PostgreSQL und Azure Container Apps bereit.
sidebar_label: Azure
---

Microsoft Azure bietet enge Integrationen und Enterprise-Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure nutzt **Azure Database for PostgreSQL – Flexible Server** für die Datenschicht und **Azure Container Apps** für die Runtime.

Um europäischen Daten-Compliance-Vorgaben und schnellen lokalen Antwortzeiten gerecht zu werden, stellen Sie Ihre Ressourcen in Regionen wie **West Europe (Amsterdam)**, **North Europe (Irland)** oder **France Central (Paris)** bereit.

Nichts auf dieser Seite an Ihrem Projekt ist Azure-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. PostgreSQL Flexible Server bereitstellen

1. Suchen Sie im Azure-Portal nach **Azure Database for PostgreSQL-Server** und wählen Sie diesen Eintrag aus.
2. Klicken Sie auf **Erstellen** und wählen Sie **Flexible Server**.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Compute-Größe (z. B. Universell oder Burstable `B2s` für kleinere Deployments).
5. Richten Sie auf der Registerkarte **Authentifizierung** einen Administrator-Benutzernamen und ein sicheres Passwort ein.
6. Stellen Sie unter **Netzwerk** sicher, dass „Öffentlichen Zugriff von jedem Azure-Dienst innerhalb von Azure auf diesen Server zulassen“ aktiviert ist, damit Ihre Container App eine Verbindung herstellen kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie sich Ihren Servernamen und erstellen Sie die Verbindungs-URI:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig: Azure schützt dies über den Serverparameter `azure.extensions`, gefolgt von `CREATE EXTENSION vector;`.

## 2. Bundle erstellen und in ein Image einbinden

Es muss **kein Anwendungs-Image aus Ihrem Quellcode gebaut werden**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Container Apps bezieht Images aus einer Registry, binden Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen genügen, um exakt festzulegen, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Erstellen Sie eine **Container Registry** in Ihrer gewählten EU-Region.
2. Melden Sie sich über Ihre CLI an:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Bauen und pushen Sie das Image vom Projekt-Root aus:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Erstellen**.
2. Erstellen Sie eine neue Container Apps-Umgebung in Ihrer EU-Region.
3. Verweisen Sie auf der Registerkarte **Container** auf Ihre ACR-Registry und wählen Sie das Image `rebase-backend:latest` aus.
4. Legen Sie die **Umgebungsvariablen** fest:

| Name | Wert |
|------|------|
| `DATABASE_URL` | Ihre Azure Postgres-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit 32+ Zeichen |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenfolge mit 32+ Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird der erste registrierte Account nicht automatisch hochgestuft, sodass auf anderem Weg kein erster angemeldeter Aufrufer entsteht. Siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin). Speichern Sie die Secrets als Container Apps Secrets und referenzieren Sie diese, anstatt sie als Klartext-Umgebungswerte zu hinterlegen.

5. Aktivieren Sie unter der Registerkarte **Ingress** den Ingress.
6. Setzen Sie den Zielport auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes vorgibt.
7. Richten Sie den Health Probe auf `/livez` aus. Nicht auf `/health`: Dieser führt einen Datenbank-Roundtrip aus, sodass ein Liveness Probe darauf einen fehlerfreien Container während eines kurzen Datenbankaussetzers neu starten würde.
8. Schließen Sie die Erstellung ab. Azure stellt den Container bereit und vergibt eine mit TLS abgesicherte Anwendungs-URL.

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich der Tabellen Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start gegen einen leeren Server sofort Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern von Bestehendem: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Labels, da ein Container-Neustart ein Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit `DATABASE_URL` auf Ihren Flexible Server gerichtet (fügen Sie bei Bedarf eine Firewall-Regel für Ihre Client-IP hinzu):

```bash
rebase db push
```

- **Junction-Table RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Container Apps-Replikate besitzen keinen persistenten Speicher (durable disk). Lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktion verweigert. Erstellen Sie ein Azure Storage-Konto und nutzen Sie dessen S3-kompatible Schnittstelle oder ein S3-kompatibles Bucket in derselben Region mit `STORAGE_TYPE=s3` – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die First-Admin-Regeln, die für jede Plattform gelten.
- [Configuration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime einliest.
