---
sourceHash: 8857009d4684b08b
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, auf Rebase Cloud oder selbst gehostet – fügen Sie ihn einmal in Claude hinzu, melden Sie sich mit Ihrem Rebase-Konto an und lesen, deployen und ändern Sie Ihre Projekte mit denselben Zugriffsrechten wie in der Konsole, wobei jede Änderung zuerst bestätigt wird.
---

Der Rebase-Connector ist ein einzelner MCP-Server für jedes Rebase-Projekt, das Sie betreiben: auf Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmal in Claude hinzu, melden sich mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte einsehen, deren Logs lesen, Deployments durchführen und zurückrollen, Umgebungsvariablen setzen sowie Projektdaten lesen und ändern. Er funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit genau den Zugriffsrechten, die Ihr Konto in der Konsole besitzt: die Projekte der Organisationen, denen Sie angehören, die Rolle, die Sie in der jeweiligen Organisation innehaben, und der Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Zustimmungsbildschirm von Rebase. Wenn Sie im selben Browser bei der Konsole angemeldet sind, wird dieses Konto vorgeschlagen: Klicken Sie auf **Allow**. Andernfalls melden Sie sich dort an. Der Bildschirm listet auf, welche Berechtigungen Sie gewähren; Sie können die Verbindung später erneut herstellen, um weniger Rechte zu gewähren.

Ihre Rebase-Cloud-Projekte sind bereits vorhanden. Das ist schon die gesamte Einrichtung für diese.

## Selbst gehostete Instanzen hinzufügen

Führen Sie dies einmalig für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dadurch wird die Instanz zu Ihrem Rebase-Konto hinzugefügt und es werden zwei Variablen ausgegeben. Setzen Sie diese auf dem Server und starten Sie ihn neu; der Befehl wartet, bis der Server antwortet, und meldet dann, dass er verbunden ist. Innerhalb des Projektordners bietet der Befehl an, diese für Sie in `.env` einzutragen.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie können sie auf dieselbe Weise benennen: „Zeige mir die Bestellungen auf admin.example.com“. Bei einer selbst gehosteten Instanz liest und ändert der Connector Daten, liest deren Schema und führt deren Cron-Jobs aus. Deployments, Umgebungsvariablen und Logs verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder neuer**, erreichbar über HTTPS unter einer öffentlichen Adresse. Rebase Cloud ruft ihn auf, daher kann ein Server, der sich nur in einem privaten Netzwerk befindet, nicht verbunden werden.
- **Die Variablen enthalten kein Geheimnis.** Der Schlüssel ist der öffentliche Schlüssel von Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Token, die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das, was Studio gewähren würde: Daten, unter Berücksichtigung der Row-Level-Security, und Cron.
- **Aufrufe laufen über Rebase Cloud.** Claude kommuniziert mit dem Connector und der Connector mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) ohne Zwischeninstanz.
- **Um eine Instanz zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com` aus oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Rolle des Eigentümers (Owner) oder Administrators der Organisation, genau wie der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list` zeigt die von Ihnen hinzugefügten Instanzen an.

## Was Claude damit tun kann

Dreizehn Tools. Die ersten neun haben reinen Lesezugriff:

| Tool | Was es tut |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre Rolle in jedem auf |
| `project_status` | Status und neuestes Deployment eines Projekts; optional die letzten Deployments, die **Namen** der Umgebungsvariablen, dessen Cron-Jobs |
| `logs` | Die Ausgabe der laufenden App, das Build-Log eines Deployments oder die Ausführungen eines Cron-Jobs |
| `schema` | Die Collections eines Projekts oder die Felder einer bestimmten Collection |
| `query` | Liest Datensätze: einen per ID, eine gefilterte Seite oder eine Anzahl (Count) |
| `show_collection` | Öffnet eine Collection in der Ansicht Ihres eigenen Admin-Panels direkt in der Konversation: eine Tabelle, Liste, Karten oder ein Kanban-Board, das Sie durchsuchen, filtern und durchblättern können, wobei ein Klick auf eine Zeile das zugehörige Formular öffnet |
| `show_record` | Öffnet das Formular einer Zeile oder ein Formular für eine neue, von Claude ausgefüllte Zeile, die Sie überprüfen und speichern können |
| `show_app` | Erstellt eine kleine Anwendung für die anstehende Aufgabe, wie eine Triage-Warteschlange oder ein Dashboard, und führt sie mit Ihren Daten direkt in der Konversation aus. Sie kann die Ansichten und Formulare Ihres Admin-Panels nutzen und fragt vor jeder Änderung nach |
| `show_app_guide` | Wie der Code für `show_app` geschrieben wird: die Hooks, Komponenten und Props, die eine App verwenden darf, mit einem Beispiel. Claude liest ihn, bevor es eine App erstellt |

Die anderen vier verändern die Produktivumgebung, und jede einzelne fragt vorher nach:

| Tool | Was es tut |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (Benutzer inbegriffen: sie sind Zeilen Ihrer users-Collection) |
| `deploy` | Bereitstellung eines Git-Branches, Rollback auf ein früheres Deployment oder Abbruch eines laufenden Deployments |
| `env` | Setzt oder entfernt Umgebungsvariablen; Änderungen werden beim nächsten Deployment wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet einen ein bzw. aus |

Das Bereitstellen von Code von Ihrem lokalen Rechner aus verbleibt bei der CLI (`rebase cloud deploy`) und dem [lokalen MCP-Server](/docs/ai/mcp/), der auch die lokale Entwicklung, Schema-Generierung und Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das etwas verändert, benötigt zwei Aufrufe. Der erste ändert nichts: Er gibt einen Plan zurück, wie etwa „Roll shop back to deployment d_81f2“, sowie ein Bestätigungstoken. Claude zeigt Ihnen den Plan und führt den Aufruf mit dem Token nur dann erneut aus, wenn Sie zustimmen. Das Token ist fünf Minuten lang gültig, genau einmal, und ausschließlich für exakt jene Argumente, für die es erstellt wurde: Weicht irgendetwas ab, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor es eines dieser vier Tools aufruft, da sie als destruktiv markiert sind. In den Ansichten zeigt das Speichern eines Formulars den Plan an und wartet darauf, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt lediglich deren Länge an, und `project_status` listet nur die Namen auf. Ein von Ihnen gesetzter Wert wird jedoch über die Konversation übermittelt.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: Was Ihnen die Konsole erlaubt. Ein Mitglied einer Organisation kann den Status und die Logs einsehen sowie – wie in der Konsole – Deployments durchführen und Variablen setzen.
- **Daten, Schemas und Cron-Jobs**: Was Ihnen Studio in der Konsole erlaubt. Das betrifft Eigentümer oder Administratoren der Organisation bei einem Projekt, für das der Studio-Zugriff aktiviert ist, oder bei einer selbst gehosteten Instanz, die von der Organisation verbunden wurde. Die Aufrufe erfolgen innerhalb des Projekts unter Berücksichtigung der Row-Level-Security mit der Admin-Rolle, die Studio innehat. Wird der Studio-Zugriff für ein Projekt deaktiviert, wird dies ebenfalls deaktiviert.
- **Was Sie gewährt haben.** Sie können dem Connector weniger Rechte einräumen, als Ihr Konto besitzt: nur Lesezugriff oder nur ein einzelnes Projekt. Er fragt niemals nach Backups, Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen.

Ein Projekt kann über den Connector auf seine Daten zugreifen, sobald darauf eine Runtime läuft, die die Aufrufe des Connectors entgegennimmt. Bis zum nächsten Deployment oder Plattform-Rollout weisen diese Tools darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Dessen Zugriffstoken verliert innerhalb einer Stunde seine Gültigkeit. Wenn Sie Ihr Rebase-Konto löschen oder sich überall abmelden, wird er beim nächsten Aufruf gestoppt.

Der Connector richtet sich an diejenigen, die auf Rebase entwickeln. Damit Personen, die Ihre App **nutzen**, Claude in ihrem eigenen Namen damit verbinden können, stellen Sie den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
