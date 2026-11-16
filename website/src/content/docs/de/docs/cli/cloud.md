---
sourceHash: 2013be9a84189071
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud im CLI – Authentifizierung, Projektverknüpfung, Deployments, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Speicher, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Im
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, was es ist und was in der Beta
nicht enthalten ist.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei einer Pipe, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
spezifische Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

## Authentifizierung

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` akzeptiert `deploy`, `logs`, `env`, `database` und `backups` für ein Projekt
(`--project` oder das verknüpfte Projekt) sowie `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte Organisation. Ein Token darf nur Organisationsberechtigungen besitzen.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen umfassen, steht unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents). Wenn die Control
Plane eine Antwort für ein Token als veraltet (deprecated) markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmal auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Es gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Sie sind entweder bereits in der Konsole angemeldet oder melden sich mit
einer der angebotenen Methoden an (Passwort, Google, GitHub, LinkedIn). Überprüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert nur einmal. Ohne Terminal oder mit `--json` werden Link und Code
an stderr gesendet und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
abgelehnte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; bestätigen Sie dies über den Browser aus einer
Konsolensitzung heraus, die ihn verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access tokens erstellt wurde.
Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Eine selbst gehostete Instanz mit Claude verbinden

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase-Connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht diese dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in die
`.env` zu schreiben. Ein erneutes Ausführen ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Wartezeit zurück. Eigentümer und Admins.

## Projekte

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` gibt den Claim-Link des Projekts aus, das von `init --claim` in diesem
Verzeichnis bereitgestellt wurde, sowie die verbleibende Zeit, bevor es nicht beansprucht gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich in einem Browser. Der Link wird nur auf der
Maschine gespeichert, auf der `init --claim` ausgeführt wurde, und zwar in `~/.rebase/credentials.json`; die Control
Plane speichert lediglich einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
die Control Plane ab, ob das eigene Token des Projekts noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim` den Dienst
mit `already_claimed`, anstatt einen toten Link auszugeben. Es verweigert den Dienst auch nach Ablauf des
Zeitfensters (`claim_expired`) sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt nicht beansprucht wurde.

## Bereitstellen und Beobachten

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` ohne App-Namen stellt das Backend bereit. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – das, was Git verfolgt, niemals eine `.env` –, damit ein
Plattform-Upgrade diesen neu erstellen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein mitverfolgtes `deploy` endet mit einer Zusammenfassung: jede ausgelieferte App mit ihrer URL, die
Deployment-ID, wie lange es gedauert hat und ob die neue Version dort antwortet. Es
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung) darauf, dass das
`/health` eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deploy
endet mit einer Zeile, die die App und den Grund nennt, und wird mit einem Exit-Code ungleich null beendet. Die Zusammenfassung
wird auch bei Weiterleitung in eine Pipe ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`/`.mjs`/`.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
ihrem HTML. Ein Syntaxfehler bricht das Deployment mit `file:line:column` ab (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deploy endet mit dem Weg zurück: `rebase cloud rollback`. Eine statische App, die für sich
allein bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktion unberührt. Eine Vorschau (Preview) des Backends führt ein eigenes Backend auf einer
eigenen leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud derzeit noch nicht separat in der Vorschau angezeigt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgewiesen und veröffentlicht nichts. Eine Backend-Preview
wird während ihrer Existenz als eine weitere App-Einheit in der Standardgröße abgerechnet, und
das Deploy zeigt an, wie viel das pro Monat ausmacht, basierend auf der Kalkulation der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane keinen
Preis ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (die Datenbank hat das Preview-Limit überschritten), als
`paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` verweigert werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt (tails) einen Build, der
noch läuft. `--runtime` liest stattdessen die Ausgaben der App von jedem Pod
dahinter, wobei jede Zeile mit ihrem Pod getaggt ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder einen RFC3339-Zeitstempel.
- `--tail <n>` ist die Anzahl der Zeilen pro Pod, ab der begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- Mit `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control Plane
  für das Zeitfenster zurückgibt (die neuesten 2000 jedes Pods), und `--tail` zählt die übereinstimmenden
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod im
  Zeitfenster mehr Zeilen hatte, weist die Ausgabe darauf hin, dass ältere Zeilen nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  den strukturierten `severity`-Wert, den ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  reinen Textzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne diese Angaben werden weggelassen.

Ein Follow pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Es kündigt Pods an,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, gibt es auch die letzten
Zeilen der abgestürzten Instanz aus, in denen sich normalerweise der Grund befindet. Es wartet, solange kein
Pod läuft, und versucht es nach einem Verbindungsabbruch mit Backoff erneut und setzt
dort fort, wo es aufgehört hat. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Log-Zeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Vorschau anstelle der Produktion. Verwenden Sie den Namen der
Preview oder die Deployment-ID, die bei einem Preview-Deploy ausgegeben wurde. Für sich allein liest `--preview`
die einzige Vorschau des Projekts. Eine statische Preview besitzt ein Build-Log, aber kein
Runtime-Log, da sie keinen Server ausführt.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` für die App generiert und als
`REBASE_API_TOKEN` in die `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Beanspruchen (Claiming) des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` generiert einen neuen und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und lässt ihn dort in `--json` aus. In
jedem anderen Verzeichnis gibt es den Schlüssel einmalig aus. Schlüssel, die im Admin-Panel der App erstellt wurden,
bleiben unberührt. Es wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung gewährt diesen Zugriff.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch mit dem neuesten Schlüssel neu startet. Er gibt
den Schlüssel niemals aus: Dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
erstellt einen neuen Schlüssel und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, und danach nicht mehr. Dies wird verweigert, während ein Deploy
läuft, und wird mit Ihrem Login ausgeführt. Das Beanspruchen eines Projekts rotiert auch
dessen Service-Key.

Eine Backend-Preview übernimmt die Variablen der Produktion, einschließlich der Live-Schlüssel.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY --preview`
schließt die Variable von diesen aus, `env reset KEY --preview` setzt sie wieder auf
den Produktionswert zurück und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert über die Standardeingabe anstelle der
Befehlszeile ein, wo `ps` und Ihre Shell-Historie ihn anzeigen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird verworfen. `rebase_cloud_env_set` des MCP-Servers setzt
Werte auf diese Weise.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt ihren Link aus: einmalig verwendbar,
7 Tage gültig und kann nur von einem Konto angenommen werden, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung nicht angenommen wurde, selbst wenn bereits ein Rebase-Konto existiert.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob sie per E-Mail gesendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie die Person als Admin ein, und
ein Eigentümer befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` erzeugt einen neuen Link, und der alte wird ungültig.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgelehnt. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die Rolle
Owner oder Admin; Mitgliedern wird dies mitgeteilt.
`members remove` verlangt eine Bestätigung (`--yes` überspringt diese); das Entfernen oder Herabstufen eines Owners
erfordert einen Owner, und der letzte Owner bleibt bestehen. `--org <id>` wählt eine andere
als die aktuell ausgewählte Organisation.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
ein Deployment durchgeführt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Compute-Ressourcen eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe gibt den `--before`-Cursor für die nächste Seite aus. `--json` ist ein einzelner Wert:
`{ org, events, nextCursor }`. Es erfordert die Rolle Owner oder Admin der Organisation.
Ein Token kann dies nur mit der Berechtigung `audit` für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die **Activity**-Seite der Konsole
zeigt dasselbe Log an.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admins.

## Gäste

Jedes `signInAnonymously()` in einem Test, durch einen Bot oder einen abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, damit
niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert eine Altersangabe mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes` zählt
es lediglich und löscht nichts. Es arbeitet Projekte jeder Größe in kleinen
Batches ab.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität, und die App wendet diese Regel direkt in der Anweisung an, die die
Zeile löscht; der Befehl kann somit kein reguläres Konto erreichen, selbst wenn es sich kurz
nach dem Auflisten registriert hat. `delete` verweigert Konten mit `NOT_ANONYMOUS`.

**Zuletzt gesehen** (Last seen) gibt an, wann die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder wann
der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der regelmäßig
wiederkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens
und alle weiteren Authentifizierungszeilen eines gelöschten Gastes werden ebenfalls entfernt.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel (Foreign Key):

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Beibehalten, Verknüpfung geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Beibehalten, und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Beibehalten, verweist auf eine nicht mehr existierende ID |

Prüfen Sie vor der Übergabe von `--yes`, welche Ihrer Verknüpfungen kaskadieren: Dies kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App hält, sodass der Schlüssel niemals Ihren
Rechner erreicht. Er erfordert einen Eigentümer oder Admin der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Ein Projekt mit einer älteren Runtime wird darauf hingewiesen, dass es eine neuere benötigt.
`rebase users guests --project <slug>` ist derselbe Befehl in der Projektfamilie.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wäre eine Datenlöschung durch einen Push. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (prunt).

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` ist veraltet: Jedes Backend führt mindestens eine Instanz aus, daher
wird `true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine Tarifstufen
(Plan Tiers): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Speicher, Benachrichtigungen, Cluster, Abrechnung und Nutzung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` sendet die Ereignisse des verknüpften Projekts an eine URL. `--events`
akzeptiert eine kommagetrennte Liste aus `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
ausschließlich `{ "text" }` anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane benennt. `add` gibt das
Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` beendet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger das
Testereignis nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle Owner oder Admin. Ein Token verwaltet diese mit der
Berechtigung `notifications` auf Organisationsebene unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo> --push-service-account <email> --pull-key-file <key.json>` weist dem
eigenen Cluster eines Kunden eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird. Ohne
diese verwendet ein solcher Cluster die gemeinsam genutzte Registry der Plattform, und jedes Deploy dorthin
weist im Log darauf hin. Mit einer eigenen Registry pushen Builds in dieses Repository mit einem Token für
dieses Konto, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Bilder des Projekts von dort. Images,
die das Projekt zuvor im gemeinsamen Repository erstellt hat, bleiben pullbar und bleiben
Rollback-Ziele. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle platform-admin. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Abrechnungsseite (Billing) der Konsole und sind ausschließlich für Eigentümer und Admins der Organisation zugänglich.
Ein Token erreicht diese und den Rest von `billing` mit der Berechtigung `billing`
für die Organisation; ein Token, das vor Einführung dieser Berechtigung erstellt wurde, funktioniert
noch für ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Währungseinheit (Cent) angegeben, genau wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die verbrauchsabhängigen Positionen wachsen bis zum Ende des Abrechnungszeitraums an.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
in UTC verbraucht hat: Anfragen im Vergleich zum enthaltenen Kontingent, 5xx-Fehler, die bisherige
Mehrnutzung (Overage) in Euro und – für den laufenden Monat – die Hochrechnung bei aktuellem
Tempo (eine Schätzung). Die Mehrnutzung ist die eigene Berechnung des Nutzungsberichts,
die Stripe mitteilt, was abzurechnen ist, und auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation
sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest
dies mit der Berechtigung `logs` für das Projekt; `usage org` listet die Projekte auf, für die
das Token diese Berechtigung besitzt.
`--month` nimmt einen vergangenen Monat entgegen. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher zeigt 0 an), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten beanspruchtes Projekt zählt erst ab dem Tag des Claims) und
`autoscale_not_charged` (Pods liefen oberhalb von `--replicas` und diese Plattform stellt
sie noch nicht in Rechnung). Die Antwort eines automatisch skalierten Projekts enthält zudem `autoscale`:
`extraPodSeconds` über dem Mindestwert, `amountEur` zu den entsprechenden Tarifen und `charged`.

## Deploy-Hooks, Alerts und Weiteres

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert benötigen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Control-Plane-Route noch nicht bereitgestellt ist, antwortet mit `not_served` und nennt diesen. Destruktive Befehle fragen zuerst nach und verweigern die Ausführung mit `confirmation_required`, wenn niemand antworten kann: Übergeben Sie `--yes`.
