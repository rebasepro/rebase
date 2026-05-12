---
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

---
