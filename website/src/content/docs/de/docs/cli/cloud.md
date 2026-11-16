---
sourceHash: b5c0e7ccbbb0b521
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Auth, Projektverknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Im
[Rebase Cloud Leitfaden](/docs/deployment/cloud/) erfahren Sie, was es ist und was die Beta
nicht umfasst.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Weiterleitung über Pipes, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung
einer bestimmten Control Plane (oder `REBASE_CLOUD_URL`) und `--project, -p <id>`.

## Auth

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
(`--project` oder das verknüpfte) sowie `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte. Ein Token darf nur Organisations-Capabilities besitzen.
`logs` deckt auch `usage` ab. Was die einzelnen Optionen abdecken, steht unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents). Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmal auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Der Befehl gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Entweder sind Sie bereits in der Konsole angemeldet, oder Sie melden sich mit
einer der angebotenen Methoden an (Passwort, Google, GitHub, LinkedIn). Prüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert einmalig. Ohne Terminal oder mit `--json` werden Link und Code
auf stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
verweigerte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Bei aktivierter Zwei-Faktor-Authentifizierung wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; bestätigen Sie über den Browser aus einer
Konsolen-Sitzung heraus, die diesen verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Access-Token, das in der Konsole unter Settings → Access
tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase-Connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in
`.env` zu schreiben. Die erneute Ausführung ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Wartezeit zurück. Eigentümer und Administratoren.

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` gibt den Claim-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bevor es nicht beansprucht gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde (in `~/.rebase/credentials.json`); die Control
Plane speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
die Control Plane, ob das projekt-eigene Token noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert
`claim` die Ausführung mit `already_claimed`, anstatt einen ungültigen Link auszugeben. Der Befehl schlägt auch fehl, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt nicht beansprucht wurde.

## Deploy and observe

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
lädt auch den Quellcode des Projekts hoch – was git trackt, niemals eine `.env` –, damit ein
Plattform-Upgrade es neu kompilieren kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein verfolgtes `deploy` endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, der
Deployment-ID, der Dauer und der Information, ob die neue Version dort antwortet. Es
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung), bis
`/health` eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deploy
endet mit einer Zeile, die die App und den Grund nennt, und wird mit einem Exit-Code ungleich null beendet. Die Zusammenfassung
wird auch bei Piping ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`/`.mjs`/`.cjs`-Dateien im Verzeichnis `output` und die Inline-`<script>`-Blöcke in
seinem HTML. Ein Syntaxfehler stoppt das Deploy mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deploy endet mit der Option zum Zurücksetzen, `rebase cloud rollback`. Eine statische App, die alleine
bereitgestellt wurde, kann derzeit noch nicht zurückgesetzt werden; siehe
[Rollback](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktionsumgebung unberührt. Eine Preview des Backends führt ein eigenes Backend auf
einer eigenen, leeren Datenbank aus, inklusive der eingebundenen statischen Apps. Eine statische App kann auf
Rebase Cloud derzeit noch nicht separat als Preview bereitgestellt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Eine Backend-Preview
wird während ihrer Existenz als eine zusätzliche App-Einheit in der Standardgröße abgerechnet, und
das Deploy gibt an, wie viel das pro Monat ausmacht, basierend auf dem Kostenvoranschlag der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane den Preis nicht ermitteln
kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (die Datenbank hat das Preview-Limit überschritten), als
`paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Änderung in der Vorschau anzeigen](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt einen Build, der
noch läuft. `--runtime` liest stattdessen die Ausgaben der App von jedem Pod
dahinter, wobei jede Zeile mit dem jeweiligen Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine Zeitangabe nach RFC3339.
- `--tail <n>` gibt die Anzahl der Zeilen pro Pod an, ab denen begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (ohne Berücksichtigung von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- Mit `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control Plane
  für das Zeitfenster zurückgibt (die neuesten 2000 jedes Pods), und `--tail` zählt übereinstimmende
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod im
  Fenster mehr Zeilen als diese hatte, weist die Ausgabe darauf hin, dass die älteren nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit dieser oder einer höheren Schweregrad-Stufe bei. Es liest
  die strukturierte `severity`, die ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.

Das Verfolgen von Logs (Follow) pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Es meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, gibt es auch die letzten
Zeilen der beendeten Instanz aus, in denen sich meist der Grund befindet. Es wartet, solange kein
Pod läuft, und unternimmt nach einem Verbindungsabbruch erneute Versuche mit Backoff und
setzt dort fort, wo es unterbrochen wurde. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Log-Zeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Vorschau anstelle der Produktion. Verwenden Sie den
Namen der Preview oder die Deployment-ID, die beim Preview-Deploy ausgegeben wurde. Alleine verwendet
liest `--preview` die einzige Preview des Projekts. Eine statische Preview hat ein Build-Log,
aber kein Runtime-Log, da sie keinen Server ausführt.

## Config

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
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Beanspruchen
des Projekts übergibt diesen Schlüssel, und er läuft nicht mehr ab. `app-key rotate` generiert einen neuen und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmal ausgegeben. Im Admin-Panel der App erstellte Schlüssel
bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: Keine Token-Capability berechtigt dazu.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten Schlüssel zu übernehmen. Der Schlüssel selbst wird nie
ausgegeben: dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
gibt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert bis zum Abschluss
des Neustarts, danach nicht mehr. Der Befehl wird abgewiesen, während ein Deploy
läuft, und er wird mit Ihrem Login ausgeführt. Das Beanspruchen eines Projekts rotiert auch dessen Service-Schlüssel.

Eine Backend-Preview übernimmt zunächst die Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable aus ihnen aus, `env reset KEY --preview` setzt
sie auf den Wert der Produktion zurück, und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert aus der Standardeingabe statt über die
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn sichtbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird verworfen. Die Funktion `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt ihren Link aus: einmalige Nutzung,
7 Tage gültig, kann nur von einem Konto akzeptiert werden, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung nicht angenommen wurde – auch nicht jemand, der bereits ein Rebase-Konto besitzt.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob sie per E-Mail gesendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie die Person als Admin ein, und
ein Eigentümer befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` generiert einen neuen Link, und der alte wird ungültig.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgelehnt. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die Eigentümer- oder Admin-Rolle;
Mitgliedern wird dies mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Herabstufen eines Eigentümers
erfordert einen Eigentümer, und der letzte verbleibende Eigentümer bleibt bestehen. `--org <id>` wählt eine andere
als die aktuell ausgewählte Organisation aus.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste zuerst: wer
bereitgestellt, zurückgesetzt, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat
(nach Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Compute-Ressourcen eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Access-Token erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe gibt den Cursor `--before` für die nächste Seite aus. `--json` liefert einen einzelnen Wert,
`{ org, events, nextCursor }`. Es erfordert die Eigentümer- oder Admin-Rolle der Organisation.
Ein Token kann dies nur mit der `audit`-Berechtigung für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die Seite **Aktivität** der Konsole
zeigt dasselbe Protokoll.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet bis zu Strg-C einen lokalen Port, der direkt die verwaltete Datenbank *ist* (kein
öffentlicher Endpunkt); `--reveal` gibt das Passwort dazu an. Nur für Eigentümer oder Admins.

## Guests

Jeder Aufruf von `signInAnonymously()` in einem Test, durch einen Bot oder bei einem abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, sodass
niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert ein Alter mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt der Befehl nur und löscht nichts. Er verarbeitet Projekte beliebiger Größe in kleinen
Batches.

Es können nur Gäste entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel direkt in der Anweisung an, die die
Zeile löscht, sodass der Befehl kein reguläres Konto erreichen kann – selbst dann nicht, wenn es sich einen Moment
nach dem Auflisten registriert hat. `delete` weist ein Konto mit `NOT_ANONYMOUS` ab.

**Last seen** (Zuletzt gesehen) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder wann
der Gast erstellt wurde, wenn kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder
zurückkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens eines gelöschten
Gastes und alle anderen Authentifizierungszeilen werden mit ihm entfernt.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Beibehalten, Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Beibehalten, und der Gast damit ebenfalls: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Beibehalten, enthält eine nicht mehr existierende ID |

Prüfen Sie, welche Ihrer Verknüpfungen kaskadierend gelöscht werden, bevor Sie `--yes` übergeben: Dies kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App hält, sodass der Schlüssel niemals Ihren
Rechner erreicht. Er erfordert die Eigentümer- oder Admin-Rolle in der Organisation für ein Projekt, bei dem der Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Ein Projekt mit einer älteren Runtime wird darauf hingewiesen, dass eine neuere Version erforderlich ist.
`rebase users guests --project <slug>` ist derselbe Befehl in der Projektfamilie.

## Resources

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt.

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wird nicht mehr unterstützt: Jedes Backend führt mindestens eine Instanz aus, daher
wird `true` abgewiesen und `false` mit einer Warnung ignoriert. Es gibt keine
Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
akzeptiert eine durch Kommas getrennte Liste aus `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
nur `{ "text" }` anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane benennt. `add` gibt
das Signiergeheimnis einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` wird mit Exit-Code 1 und Code `delivery_failed` beendet, wenn der Empfänger das
Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Eigentümer- oder Admin-Rolle. Ein Token verwaltet diese mit der
`notifications`-Berechtigung auf Organisationsebene unter Einhaltung derselben Rollenregel. Siehe
[Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` stellt für den eigenen
Cluster eines Kunden eine eigene Image-Registry bereit, die ausschließlich für diesen Cluster verwendet wird.
Ohne eine solche verwendet ein solcher Cluster die gemeinsam genutzte Plattform-Registry, und jedes Deploy dorthin
weist im Log darauf hin. Mit einer eigenen Registry pushen Builds mit einem Token für
dieses Konto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Projekt-Images dort. Zuvor
vom Projekt in der geteilten Registry erstellte Images bleiben pullbar und stehen weiterhin
als Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` setzt sie zurück. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Plattform-Admin-Rolle. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Abrechnungsseite der Konsole und stehen nur Eigentümern und Admins der Organisation
offen. Ein Token greift auf sie und den Rest von `billing` mit der `billing`-Berechtigung
auf Organisationsebene zu; ein Token, das vor Einführung dieser Berechtigung erstellt wurde, funktioniert für
ein Release weiterhin, allerdings mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Währungseinheit (Cents) angegeben, genau wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die nutzungsabhängigen Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
(in UTC) verbraucht hat: Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die Überschreitung
bisher in Euro und – für den laufenden Monat – die Hochrechnung bei aktuellem
Verlauf (eine Schätzung). Die Überschreitung ist die Berechnung des Overage-Reports selbst, die
Stripe mitteilt, was abzurechnen ist, und auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation sowie die Gesamtsumme auf.
Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest
dies mit der `logs`-Berechtigung für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher meldet 0), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten beanspruchtes Projekt zählt nur die Tage ab dem Claim) und
`autoscale_not_charged` (Pods liefen über `--replicas` und diese Plattform berechnet
sie noch nicht). Die Antwort für ein automatisch skaliertes Projekt enthält zudem `autoscale`:
`extraPodSeconds` über dem Mindestwert, `amountEur` zu den entsprechenden Tarifen und `charged`.

## Deploy hooks, alerts and the rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` gilt pro Domain und ist standardmäßig deaktiviert, sodass ein Projekt, das neben seiner Website einen `api.`-Host betreibt, beide beibehält; es wird wirksam, solange die Domain verifiziert ist und eine andere als primär festgelegt wurde, und gilt niemals für eine Domain, auf der eine App ausgeliefert wird. `deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert benötigen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Control-Plane-Route noch nicht bereitgestellt wurde, antwortet mit `not_served` und nennt diese. Destruktive Befehle fragen zuerst nach und verweigern die Ausführung mit `confirmation_required`, wenn niemand antworten kann: übergeben Sie `--yes`.
