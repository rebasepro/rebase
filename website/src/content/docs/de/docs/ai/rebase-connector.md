---
sourceHash: 94bd49dce72c5651
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, in der Rebase Cloud oder selbst gehostet – fügen Sie ihn einmal in Claude hinzu, melden Sie sich mit Ihrem Rebase-Konto an und lesen, deployen und ändern Sie Ihre Projekte mit denselben Zugriffsrechten wie in der Konsole, wobei jede Änderung zuerst bestätigt wird.
---

Der Rebase-Connector ist ein einzelner MCP-Server für jedes Rebase-Projekt, das Sie betreiben: in der Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmal in Claude hinzu, melden sich mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte einsehen, deren Logs lesen, sie deployen und zurückrollen (Rollback), Umgebungsvariablen setzen sowie Daten lesen und ändern. Er funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit den Zugriffsrechten, die Ihr Konto in der Konsole hat: die Projekte der Organisationen, denen Sie angehören, die Rolle, die Sie in der jeweiligen Organisation innehaben, und der Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Rebase-Freigabebildschirm (Consent Screen). Wenn Sie im selben Browser in der Konsole angemeldet sind, wird Ihnen dieses Konto vorgeschlagen: Klicken Sie auf **Allow**. Andernfalls melden Sie sich dort an. Der Bildschirm listet auf, welche Berechtigungen Sie erteilen; Sie können die Verbindung später erneut herstellen, um weniger Berechtigungen zu gewähren.

Ihre Rebase-Cloud-Projekte sind bereits vorhanden. Das ist schon die gesamte Einrichtung dafür.

## Selbst gehostete Instanzen hinzufügen

Führen Sie dies einmalig für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dies fügt die Instanz Ihrem Rebase-Konto hinzu und gibt zwei Variablen aus. Setzen Sie diese auf diesem Server und starten Sie ihn neu; der Befehl wartet, bis der Server antwortet, und meldet dann, dass er verbunden ist. Innerhalb des Projektordners bietet er an, diese für Sie in die `.env`-Datei zu schreiben.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie können sie auf dieselbe Weise ansprechen: „Zeige mir die Bestellungen auf admin.example.com“. Bei einer selbst gehosteten Instanz liest und ändert der Connector Daten, liest deren Schema und führt Cron-Jobs aus. Deployments, Umgebungsvariablen und Logs verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder neuer**, erreichbar über HTTPS unter einer öffentlichen Adresse. Rebase Cloud ruft ihn auf, daher kann ein Server, der sich nur in einem privaten Netzwerk befindet, nicht verbunden werden.
- **Die Variablen enthalten kein Geheimnis.** Der Schlüssel ist der öffentliche Schlüssel von Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Tokens, die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das, was auch Studio gewähren würde: Daten (unter Berücksichtigung der Row-Level Security) und Cron-Jobs.
- **Aufrufe laufen über Rebase Cloud.** Claude kommuniziert mit dem Connector und der Connector mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/), ohne etwas dazwischen.
- **Um eine Verbindung zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com` aus oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Rolle „Owner“ oder „Admin“ der Organisation, genau wie der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list` zeigt die von Ihnen hinzugefügten Instanzen an.

## Was Claude damit tun kann

Dreizehn Tools. Die ersten neun sind rein lesend:

| Tool | Funktion |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre jeweilige Rolle auf |
| `project_status` | Status eines Projekts und dessen neuestes Deployment; optional dessen letzte Deployments, die **Namen** seiner Umgebungsvariablen und seine Cron-Jobs |
| `logs` | Die Ausgabe der laufenden App, das Build-Log eines Deployments oder die Ausführungen eines Cron-Jobs |
| `schema` | Die Tabellen eines Projekts oder die Spalten, Relationen und Sicherheitsregeln einer einzelnen Tabelle |
| `query` | Liest Zeilen: eine anhand der ID, eine gefilterte Seite oder eine Anzahl (Count) |
| `show_table` | Öffnet eine Tabelle in der Ansicht Ihres eigenen Admin-Panels direkt in der Konversation: eine Tabelle, Liste, Karten oder ein Kanban-Board, das Sie durchsuchen, filtern und paginieren können, wobei ein Klick auf eine Zeile deren Formular öffnet |
| `show_record` | Öffnet das Formular einer Zeile oder ein Formular für eine neue Zeile, die Claude ausgefüllt hat, damit Sie diese prüfen und speichern können |
| `show_app` | Erstellt eine kleine App für die jeweilige Aufgabe, z. B. eine Triage-Queue oder ein Dashboard, und führt sie mit Ihren Daten in der Konversation aus. Sie kann die Ansichten und Formulare Ihres Admin-Panels nutzen und fragt Sie um Erlaubnis, bevor sie Änderungen vornimmt |
| `show_app_guide` | Anleitung zum Schreiben des Codes für `show_app`: die Hooks, Komponenten und Props, die eine App verwenden darf, inklusive eines Beispiels. Claude liest dies, bevor eine App erstellt wird |

Die anderen vier ändern Daten oder Konfigurationen in der Produktion und fragen jedes Mal vorher nach:

| Tool | Funktion |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (Benutzer inbegriffen: sie sind Zeilen Ihrer users-Tabelle) |
| `deploy` | Deployt einen Git-Branch, führt ein Rollback auf ein früheres Deployment durch oder bricht ein laufendes Deployment ab |
| `env` | Setzt oder entfernt Umgebungsvariablen; Änderungen werden beim nächsten Deployment wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet ihn ein bzw. aus |

Das Deployen von Code von Ihrem lokalen Rechner aus verbleibt bei der CLI (`rebase cloud deploy`) und dem [lokalen MCP-Server](/docs/ai/mcp/), der auch die lokale Entwicklung, Schemagenerierung und Datenbank-Branches abdeckt.

## Skills

Der Connector stellt außerdem die 24 [Rebase-Agent-Skills](/docs/ai/skills/) bereit – dieselben, die `rebase skills install` in ein Projekt kopiert. Claude lädt einen Skill, wenn die Aufgabe es erfordert: wie man eine Tabelle definiert, einen Hook schreibt, Authentifizierung einrichtet, deployt. Es muss nichts installiert werden. Claude Code listet sie als `<connector>:rebase-tables` usw. unter dem Namen auf, den Sie dem Connector gegeben haben. Skills über MCP erfordern einen Client mit der Protokollversion 2026-07-28 oder neuer und befinden sich in Claude Code in der Public Beta.

## Jede Änderung wird bestätigt

Ein Tool, das etwas ändert, benötigt zwei Aufrufe. Der erste Aufruf ändert nichts: Er antwortet mit einem Plan, wie etwa „Roll shop back to deployment d_81f2“, und einem Bestätigungstoken. Claude zeigt Ihnen den Plan und ruft das Tool nur dann erneut mit dem Token auf, wenn Sie zustimmen. Das Token ist fünf Minuten lang gültig, genau einmal, und ausschließlich für die Argumente, für die es erstellt wurde: Weicht irgendetwas ab, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor es eines dieser vier Tools aufruft, da sie als destruktiv markiert sind. In den Ansichten wird beim Speichern eines Formulars der Plan angezeigt und darauf gewartet, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt lediglich deren Länge an, und `project_status` listet nur die Namen auf. Ein Wert, den Sie setzen, wird jedoch über die Konversation übermittelt.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: Alles, was die Konsole Ihnen erlaubt. Ein Mitglied einer Organisation kann Status und Logs einsehen sowie – wie in der Konsole – deployen und Variablen setzen.
- **Daten, Schemas und Cron-Jobs**: Alles, was Studio in der Konsole Ihnen erlaubt. Dies gilt für Owner oder Admins der Organisation bei einem Projekt, für das der Studio-Zugriff aktiviert ist, oder bei einer selbst gehosteten Instanz, die von der Organisation verbunden wurde. Aufrufe werden innerhalb des Projekts unter Berücksichtigung der Row-Level Security mit der Admin-Rolle ausgeführt, die auch Studio besitzt. Wird der Studio-Zugriff für ein Projekt deaktiviert, wird dies ebenfalls deaktiviert.
- **Was Sie gewährt haben.** Sie können dem Connector weniger Rechte einräumen, als Ihr Konto besitzt: nur lesenden Zugriff oder nur ein einzelnes Projekt. Er fordert niemals Backups, Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen an.

Ein Projekt kann über den Connector auf seine Daten zugreifen, sobald darauf eine Runtime läuft, die die Aufrufe des Connectors unterstützt. Bis zum nächsten Deployment oder Plattform-Rollout weisen diese Tools darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Sein Zugriffstoken verliert innerhalb einer Stunde seine Gültigkeit. Wenn Sie Ihr Rebase-Konto löschen oder sich überall abmelden, wird er beim nächsten Aufruf gestoppt.

Der Connector ist für diejenigen gedacht, die auf Rebase entwickeln. Um den Personen, die Ihre App **nutzen**, zu ermöglichen, Claude im eigenen Namen damit zu verbinden, stellen Sie den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
