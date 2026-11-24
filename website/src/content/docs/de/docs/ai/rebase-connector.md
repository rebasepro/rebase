---
sourceHash: ec133aedf22a0316
title: Claude mit Rebase verbinden
sidebar_label: Rebase-Connector
description: Ein MCP-Connector für alle Ihre Rebase-Projekte, auf Rebase Cloud oder selbst gehostet – fügen Sie ihn einmal in Claude hinzu, melden Sie sich mit Ihrem Rebase-Konto an und lesen, deployen und ändern Sie Ihre Projekte mit denselben Zugriffsrechten, die Sie in der Konsole haben, wobei jede Änderung zuerst bestätigt wird.
---

Der Rebase-Connector ist ein MCP-Server für jedes Rebase-Projekt, das Sie betreiben: auf
Rebase Cloud und auf Ihren eigenen Servern. Sie fügen ihn einmal in Claude hinzu, melden sich
mit Ihrem Rebase-Konto an, und Claude kann Ihre Projekte sehen, deren Logs lesen, sie deployen
und zurückrollen, deren Umgebungsvariablen setzen sowie deren Daten lesen und ändern. Er
funktioniert in Claude im Web, in der Desktop-App und auf Mobilgeräten.

Er agiert als **Sie selbst**, mit den Zugriffsrechten, die Ihr Konto in der Konsole hat: die
Projekte der Organisationen, zu denen Sie gehören, die Rolle, die Sie in jeder davon innehaben,
und der Datenzugriff, den Ihnen das Studio der Konsole gewährt. Er besitzt keinen eigenen Schlüssel.

## Hinzufügen

Öffnen Sie in Claude **Settings → Connectors → Add custom connector** und geben Sie Folgendes ein:

```text
https://app.rebase.pro/mcp
```

Claude öffnet den Rebase-Zustimmungsbildschirm. Wenn Sie im selben Browser in der Konsole
angemeldet sind, wird dieses Konto angeboten: Klicken Sie auf **Allow**. Andernfalls melden
Sie sich dort an. Der Bildschirm listet auf, welche Berechtigungen Sie erteilen; Sie können
die Verbindung später erneut herstellen, um weniger Berechtigungen zu gewähren.

Ihre Rebase-Cloud-Projekte sind bereits vorhanden. Das ist die gesamte Einrichtung für diese.

## Selbst gehostete Instanzen hinzufügen

Führen Sie dies einmal für jeden Server aus, den Sie selbst hosten:

```bash
rebase cloud connect https://admin.example.com
```

Dadurch wird die Instanz zu Ihrem Rebase-Konto hinzugefügt und es werden zwei Variablen ausgegeben.
Setzen Sie diese auf dem Server und starten Sie ihn neu; der Befehl wartet, bis der Server antwortet,
und meldet dann, dass er verbunden ist. Innerhalb des Projektordners wird angeboten, sie für Sie
in `.env` zu schreiben.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Von da an listet Claude die Instanz neben Ihren Cloud-Projekten auf, und Sie können sie auf dieselbe
Weise ansprechen: „Zeige mir die Bestellungen auf admin.example.com“. Bei einer selbst gehosteten
Instanz liest und ändert der Connector Daten, liest deren Schema und führt deren Cron-Jobs aus.
Deployments, Umgebungsvariablen und Logs verbleiben auf Ihrem eigenen Server.

- **Der Server benötigt Rebase 0.28.1 oder höher** und muss über HTTPS unter einer öffentlichen
  Adresse erreichbar sein. Da Rebase Cloud ihn aufruft, kann ein Server, der sich nur in einem
  privaten Netzwerk befindet, nicht verbunden werden.
- **Die Variablen enthalten kein Geheimnis.** Der Schlüssel ist der öffentliche Schlüssel von
  Rebase Cloud; die Audience benennt diese Instanz. Damit akzeptiert der Server kurzlebige Tokens,
  die Rebase Cloud ausschließlich für diese Instanz signiert, und gewährt ihnen höchstens das,
  was auch Studio erhalten würde: Daten (gemäß Row-Level Security) und Cron.
- **Aufrufe laufen über Rebase Cloud.** Claude kommuniziert mit dem Connector und der Connector
  mit Ihrem Server. Ein Server, den Sie nie verbinden, behält seinen eigenen
  [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) ohne Zwischeninstanz.
- **Um eine Instanz zu trennen**, führen Sie `rebase cloud connect --remove https://admin.example.com`
  aus oder entfernen Sie die beiden Variablen vom Server.

Das Hinzufügen einer Instanz erfordert die Rolle des Eigentümers (Owner) oder Administrators der
Organisation, genau wie der Zugriff auf die Daten eines Projekts. `rebase cloud connect --list`
zeigt die von Ihnen hinzugefügten Instanzen an.

## Was Claude damit tun kann

Sechzehn Tools. Die ersten zwölf lesen ausschließlich:

| Tool | Funktion |
|---|---|
| `projects` | Listet Ihre Projekte, deren Status und Ihre Rolle in jedem davon auf |
| `project_status` | Status und neuestes Deployment eines Projekts; optional die letzten Deployments, die **Namen** der Umgebungsvariablen und dessen Cron-Jobs |
| `logs` | Die Ausgabe der laufenden App, das Build-Log eines Deployments oder die Ausführungen eines Cron-Jobs |
| `schema` | Die Tabellen eines Projekts oder die Spalten, Relationen und Sicherheitsregeln einer Tabelle |
| `query` | Liest Zeilen: eine anhand der ID, eine gefilterte Seite oder eine Anzahl (Count) |
| `storage_list` | Listet einen Ordner des Dateispeichers eines Projekts seitenweise auf und benennt dessen Speicherquellen sowie den Bucket, den jede davon bedient |
| `storage_head` | Gibt an, ob eine Datei vorhanden ist, sowie deren Größe, Typ und letzte Änderung. Akzeptiert den Schlüssel oder den `s3://bucket/key`-Wert, den eine Zeile speichert |
| `storage_get` | Liest eine Datei: ihren Inhalt bei Text (standardmäßig die ersten 64 KB) oder ihre Größe und ihren Typ bei Binärdaten |
| `show_table` | Öffnet eine Tabelle in der Ansicht Ihres eigenen Admin-Panels innerhalb der Konversation: eine Tabelle, Liste, Karten oder ein Kanban-Board zum Suchen, Filtern und Paginieren, wobei eine Zeile ihr Formular öffnet |
| `show_record` | Öffnet das Formular einer Zeile oder ein Formular für eine neue, von Claude ausgefüllte Zeile, damit Sie sie überprüfen und speichern können |
| `show_app` | Erstellt eine kleine App für die jeweilige Aufgabe, z. B. eine Triage-Warteschlange oder ein Dashboard, und führt sie mit Ihren Daten innerhalb der Konversation aus. Sie kann die Ansichten und Formulare Ihres Admin-Panels nutzen und fragt nach, bevor sie Änderungen vornimmt |
| `show_app_guide` | Anleitung zum Schreiben von Code für `show_app`: die Hooks, Komponenten und Props, die eine App verwenden darf, samt Beispiel. Claude liest dies vor dem Erstellen einer App |

Die anderen vier ändern den Produktivbetrieb, und jedes davon fragt vorher nach:

| Tool | Funktion |
|---|---|
| `write` | Erstellt, aktualisiert oder löscht eine Zeile (einschließlich Benutzern: diese sind Zeilen Ihrer Benutzertabelle) |
| `deploy` | Deployt einen Git-Branch, rollt auf ein früheres Deployment zurück oder bricht ein laufendes Deployment ab |
| `env` | Setzt oder entfernt Umgebungsvariablen; Änderungen werden beim nächsten Deploy wirksam |
| `cron` | Führt einen Cron-Job sofort aus oder schaltet einen ein bzw. aus |

Das Deployen von Code von Ihrem lokalen Rechner verbleibt bei der CLI (`rebase cloud deploy`) und
dem [lokalen MCP-Server](/docs/ai/mcp/), der auch die lokale Entwicklung, Schemagenerierung und
Datenbank-Branches abdeckt.

## Jede Änderung wird bestätigt

Ein Tool, das etwas ändert, benötigt zwei Aufrufe. Der erste ändert nichts: Er liefert einen Plan
zurück, wie etwa „Roll shop back to deployment d_81f2“, sowie ein Bestätigungs-Token. Claude zeigt
Ihnen den Plan und ruft das Tool nur dann erneut mit dem Token auf, wenn Sie zustimmen. Das Token
ist fünf Minuten lang gültig, genau einmal, und ausschließlich für die Argumente, für die es erstellt
wurde: Weicht etwas ab, wird nichts ausgeführt.

Claude bittet Sie außerdem um Erlaubnis, bevor eines dieser vier Tools aufgerufen wird, da sie als
destruktiv markiert sind. In den Ansichten zeigt das Speichern eines Formulars den Plan an und wartet
darauf, dass Sie auf **Save** klicken.

Werte von Umgebungsvariablen werden niemals zurückgegeben: Ein Plan zeigt lediglich deren Länge an,
und `project_status` listet nur die Namen auf. Ein von Ihnen gesetzter Wert wird jedoch über die
Konversation übermittelt.

## Worauf zugegriffen werden kann

- **Projekte und Cloud-Operationen**: Was die Konsole Ihnen erlaubt. Ein Mitglied einer
  Organisation kann Status und Logs lesen und – wie in der Konsole – deployen und Variablen setzen.
- **Daten, Dateien, Schemas und Cron-Jobs**: Was Studio in der Konsole Ihnen erlaubt. Dies gilt für
  Eigentümer oder Admins der Organisation bei einem Projekt, für das der Studio-Zugriff aktiviert ist,
  oder bei einer selbst gehosteten Instanz, die von der Organisation verbunden wurde. Aufrufe werden
  innerhalb des Projekts unter dessen Row-Level Security mit der Admin-Rolle ausgeführt, die auch
  Studio besitzt. Dateien werden über die projekteigenen Speicherquellen (Rebase Storage oder der
  durch die `S3_*`-Variablen konfigurierte Bucket) unter Einhaltung der Speicherregeln gelesen und
  niemals geschrieben oder gelöscht. Das Deaktivieren des Studio-Zugriffs für ein Projekt deaktiviert
  dies ebenfalls.
- **Was Sie gewährt haben.** Sie können dem Connector weniger Berechtigungen erteilen, als Ihr
  Konto besitzt: nur Leserechte oder nur ein einzelnes Projekt. Er fragt niemals nach Backups,
  Wiederherstellungen (Restores), Datenbank-Zugangsdaten oder Projekteinstellungen.

Ein Projekt greift über den Connector auf seine Daten zu, sobald darauf eine Runtime ausgeführt
wird, die die Aufrufe des Connectors entgegennimmt, und auf seine Dateien, sobald diese Runtime
über die Storage-Tools verfügt. Bis zum nächsten Deploy oder Platform-Rollout weisen diese Tools
darauf hin.

## Verbindung trennen

Entfernen Sie den Connector in den Einstellungen von Claude. Dessen Zugriffstoken wird innerhalb
einer Stunde ungültig. Das Löschen Ihres Rebase-Kontos oder das Abmelden auf allen Geräten stoppt
ihn beim nächsten Aufruf.

Der Connector ist für Personen gedacht, die mit Rebase entwickeln. Um den Personen, die Ihre
App **nutzen**, zu ermöglichen, Claude als sie selbst damit zu verbinden, stellen Sie den
[Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) über Ihr eigenes Backend bereit.
