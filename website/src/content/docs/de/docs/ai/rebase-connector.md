---
sourceHash: 940a1c3ace06a8c3
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, in der Rebase Cloud oder selbst gehostet – einmalig in Claude hinzufügen, mit Ihrem Rebase-Konto anmelden und Ihre Projekte mit den Berechtigungen der Konsole lesen, bereitstellen und ändern, wobei jede Änderung zuerst bestätigt wird.
---

Der Rebase-Connector ist ein MCP-Server für jedes von Ihnen betriebene Rebase-Projekt: in der Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmalig in Claude hinzu, melden sich mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte einsehen, deren Protokolle lesen, Deployments durchführen und zurücksetzen, deren Umgebungsvariablen setzen sowie Daten lesen und ändern. Er funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit den Zugriffsrechten, die Ihr Konto in der Konsole hat: den Projekten der Organisationen, denen Sie angehören, Ihrer jeweiligen Rolle darin und dem Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Zustimmungsbildschirm von Rebase. Wenn Sie im selben Browser in der Konsole angemeldet sind, wird dieses Konto vorgeschlagen: Klicken Sie auf **Allow**. Andernfalls melden Sie sich dort an. Der Bildschirm listet auf, welche Berechtigungen Sie erteilen; Sie können die Verbindung später erneut herstellen, um weniger Berechtigungen zu gewähren.

Ihre Rebase-Cloud-Projekte sind bereits vorhanden. Das ist die gesamte Einrichtung für diese.

## Selbst gehostete Instanzen hinzufügen

Führen Sie dies einmal für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dadurch wird die Instanz zu Ihrem Rebase-Konto hinzugefügt und es werden zwei Variablen ausgegeben. Setzen Sie diese auf dem Server und starten Sie ihn neu; der Befehl wartet, bis der Server antwortet, und meldet dann, dass er verbunden ist. Innerhalb des Projektordners wird angeboten, diese automatisch in Ihre `.env`-Datei zu schreiben.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie können sie auf dieselbe Weise ansprechen: „Zeige mir die Bestellungen auf admin.example.com“. Bei einer selbst gehosteten Instanz liest und ändert der Connector Daten, liest deren Schema aus und führt Cron-Jobs aus. Bereitstellungen, Umgebungsvariablen und Protokolle verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder neuer** und muss über HTTPS unter einer öffentlichen Adresse erreichbar sein. Rebase Cloud ruft ihn auf; ein Server, der sich ausschließlich in einem privaten Netzwerk befindet, kann daher nicht verbunden werden.
- **Die Variablen enthalten keine Geheimnisse.** Der Schlüssel ist der öffentliche Schlüssel von Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Tokens, die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das, was auch Studio tun würde: Daten (unter Berücksichtigung von Row-Level Security) und Cron.
- **Aufrufe laufen über Rebase Cloud.** Claude kommuniziert mit dem Connector und der Connector mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) ohne Vermittler dazwischen.
- **Um eine Instanz zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com` aus oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Rolle des Eigentümers (Owner) oder Administrators der Organisation, genau wie der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list` zeigt die von Ihnen hinzugefügten Instanzen an.

## Was Claude damit tun kann

Dreizehn Tools. Die ersten neun sind rein lesend:

| Tool | Funktion |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre jeweilige Rolle auf |
| `project_status` | Status und neuestes Deployment eines Projekts; optional die letzten Deployments, die **Namen** der Umgebungsvariablen und die Cron-Jobs |
| `logs` | Ausgabe der laufenden App, Build-Protokoll eines Deployments oder Ausführungen eines Cron-Jobs |
| `schema` | Tabellen eines Projekts oder Spalten, Relationen und Sicherheitsregeln einer einzelnen Tabelle |
| `query` | Liest Zeilen: eine Zeile nach ID, eine gefilterte Seite oder eine Anzahl |
| `show_table` | Öffnet eine Tabelle in der Ansicht Ihres eigenen Admin-Panels direkt in der Konversation: eine Tabelle, Liste, Karten oder ein Kanban-Board, das Sie durchsuchen, filtern und durchblättern können, wobei das Anklicken einer Zeile deren Formular öffnet |
| `show_record` | Öffnet das Formular einer Zeile oder ein Formular für eine neue, von Claude ausgefüllte Zeile zur Überprüfung und zum Speichern |
| `show_app` | Erstellt eine kleine Anwendung für die jeweilige Aufgabe (wie eine Triage-Warteschlange oder ein Dashboard) und führt sie mit Ihren Daten innerhalb der Konversation aus. Kann die Ansichten und Formulare Ihres Admin-Panels nutzen und fragt vor jeder Änderung nach |
| `show_app_guide` | Anleitung zum Schreiben von Code für `show_app`: die Hooks, Komponenten und Props, die eine App nutzen kann, inklusive Beispiel. Claude liest dies vor dem Erstellen einer App |

Die anderen vier verändern die Produktionsumgebung und erfordern jeweils eine vorherige Bestätigung:

| Tool | Funktion |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (einschließlich Benutzer: sie sind Zeilen Ihrer Benutzertabelle) |
| `deploy` | Stellt einen Git-Branch bereit, setzt auf ein früheres Deployment zurück oder bricht ein laufendes Deployment ab |
| `env` | Setzt oder entfernt Umgebungsvariablen; Änderungen werden beim nächsten Deployment wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet einen ein bzw. aus |

Das Bereitstellen von Code von Ihrem lokalen Rechner verbleibt bei der CLI (`rebase cloud deploy`) und dem [lokalen MCP-Server](/docs/ai/mcp/), welcher auch die lokale Entwicklung, Schemagenerierung und Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das Änderungen vornimmt, erfordert zwei Aufrufe. Der erste Aufruf ändert nichts: Er liefert einen Plan zurück (z. B. „Roll shop back to deployment d_81f2“) sowie ein Bestätigungstoken. Claude zeigt Ihnen den Plan und führt den zweiten Aufruf mit dem Token nur aus, wenn Sie zustimmen. Das Token ist fünf Minuten lang gültig, genau einmal und exakt für die Argumente, für die es erstellt wurde: Weicht etwas ab, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor eines dieser vier Tools aufgerufen wird, da sie als destruktiv markiert sind. In den Ansichten wird beim Speichern eines Formulars der Plan angezeigt und darauf gewartet, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt lediglich deren Länge an, und `project_status` listet nur die Namen auf. Ein von Ihnen gesetzter Wert wird jedoch über die Konversation übermittelt.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: Was die Konsole Ihnen erlaubt. Ein Mitglied einer Organisation kann Status und Protokolle einsehen sowie, wie in der Konsole, Deployments durchführen und Variablen setzen.
- **Daten, Schemata und Cron-Jobs**: Was Studio in der Konsole Ihnen erlaubt. Dies gilt für Eigentümer oder Administratoren der Organisation, bei Projekten, für die der Studio-Zugriff aktiviert ist, oder bei einer selbst gehosteten Instanz, die von der Organisation verbunden wurde. Aufrufe werden innerhalb des Projekts unter dessen Row-Level Security mit der Admin-Rolle von Studio ausgeführt. Wird der Studio-Zugriff für ein Projekt deaktiviert, wird auch dieser Zugriff deaktiviert.
- **Was Sie gewährt haben.** Sie können dem Connector weniger Rechte einräumen, als Ihr Konto besitzt: nur Lesezugriff oder Zugriff auf nur ein einzelnes Projekt. Er fordert niemals Backups, Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen an.

Ein Projekt kann über den Connector auf seine Daten zugreifen, sobald es auf einer Runtime läuft, die die Aufrufe des Connectors unterstützt. Bis zum nächsten Deployment oder Plattform-Rollout weisen diese Tools darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Sein Zugriffstoken verliert innerhalb einer Stunde seine Gültigkeit. Wenn Sie Ihr Rebase-Konto löschen oder sich überall abmelden, wird er beim nächsten Aufruf gestoppt.

Der Connector richtet sich an Personen, die mit Rebase entwickeln. Damit Personen, die Ihre Anwendung **nutzen**, Claude in ihrem eigenen Namen damit verbinden können, stellen Sie den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
