---
sourceHash: 3f66e135e36c529b
title: Windows
sidebar_label: Windows
description: Ein Rebase-Projekt unter Windows installieren und ausführen – was nativ funktioniert, das eine Tool (Atlas), das eine eigene Windows-Binärdatei für db push, db generate und db migrate benötigt, und wann stattdessen WSL2 verwendet werden sollte.
---

Ein Rebase-Projekt lässt sich unter Windows installieren und ausführen. Ein Tool erfordert einen zusätzlichen Schritt:
[Atlas](https://atlasgo.io/), die Engine zur Planung von Schema-Migrationen. Das zugehörige npm-Paket,
`@ariga/atlas`, liefert nur Builds für Linux und macOS aus, daher installieren Sie
unter Windows stattdessen die eigenständige Windows-Binärdatei von Atlas.

Nur drei Befehle verwenden Atlas: [`rebase db push`, `rebase db generate` und
`rebase db migrate`](/docs/cli/database/#commands). Das Ausführen der App benötigt es nicht. `rebase dev` erstellt fehlende
Tabellen und Spalten beim Start auch ohne Atlas, sodass Sie mit der Entwicklung beginnen können,
bevor Sie es installieren.

Die CI von Rebase läuft unter Linux und macOS. Wenn Ihre lokale Umgebung exakt mit einem Linux-Server
übereinstimmen soll, verwenden Sie stattdessen [WSL2](#alternative-wsl2).

## 1. Voraussetzungen

- **Node.js** 22.22+ und **pnpm**, wie im [Quickstart](/docs/getting-started/quickstart/#prerequisites)
- PowerShell für den Atlas-Schritt unten

## 2. Projekt erstellen

```bash
pnpm dlx @rebasepro/cli init my-app
```

Die Installation gibt ein fehlgeschlagenes `preinstall` für `@ariga/atlas` mit
`Unsupported platform` aus und wird dann abgeschlossen. Das ist zu erwarten. Das Scaffold
deklariert `@ariga/atlas` als optionale Abhängigkeit, sodass Plattformen, auf denen es nicht
installiert werden kann, es überspringen und die Installation fortgesetzt wird.

```bash
cd my-app
pnpm dev
```

Mehr ist nicht erforderlich. Die App, das Admin-Panel und die verwaltete Entwicklungsdatenbank
laufen alle ohne Atlas.

## 3. Atlas für die Schema-Befehle installieren

Laden Sie die Windows-Binärdatei von Atlas herunter, speichern Sie sie als `atlas.exe` und fügen Sie deren Ordner
zu Ihrem Benutzer-`PATH` hinzu. In PowerShell:

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

## Ein zuvor erstelltes Projekt

Ein Projekt, das mit einer älteren Version von `@rebasepro/cli` erstellt wurde, deklariert `@ariga/atlas` unter
`dependencies`, und dessen Installation schlägt unter Windows mit
`ELIFECYCLE Command failed with exit code 1` fehl. Verschieben Sie es in `backend/package.json` nach
`optionalDependencies`:

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Entfernen Sie es aus `dependencies`, führen Sie `pnpm install` aus und folgen Sie dann
[Schritt 3](#3-atlas-für-die-schema-befehle-installieren). Unter Linux und macOS ändert sich
nichts, da eine optionale Abhängigkeit installiert wird, wenn dies möglich ist. Das
schließt die CI und das Deployment-Image ein.

## Alternative: WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) führt eine echte Linux-Distribution
aus, sodass das npm-Paket normal installiert wird und keiner der oben genannten Schritte
erforderlich ist. Darauf basiert auch Docker Desktop.

Behalten Sie das Projekt innerhalb des Linux-Dateisystems (`~/code/my-app`) und nicht unter
`/mnt/c/`. Das Lesen von Dateien über diese Grenze hinweg verlangsamt Installationen und den Datei-Watcher.
Öffnen Sie das Projekt von Windows aus mit der
[VS Code WSL-Erweiterung](https://code.visualstudio.com/docs/remote/wsl) oder
über `\\wsl$\`.

## Nächste Schritte

- [Quickstart](/docs/getting-started/quickstart/): Die weiteren Schritte beim ersten Start, identisch auf jeder Plattform
- [Datenbankbefehle](/docs/cli/database/): Was `db push`, `db generate` und `db migrate` jeweils tun
- [Fehlerbehebung](/docs/troubleshooting/): Fehler, die den Start des Backends verhindern, und wie sie sich äußern
