---
sourceHash: ce9b9cd9e35c5c3d
title: Windows
sidebar_label: Windows
description: Ein Rebase-Projekt unter Windows installieren und seine Datenbankbefehle verwenden.
---

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

## Älteres Projekt aktualisieren

Projekte, die vor der Ptah-Integration erstellt wurden, können noch von
`@ariga/atlas` abhängen. Führe beim Wechsel zu einer Rebase-Version mit
Ptah Compat `rebase upgrade` aus. Das Upgrade ersetzt diese Abhängigkeit
durch `@stokaro/ptah-compat`. Führe danach `pnpm install` aus.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) ist eine Alternative,
wenn du eine Linux-Entwicklungsumgebung bevorzugst. Speichere das Projekt im
Linux-Dateisystem (`~/code/my-app`), damit Installationen und Dateibeobachtung
schneller sind.

Weiter geht es mit dem [Schnellstart](/docs/getting-started/quickstart/)
oder dem [Leitfaden zu Datenbankbefehlen](/docs/cli/database/).
