---
sourceHash: 44b8d8c5aa0525b6
title: Rebase auf Microsoft Azure bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure bereit, indem Sie Azure Database for PostgreSQL und Azure Container Apps verwenden.
sidebar_label: Azure
---

Microsoft Azure bietet enge Integrationen und unternehmensweite Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure umfasst die Verwendung von **Azure Database for PostgreSQL - Flexible Server** für die Datenschicht und **Azure Container Apps** zum Hosten des Backend-Containers.

Um die europäischen Daten-Compliance und schnelle lokale Antwortzeiten zu gewährleisten, stellen Sie Ihre Ressourcen in Regionen wie **Westeuropa (Amsterdam)**, **Nordeuropa (Irland)** oder **Zentralfrankreich (Paris)** bereit.

## 1. PostgreSQL Flexible Server bereitstellen

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut wird**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Funktionen und Crons — und, wenn Ihr Projekt eine statische App deklariert, Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Container Apps zieht aus einer Registry, backen Sie das Bundle also in ein abgeleitetes Image. Drei Zeilen, und sie fixieren genau das, was läuft:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Ein späteres Rebase-Upgrade ist eine Änderung an dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

1. Suchen und wählen Sie im Azure-Portal **Azure Database for PostgreSQL servers** aus.
2. Klicken Sie auf **Erstellen** und wählen Sie **Flexibler Server** aus.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Compute-Größe aus (z. B. General Purpose oder Burstable `B2s` für kleinere Bereitstellungen).
5. Richten Sie die Registerkarte **Authentifizierung** mit einem Administrator-Benutzernamen und einem sicheren Passwort ein.
6. Stellen Sie unter **Netzwerk** sicher, dass "Öffentlichen Zugriff von jedem Azure-Dienst innerhalb von Azure auf diesen Server zulassen" aktiviert ist, damit Ihre Container App eine Verbindung herstellen kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie Ihren Servernamen und erstellen Sie die Verbindungs-URI:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Erstellen und Pushen zu Azure Container Registry (ACR)

Azure Container Apps zieht Ihr Docker-Image aus ACR.
1. Erstellen Sie eine neue **Container Registry** in Ihrer ausgewählten EU-Region.
2. Melden Sie sich über Ihre CLI an:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Bauen und pushen Sie aus dem Projekt-Stammverzeichnis:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

## 3. Azure Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Erstellen**.
2. Erstellen Sie eine neue Container Apps-Umgebung in Ihrer EU-Region.
3. Zeigen Sie auf der Registerkarte **Container** auf Ihre ACR-Registrierung und wählen Sie das Image `rebase-backend:latest` aus.
4. Legen Sie die **Umgebungsvariablen** fest:

| Name | Wert |
|------|-------|
| `DATABASE_URL` | Ihre Azure Postgres Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit 32+ Zeichen |
| `NODE_ENV` | `production` |

5. Aktivieren Sie unter der Registerkarte **Ingress** explizit den Ingress.
6. Stellen Sie den Zielport auf **3001** ein.
7. Schließen Sie die Erstellung ab. Azure stellt den Container automatisch bereit und liefert Ihnen eine mit TLS gesicherte Anwendungs-URL!

## 4. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Fügen Sie in Azure Database for PostgreSQL vorübergehend eine Firewall-Regel für Ihre IP-Adresse hinzu, damit Sie die Produktionsdatenbank von Ihrem Rechner aus erreichen können.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

---
