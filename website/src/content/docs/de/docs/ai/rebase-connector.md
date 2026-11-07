---
sourceHash: 52757f5185d7d81b
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, auf Rebase Cloud oder selbst gehostet – fügen Sie ihn einmal in Claude hinzu, melden Sie sich mit Ihrem Rebase-Konto an und lesen, deployen und ändern Sie Ihre Projekte mit den Berechtigungen, die Sie in der Konsole haben, wobei jede Änderung zuvor bestätigt wird.
---

Der Rebase-Connector ist ein MCP-Server für jedes Rebase-Projekt, das Sie betreiben: auf Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmal in Claude hinzu, melden sich mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte sehen, deren Logs lesen, sie deployen und zurückrollen, deren Umgebungsvariablen setzen sowie deren Daten lesen und ändern. Er funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit den Zugriffsrechten, die Ihr Konto in der Konsole hat: den Projekten der Organisationen, denen Sie angehören, der Rolle, die Sie in jeder innehaben, und dem Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Zustimmungsbildschirm von Rebase. Wenn Sie im selben Browser bei der Konsole angemeldet sind, wird Ihnen dieses Konto angeboten: Klicken Sie auf **Allow**. Melden Sie sich andernfalls dort an. Der Bildschirm listet auf, was Sie gewähren; Sie können die Verbindung später erneut herstellen, um weniger Rechte zu gewähren.

Ihre Rebase Cloud-Projekte sind bereits vorhanden. Das ist die gesamte Einrichtung für diese.

## Ihre selbst gehosteten Instanzen hinzufügen

Führen Sie dies einmal für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dadurch wird die Instanz zu Ihrem Rebase-Konto hinzugefügt und es werden zwei Variablen ausgegeben. Setzen Sie diese auf dem Server und starten Sie ihn neu; der Befehl wartet, bis der Server antwortet, und meldet dann, dass er verbunden ist. Innerhalb des Projektordners bietet er an, diese für Sie in `.env` zu schreiben.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie benennen sie auf dieselbe Weise: „zeige mir die Bestellungen auf admin.example.com“. Bei einer selbst gehosteten Instanz liest und ändert der Connector Daten, liest deren Schema und führt deren Cron-Jobs aus. Deployments, Umgebungsvariablen und Logs verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder höher**, erreichbar über HTTPS unter einer öffentlichen Adresse. Rebase Cloud ruft ihn auf, daher kann ein Server, der sich nur in einem privaten Netzwerk befindet, nicht verbunden werden.
- **Die Variablen enthalten kein Geheimnis.** Der Schlüssel ist der öffentliche Schlüssel von Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Tokens, die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das, was Studio gewähren würde: Daten, unter Berücksichtigung seiner Row-Level Security, und Cron.
- **Aufrufe laufen über Rebase Cloud.** Claude spricht mit dem Connector und der Connector mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/), ohne etwas dazwischen.
- **Um eine Instanz zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com` aus oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Owner- oder Admin-Rolle der Organisation, genau wie der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list` zeigt die von Ihnen hinzugefügten Instanzen an.

## Was Claude damit tun kann

Zwölf Tools. Die ersten acht sind rein lesend:

| Tool | Was es tut |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre Rolle in jedem auf |
| `project_status` | Status und neuestes Deployment eines Projekts; optional seine letzten Deployments, die **Namen** seiner Umgebungsvariablen, seine Cron-Jobs |
| `logs` | Die Ausgabe der laufenden App, das Build-Log eines Deployments oder die Ausführungen eines Cron-Jobs |
| `schema` | Die Collections eines Projekts oder die Felder einer Collection |
| `query` | Liest Zeilen: eine nach ID, eine gefilterte Seite oder eine Anzahl |
| `show_collection` | Öffnet eine Collection in der Ansicht Ihres eigenen Admin-Panels, direkt in der Konversation: eine Tabelle, Liste, Karten oder ein Kanban-Board, das Sie durchsuchen, filtern und paginieren können, wobei eine Zeile ihr Formular öffnet |
| `show_record` | Öffnet das Formular einer Zeile oder ein Formular für eine neue Zeile, die Claude ausgefüllt hat, damit Sie sie überprüfen und speichern können |
| `show_app` | Öffnet einen kleinen Bildschirm für die jeweilige Aufgabe: Collection-Ansichten, Formulare und Zähler, wobei eine Ansicht der in einer anderen ausgewählten Zeile folgen kann |

Die anderen vier ändern die Produktivumgebung, und jede davon fragt vorher nach:

| Tool | Was es tut |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (einschließlich Benutzer: sie sind Zeilen Ihrer users-Collection) |
| `deploy` | Deployt einen Git-Branch, rollt auf ein früheres Deployment zurück oder bricht ein laufendes ab |
| `env` | Setzt oder entfernt Umgebungsvariablen; eine Änderung wird beim nächsten Deploy wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet einen ein oder aus |

Das Deployen von Code von Ihrem Rechner aus bleibt der CLI (`rebase cloud deploy`) und dem [lokalen MCP-Server](/docs/ai/mcp/) vorbehalten, der auch die lokale Entwicklung, Schema-Generierung und Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das etwas ändert, erfordert zwei Aufrufe. Der erste ändert nichts: Er antwortet mit einem Plan, wie z. B. „Roll shop back to deployment d_81f2“, und einem Bestätigungs-Token. Claude zeigt Ihnen den Plan und ruft das Tool nur dann erneut mit dem Token auf, wenn Sie zustimmen. Das Token ist fünf Minuten lang gültig, genau einmal, für exakt die Argumente, für die es erstellt wurde: Wenn irgendetwas abweicht, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor es eines dieser vier Tools aufruft, da sie als destruktiv markiert sind. In den Ansichten zeigt das Speichern eines Formulars den Plan an und wartet darauf, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt deren Länge an, und `project_status` listet nur Namen auf. Ein von Ihnen festgelegter Wert durchläuft jedoch die Konversation.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: was die Konsole Ihnen erlaubt. Ein Mitglied einer Organisation kann Status und Logs lesen und, wie in der Konsole, deployen und Variablen setzen.
- **Daten, Schemas und Cron-Jobs**: was Studio in der Konsole Ihnen erlaubt. Das ist ein Owner oder Admin der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist, oder bei einer selbst gehosteten Instanz, die die Organisation verbunden hat. Aufrufe laufen innerhalb des Projekts unter dessen Row-Level Security mit der Admin-Rolle, die Studio hat. Das Deaktivieren des Studio-Zugriffs für ein Projekt deaktiviert dies ebenfalls.
- **Was Sie gewährt haben.** Sie können dem Connector weniger gewähren, als Ihr Konto besitzt: nur Lesezugriff oder nur ein einzelnes Projekt. Er fragt niemals nach Backups, Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen.

Ein Projekt erreicht seine Daten über den Connector, sobald es eine Runtime ausführt, die die Aufrufe des Connectors entgegennimmt. Bis zum nächsten Deployment oder Plattform-Rollout weisen diese Tools darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Sein Zugriffs-Token wird innerhalb einer Stunde ungültig. Das Löschen Ihres Rebase-Kontos oder das Abmelden auf allen Geräten stoppt ihn beim nächsten Aufruf.

Der Connector ist für Personen gedacht, die auf Rebase entwickeln. Damit die Personen, die Ihre App **nutzen**, Claude als sie selbst damit verbinden können, stellen Sie den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
