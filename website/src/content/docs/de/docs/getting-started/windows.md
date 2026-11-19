---
sourceHash: f1a8ff20d10b3dbd
title: Windows
sidebar_label: Windows
description: Ein Rebase-Projekt unter Windows installieren und seine Datenbankbefehle verwenden.
---

**Rebase 0.35+**

Rebase-Projekte laufen unter Windows. Das Scaffold installiert Ptah Compat
mit der Windows-Datei über den Paketmanager. Du musst kein Werkzeug für
Datenbankmigrationen separat herunterladen.

## Projekt erstellen

Installiere Node.js 22.22+ und pnpm. Führe dann aus:

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

Die Datenbankbefehle verwenden das installierte Ptah-Compat-Paket:

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

Das Paket stellt ausführbare Dateien für Windows x64 und Arm64 bereit. Falls
[`rebase doctor`](/docs/cli/#rebase-doctor) eine fehlende Datei meldet,
installiere die Projektabhängigkeiten mit aktivierten optionalen
Abhängigkeiten erneut.

## PostgreSQL-Projekt auf Rebase 0.35 aktualisieren

Führen Sie im Projektverzeichnis unter Linux, macOS oder Windows die CLI von Rebase
0.35 aus. Sie ersetzt `@ariga/atlas` im PostgreSQL-Backend durch
`@stokaro/ptah-compat`. Migrationsdateien, `atlas.sum` und erfasste Revisionen
bleiben erhalten.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

## Rebase 0.34 und früher

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Öffnen Sie ein neues Terminal, damit die neue `PATH`-Variable übernommen wird, und überprüfen Sie es:

```powershell
atlas version
```

Version 1.2.3 ist die älteste Version, die das Scaffold akzeptiert (`"@ariga/atlas": "^1.2.3"`).
Unter Linux und macOS verwendet die Installation die neueste 1.x-Version, daher funktioniert hier auch
jede neuere 1.x-Version: Ersetzen Sie einfach die Version in der URL. Es wird nur ein x64-Build veröffentlicht;
Windows on Arm führt ihn unter Emulation aus.

Die CLI sucht zuerst in `node_modules/.bin` und fragt dann Windows (`where atlas`).
Sobald sich `atlas.exe` im `PATH` befindet, finden die drei Befehle die Datei:

```bash
pnpm run db:push
```

[`rebase doctor`](/docs/cli/#rebase-doctor) überprüft dies ebenfalls. Solange sich `atlas.exe` nicht im `PATH` befindet,
warnt der Befehl und verlinkt auf diese Seite zurück.

### Bei Installationsfehlern älterer Projekte

Falls die Installation eines älteren Projekts mit `ELIFECYCLE` abbricht,
verschieben Sie `@ariga/atlas` in `backend/package.json` von `dependencies` nach
`optionalDependencies`. Führen Sie `pnpm install` aus und installieren Sie
`atlas.exe` wie oben beschrieben.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) ist eine Alternative,
wenn du eine Linux-Entwicklungsumgebung bevorzugst. Speichere das Projekt im
Linux-Dateisystem (`~/code/my-app`), damit Installationen und Dateibeobachtung
schneller sind.

Weiter geht es mit dem [Schnellstart](/docs/getting-started/quickstart/)
oder dem [Leitfaden zu Datenbankbefehlen](/docs/cli/database/).
