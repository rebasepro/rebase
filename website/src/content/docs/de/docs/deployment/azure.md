---
sourceHash: 1fdfb40ed3615bbd
title: Rebase auf Microsoft Azure bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure mithilfe von Azure Database for PostgreSQL und Azure Container Apps bereit.
sidebar_label: Azure
---

Microsoft Azure bietet enge Integrationen und Enterprise-Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure nutzt **Azure Database for PostgreSQL – Flexible Server** für die Datenschicht und **Azure Container Apps** für die Runtime.

Um europäische Daten-Compliance und schnelle lokale Antwortzeiten zu gewährleisten, stellen Sie Ihre Ressourcen in Regionen wie **West Europe (Amsterdam)**, **North Europe (Irland)** oder **France Central (Paris)** bereit.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Azure-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. PostgreSQL Flexible Server bereitstellen

1. Suchen und wählen Sie im Azure-Portal **Azure Database for PostgreSQL-Server** aus.
2. Klicken Sie auf **Erstellen** und wählen Sie **Flexible Server**.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Computegröße (z. B. Universell / General Purpose oder Burstable `B2s` für kleinere Deployments).
5. Konfigurieren Sie den Reiter **Authentifizierung** mit einem Administrator-Benutzernamen und einem sicheren Passwort.
6. Stellen Sie unter **Netzwerk** sicher, dass „Öffentlichen Zugriff von jedem Azure-Dienst in Azure auf diesen Server zulassen“ aktiviert ist, damit Ihre Container App eine Verbindung herstellen kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie sich Ihren Servernamen und stellen Sie die Verbindungs-URI zusammen:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig: Azure schützt dies hinter dem Serverparameter `azure.extensions`, gefolgt von `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Container Apps bezieht Images aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Erstellen Sie eine **Container Registry** in Ihrer gewählten EU-Region.
2. Melden Sie sich über Ihre CLI an:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Bauen und pushen Sie das Image aus dem Projektstammverzeichnis:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Ein späteres Rebase-Upgrade erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Die Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Erstellen**.
2. Erstellen Sie eine neue Container Apps-Umgebung in Ihrer EU-Region.
3. Verweisen Sie auf dem Reiter **Container** auf Ihre ACR-Registry und wählen Sie das Image `rebase-backend:latest` aus.
4. Konfigurieren Sie die **Umgebungsvariablen**:

| Name | Wert |
|------|-------|
| `DATABASE_URL` | Ihr Azure-Postgres-Verbindungsstring |
| `JWT_SECRET` | Eine sichere zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `REBASE_SERVICE_KEY` | Eine sichere zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und als CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Einstellungen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht hochgestuft, sodass es sonst keine Möglichkeit gäbe, den ersten angemeldeten Aufrufer zu erzeugen. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). Speichern Sie die Secrets als Container Apps Secrets und referenzieren Sie diese, anstatt sie als einfache Umgebungswerte im Klartext zu hinterlegen.

5. Aktivieren Sie Ingress auf dem Reiter **Ingress**.
6. Setzen Sie den Zielport (Target Port) auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern durch `PORT` nicht anders festgelegt.
7. Richten Sie den Health Probe auf `/livez`. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip aus, wodurch ein Liveness Probe auf diesem Endpunkt einen fehlerfreien Container bei einem kurzen Datenbankproblem neu starten würde.
8. Schließen Sie die Erstellung ab. Azure stellt den Container bereit und stellt Ihnen eine mit TLS gesicherte Anwendungs-URL zur Verfügung.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich jener, die in `backend/schema` deklariert sind.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start gegen einen leeren Server direkt mit der Bereitstellung Ihrer Tabellen hochfährt.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da ein Container-Neustart ein Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Für eine Sache ist daher weiterhin die CLI erforderlich, ausgeführt aus einem Checkout oder einem CI-Job, wobei `DATABASE_URL` auf Ihren Flexible Server verweist (fügen Sie bei Bedarf eine Firewall-Regel hinzu, die Ihre Client-IP erlaubt):

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, weshalb dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie stattdessen Migrationsdateien mit `rebase db generate` und führen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Container Apps-Replikate besitzen keinen persistenten Speicherplatz, daher führt lokaler Dateispeicher zu stillem Datenverlust und die Runtime verweigert diesen im Produktionsbetrieb. Da Azure Blob Storage die S3-API nicht unterstützt, verwenden Sie ein S3-kompatibles Bucket in derselben Region mit `STORAGE_TYPE=s3` und dessen `S3_ENDPOINT` – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktionsbetrieb und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
