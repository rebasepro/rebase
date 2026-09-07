---
sourceHash: b4130f0ffba10745
title: Rebase auf Fly.io bereitstellen
description: Erfahren Sie, wie Sie Rebase global bereitstellen oder auf europäische Rechenzentren mit Fly.io beschränken können.
sidebar_label: Fly.io
---

Fly.io ermöglicht es Ihnen, Docker-Container über sein globales Anycast-Netzwerk nah bei Ihren Benutzern zu hosten. Fly ist hinsichtlich der Datenweiterleitung hochgradig konfigurierbar, was es zu einer ausgezeichneten Wahl für die Bereitstellung von Rebase-Anwendungen mit einem strengen Fokus auf europäische Daten macht.

Fly.io verfügt über Rechenzentren in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** und **Paris (cdg)**. 

## 1. Die Fly-App initialisieren
Führen Sie in Ihrem lokalen Rebase-Repository, nachdem Sie sichergestellt haben, dass die Fly CLI (`flyctl`) installiert ist, folgenden Befehl aus:

```bash
fly launch
```

1. **App-Name:** `my-rebase-app`
2. **Organisation:** Persönlich oder Ihre Unternehmens-Org.
3. **Region:** Wenn Sie nach einer Region gefragt werden, wählen Sie explizit ein europäisches Rechenzentrum wie **Frankfurt (fra)** oder **Paris (cdg)**.
4. **Datenbank:** Wenn Sie aufgefordert werden, eine Postgres-Datenbank einzurichten, sagen Sie **Ja**. Fly erstellt automatisch einen Postgres-Cluster in derselben Region und injiziert die `DATABASE_URL` sicher in Ihre App.
5. **Redis:** Sagen Sie **Nein**.

*Stellen Sie noch nicht bereit, wenn Sie dazu aufgefordert werden.* Wir müssen zuerst eine wichtige Umgebungsvariable festlegen.

## 2. Das JWT-Geheimnis festlegen
Bevor Ihre Anwendung in Produktion geht, müssen Sie das JWT-Geheimnis injizieren, damit Rebase Authentifizierungstoken-Operationen sicher signieren kann.

Führen Sie den folgenden Befehl lokal aus:
```bash
fly secrets set JWT_SECRET=your_super_long_randomly_generated_secure_string -a my-rebase-app
```

## 3. Interne Konfiguration validieren
Fly hat eine `fly.toml`-Datei im Stammverzeichnis Ihres Projekts generiert. Überprüfen Sie, ob der interne Port explizit mit der Rebase-Standardkonfiguration (`3001`) übereinstimmt:

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut wird**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Funktionen und Crons — und, wenn Ihr Projekt eine statische App deklariert, Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Fly.io zieht aus einer Registry, backen Sie das Bundle also in ein abgeleitetes Image. Drei Zeilen, und sie fixieren genau das, was läuft:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Ein späteres Rebase-Upgrade ist eine Änderung an dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Bereitstellen

Ihre Daten sind lokalisiert, Ihre Datenbank ist bereitgestellt und Ihre Geheimnisse sind injiziert. Starten Sie die Bereitstellung:

```bash
fly deploy
```

Sobald das Parsen und Hochladen abgeschlossen ist, wird Ihre Anwendung automatisch online gehen. Führen Sie `fly open` aus, um Ihre bereitgestellte App im Browser anzuzeigen!

## 5. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Öffnen Sie mit `fly proxy 5432 -a <postgres-app>` einen lokalen Tunnel zur Fly-Postgres-Instanz und setzen Sie `DATABASE_URL` entsprechend auf `localhost:5432`.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

---
