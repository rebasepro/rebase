---
sourceHash: e1c04397c988a38d
title: Claude mit Rebase Cloud verbinden
sidebar_label: Rebase-Cloud-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Cloud-Projekte — einmal in Claude hinzufügen, mit Ihrem Rebase-Konto anmelden und Ihre Projekte mit dem Zugriff lesen, deployen und ändern, den Sie in der Konsole haben; jede Änderung wird zuerst bestätigt.
---

Der Rebase-Connector ist ein einziger MCP-Server für alles, was Sie auf Rebase
Cloud betreiben. Sie fügen ihn einmal in Claude hinzu, melden sich mit Ihrem
Rebase-Konto an, und Claude kann Ihre Projekte sehen, ihre Logs lesen, sie
deployen und zurückrollen, ihre Umgebungsvariablen setzen und ihre Daten lesen
und ändern. Er funktioniert in Claude im Web, in der Desktop-App und auf dem
Smartphone.

Er handelt als **Sie**, mit dem Zugriff, den Ihr Konto in der Konsole hat: die
Projekte der Organisationen, denen Sie angehören, die Rolle, die Sie in jeder
haben, und der Datenzugriff, den Ihnen das Studio der Konsole gibt. Er hält
keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Einstellungen → Connectors → Benutzerdefinierten
Connector hinzufügen** und geben Sie ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Zustimmungsbildschirm von Rebase. Sind Sie im selben Browser
in der Konsole angemeldet, bietet er dieses Konto an: Drücken Sie **Zulassen**.
Andernfalls melden Sie sich dort an. Der Bildschirm listet auf, was Sie
gewähren; Sie können sich später erneut verbinden, um weniger zu gewähren.

## Was Claude damit tun kann

<span class="since-badge" data-since="0.28">Since 0.28</span>

Zehn Tools. Die ersten sechs lesen nur:

| Tool | Was es tut |
|---|---|
| `projects` | Listet Ihre Projekte, ihren Status und Ihre Rolle in jedem |
| `project_status` | Status und neuestes Deployment eines Projekts; optional seine letzten Deployments, die **Namen** seiner Umgebungsvariablen, seine Cronjobs |
| `logs` | Die Ausgabe der laufenden App, das Build-Log eines Deployments oder die Läufe eines Cronjobs |
| `schema` | Die Collections eines Projekts oder die Felder einer Collection |
| `query` | Liest Zeilen: eine per ID, eine gefilterte Seite oder eine Anzahl |
| `show_collection` | Zeigt Zeilen als Tabelle im Gespräch, in der Sie blättern und Zellen bearbeiten können |

Die anderen vier ändern die Produktion, und jedes fragt zuerst:

| Tool | Was es tut |
|---|---|
| `write` | Erstellt, ändert oder löscht eine Zeile (auch Benutzer: Sie sind Zeilen Ihrer Users-Collection) |
| `deploy` | Deployt einen Git-Branch, rollt auf ein früheres Deployment zurück oder bricht ein laufendes ab |
| `env` | Setzt oder entfernt Umgebungsvariablen; eine Änderung gilt ab dem nächsten Deploy |
| `cron` | Führt einen Cronjob sofort aus oder schaltet einen ein oder aus |

Code von Ihrem Rechner zu deployen bleibt Sache der CLI (`rebase cloud deploy`)
und des [lokalen MCP-Servers](/docs/ai/mcp/), der auch die lokale Entwicklung,
die Schema-Generierung und Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das etwas ändert, braucht zwei Aufrufe. Der erste ändert nichts: Er
antwortet mit einem Plan, etwa „Rolle shop auf das Deployment d_81f2 zurück“,
und einem Bestätigungstoken. Claude zeigt Ihnen den Plan und ruft nur dann mit
dem Token erneut auf, wenn Sie zustimmen. Das Token gilt fünf Minuten, einmal,
für genau die Argumente, für die es erstellt wurde: Weicht etwas ab, läuft
nichts.

Claude fragt außerdem um Ihre Erlaubnis, bevor es eines dieser vier Tools
aufruft, weil sie als destruktiv gekennzeichnet sind. In der Tabellenansicht
zeigt eine bearbeitete Zelle den Plan und wartet, bis Sie **Speichern**
drücken.

Werte von Umgebungsvariablen werden nie zurückgezeigt: Ein Plan zeigt ihre
Länge, und `project_status` listet nur Namen. Ein Wert, den Sie setzen, geht
allerdings durch das Gespräch.

## Was er erreicht

- **Projekte und Cloud-Operationen**: was die Konsole Ihnen erlaubt. Ein
  Mitglied einer Organisation kann Status und Logs lesen und, wie in der
  Konsole, deployen und Variablen setzen.
- **Daten, Schemas und Cronjobs**: was Studio in der Konsole Ihnen erlaubt. Das
  ist ein Owner oder Admin der Organisation, bei einem Projekt, dessen
  Studio-Zugriff eingeschaltet ist. Die Aufrufe laufen innerhalb des Projekts,
  unter seiner Row-Level-Security, mit der Admin-Rolle, die Studio hat. Schalten
  Sie den Studio-Zugriff für ein Projekt aus, ist auch dies aus.
- **Was Sie gewährt haben.** Sie können dem Connector weniger gewähren, als Ihr
  Konto hat: nur Lesen oder nur ein Projekt. Er fragt nie nach Backups,
  Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen.

Ein Projekt erreicht seine Daten über den Connector, sobald es eine Runtime
ausführt, die die Aufrufe des Connectors annimmt. Bis zu seinem nächsten
Deploy oder Plattform-Rollout sagen die betreffenden Tools das.

## Trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Sein
Zugriffstoken funktioniert innerhalb einer Stunde nicht mehr. Löschen Sie Ihr
Rebase-Konto oder melden Sie sich überall ab, stoppt er beim nächsten Aufruf.

Der Connector ist für die Menschen, die auf Rebase Cloud bauen. Damit die
Menschen, die Ihre App **nutzen**, Claude als sie selbst damit verbinden
können, stellen Sie den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) aus Ihrem
eigenen Backend bereit.
