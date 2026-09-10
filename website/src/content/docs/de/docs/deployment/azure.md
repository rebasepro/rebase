---
sourceHash: b2acba62de849f55
title: Bereitstellung von Rebase auf Microsoft Azure
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure bereit – mit Azure Database for PostgreSQL und Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure bietet tiefe Integrationen und Enterprise-Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure nutzt **Azure Database for PostgreSQL – Flexible Server** für die Datenebene und **Azure Container Apps** für die Runtime.

Um europäische Datenschutzvorgaben und schnelle lokale Antwortzeiten zu gewährleisten, sollten Sie Ihre Ressourcen in Regionen wie **West Europe (Amsterdam)**, **North Europe (Irland)** oder **France Central (Paris)** bereitstellen.

Nichts auf dieser Seite ist für Ihr Projekt Azure-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. PostgreSQL Flexible Server bereitstellen

1. Suchen Sie im Azure-Portal nach **Azure Database for PostgreSQL-Server** und wählen Sie diesen Dienst aus.
2. Klicken Sie auf **Erstellen** und wählen Sie **Flexibler Server**.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Computegröße (z. B. General Purpose oder Burstable `B2s` für kleinere Deployments).
5. Richten Sie auf der Registerkarte **Authentifizierung** einen Administrator-Benutzernamen und ein sicheres Kennwort ein.
6. Stellen Sie unter **Netzwerkbetrieb** sicher, dass „Öffentlichen Zugriff von beliebigen Azure-Diensten in Azure auf diesen Server zulassen“ aktiviert ist, damit Ihre Container App eine Verbindung herstellen kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie sich Ihren Servernamen und stellen Sie die Verbindungs-URI zusammen:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Erweiterung einmalig: Azure schützt dies hinter dem Serverparameter `azure.extensions`, führen Sie anschließend `CREATE EXTENSION vector;` aus.

## 2. Bundle bauen und in ein Image integrieren

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Container Apps zieht Images aus einer Registry. Betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen genügen, um exakt festzulegen, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Erstellen**.
2. Erstellen Sie eine neue Container Apps-Umgebung in Ihrer EU-Region.
3. Verweisen Sie auf der Registerkarte **Container** auf Ihre ACR-Registry und wählen Sie das Image `rebase-backend:latest` aus.
4. Legen Sie die **Umgebungsvariablen** fest:

| Name | Wert |
|------|-------|
| `DATABASE_URL` | Ihre Azure-Postgres-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenkette mit mindestens 32 Zeichen |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenkette mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, **vor dem ersten Start** festzulegen |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch hochgestuft, sodass auf andere Weise kein erster authentifizierter Aufrufer existiert. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). Speichern Sie die Secrets als Container Apps Secrets und referenzieren Sie diese, anstatt sie als Klartext-Umgebungsvariablen zu hinterlegen.

5. Aktivieren Sie Ingress auf der Registerkarte **Ingress**.
6. Setzen Sie den Zielport auf **8080** – den Port, auf dem das Runtime-Image lauscht, sofern über `PORT` nichts anderes festgelegt ist.
7. Richten Sie den Health-Probe auf `/livez` aus. Verwenden Sie nicht `/health`: dieser führt einen Datenbank-Roundtrip aus, wodurch ein Liveness-Probe bei einem kurzen Schluckauf der Datenbank einen ansonsten fehlerfreien Container neu starten würde.
8. Schließen Sie die Erstellung ab. Azure stellt den Container bereit und stellt Ihnen eine mit TLS gesicherte Anwendungs-URL zur Verfügung.

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Starten, einschließlich derer Ihrer Collections.** Standardmäßig ist `REBASE_MIGRATE_ON_BOOT` auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt: Es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an – somit ist der erste Start gegen einen leeren Server sofort bereit, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern bestehender Elemente: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels vorhandener Enums, da ein Container-Neustart das Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit auf Ihren Flexible Server zeigender `DATABASE_URL` (fügen Sie bei Bedarf eine Firewall-Regel hinzu, die Ihre Client-IP zulässt):

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Replikate von Container Apps besitzen keinen persistenten Datenträger; lokaler Dateispeicher führt daher zu unbemerktem Datenverlust und wird von der Runtime in der Produktion verweigert. Erstellen Sie ein Azure-Storage-Konto und nutzen Sie dessen S3-kompatible Schnittstelle oder einen S3-kompatiblen Bucket in derselben Region mit `STORAGE_TYPE=s3` – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktivbetrieb und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.

---
