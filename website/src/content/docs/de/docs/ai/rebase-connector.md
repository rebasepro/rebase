---
sourceHash: f5fcf560853b0193
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, auf Rebase Cloud oder selbst gehostet – einmal in Claude hinzufügen, mit Ihrem Rebase-Konto anmelden und Ihre Projekte mit den Berechtigungen lesen, deployen und ändern, die Sie in der Konsole haben, wobei jede Änderung zuerst bestätigt werden muss.
---

Der Rebase-Connector ist ein MCP-Server für jedes Rebase-Projekt, das Sie betreiben: auf
Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmal in Claude hinzu, melden sich
mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte sehen, deren Logs lesen, sie deployen
und per Rollback zurücksetzen, Umgebungsvariablen setzen sowie Daten lesen und ändern. Er
funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit den Zugriffsrechten, die Ihr Konto in der Konsole hat: die
Projekte der Organisationen, denen Sie angehören, die Rolle, die Sie in jeder davon innehaben,
und der Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Rebase-Zustimmungsdialog. Wenn Sie im selben Browser bei der Konsole
angemeldet sind, wird dieses Konto vorgeschlagen: Klicken Sie auf **Allow**. Andernfalls
melden Sie sich dort an. Der Bildschirm listet auf, welche Berechtigungen Sie erteilen; Sie
können die Verbindung später erneut herstellen, um weniger Rechte zu gewähren.

Ihre Rebase Cloud-Projekte sind bereits vorhanden. Das ist die gesamte Einrichtung für diese.

## Selbst gehostete Instanzen hinzufügen

Führen Sie dies einmal für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dadurch wird die Instanz Ihrem Rebase-Konto hinzugefügt und es werden zwei Variablen ausgegeben.
Setzen Sie diese auf diesem Server und starten Sie ihn neu; der Befehl wartet, bis der Server
antwortet, und meldet dann, dass er verbunden ist. Innerhalb des Projektordners bietet er an,
sie für Sie in die `.env`-Datei zu schreiben.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie können sie genauso
ansprechen: „Zeige mir die Bestellungen auf admin.example.com“. Auf einer selbst gehosteten Instanz
liest und ändert der Connector Daten, liest deren Schema und führt Cron-Jobs aus. Deployments,
Umgebungsvariablen und Logs verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder neuer**, erreichbar über HTTPS unter einer öffentlichen
  Adresse. Rebase Cloud ruft ihn auf, daher kann ein Server, der sich nur in einem privaten Netzwerk
  befindet, nicht verbunden werden.
- **Die Variablen enthalten kein Geheimnis.** Der Schlüssel ist der öffentliche Schlüssel von
  Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Tokens,
  die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das,
  was auch Studio gewähren würde: Daten (unter Berücksichtigung von Row-Level Security) und Cron.
- **Aufrufe laufen über Rebase Cloud.** Claude kommuniziert mit dem Connector und der Connector
  mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen
  [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/), ohne etwas dazwischen.
- **Um eine Instanz zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com` aus
  oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Rolle „Owner“ oder „Admin“ der Organisation, genau wie
der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list` zeigt die von Ihnen
hinzugefügten Instanzen an.

## Was Claude damit tun kann

Zehn Tools. Die ersten sechs lesen nur:

| Tool | Funktion |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre Rolle in jedem auf |
| `project_status` | Status und neuestes Deployment eines Projekts; optional die letzten Deployments, die **Namen** der Umgebungsvariablen, die Cron-Jobs |
| `logs` | Ausgabe der laufenden App, Build-Log eines Deployments oder Ausführungen eines Cron-Jobs |
| `schema` | Collections eines Projekts oder Felder einer Collection |
| `query` | Liest Zeilen: eine anhand der ID, eine gefilterte Seite oder eine Anzahl |
| `show_collection` | Zeigt Zeilen als Tabelle in der Konversation an, in der Sie blättern und Zellen bearbeiten können |

Die anderen vier ändern die Produktivumgebung, und jedes davon fragt vorher nach:

| Tool | Funktion |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (einschließlich Benutzer: sie sind Zeilen Ihrer users-Collection) |
| `deploy` | Bereitstellen eines Git-Branchs, Rollback zu einem früheren Deployment oder Abbrechen eines laufenden Deployments |
| `env` | Setzt oder entfernt Umgebungsvariablen; eine Änderung wird beim nächsten Deployment wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet einen ein oder aus |

Das Deployen von Code von Ihrem Rechner aus bleibt der CLI (`rebase cloud deploy`) und dem
[lokalen MCP-Server](/docs/ai/mcp/) vorbehalten, der auch die lokale Entwicklung,
Schema-Generierung und Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das etwas ändert, benötigt zwei Aufrufe. Der erste ändert nichts: Er liefert einen Plan
zurück, wie etwa „Roll shop back to deployment d_81f2“, sowie ein Bestätigungstoken. Claude zeigt
Ihnen den Plan und führt den Aufruf mit dem Token nur dann erneut aus, wenn Sie zustimmen. Das
Token ist fünf Minuten lang gültig, einmalig und genau für die Argumente, für die es erstellt
wurde: Weicht irgendetwas ab, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor eines dieser vier Tools aufgerufen wird, da sie
als destruktiv markiert sind. In der Tabellenansicht zeigt eine bearbeitete Zelle den Plan an und
wartet darauf, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt nur deren Länge an,
und `project_status` listet lediglich die Namen auf. Ein von Ihnen gesetzter Wert wird jedoch
durch die Konversation übertragen.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: Was die Konsole Ihnen erlaubt. Ein Mitglied einer Organisation
  kann Status und Logs einsehen sowie – wie in der Konsole – Deployments durchführen und Variablen
  setzen.
- **Daten, Schemas und Cron-Jobs**: Was Studio in der Konsole Ihnen erlaubt. Das betrifft Owner
  oder Admins der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist, oder bei einer
  selbst gehosteten Instanz, die die Organisation verbunden hat. Aufrufe werden innerhalb des
  Projekts unter dessen Row-Level Security mit der Admin-Rolle ausgeführt, die auch Studio besitzt.
  Wird der Studio-Zugriff für ein Projekt deaktiviert, wird dies ebenfalls deaktiviert.
- **Was Sie gewährt haben.** Sie können dem Connector weniger Rechte einräumen, als Ihr Konto
  besitzt: nur lesenden Zugriff oder nur Zugriff auf ein einzelnes Projekt. Er fragt niemals nach
  Backups, Wiederherstellungen, Datenbank-Zugangsdaten oder Projekteinstellungen.

Ein Projekt greift über den Connector auf seine Daten zu, sobald eine Laufzeitumgebung ausgeführt
wird, die die Aufrufe des Connectors entgegennimmt. Bis zum nächsten Deployment oder
Plattform-Rollout weisen diese Tools darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Das Zugriffstoken verliert innerhalb
einer Stunde seine Gültigkeit. Wenn Sie Ihr Rebase-Konto löschen oder sich überall abmelden, wird
er beim nächsten Aufruf gestoppt.

Der Connector ist für Personen gedacht, die mit Rebase entwickeln. Damit Personen, die Ihre
App **nutzen**, Claude in ihrem eigenen Namen damit verbinden können, stellen Sie den
[Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
