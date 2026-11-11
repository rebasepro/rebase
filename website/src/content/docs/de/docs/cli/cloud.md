---
sourceHash: 9d048d537401732a
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Auth, Projektverknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe das
[Rebase Cloud-Handbuch](/docs/deployment/cloud/) für Details darüber, was es ist und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Weiterleitung über eine Pipe, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung
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
andernfalls die ausgewählte. Ein Token darf auch ausschließlich Organisationsberechtigungen besitzen.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen abdecken, ist unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor der Einführung von `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Es gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Sie sind entweder bereits in der Konsole angemeldet oder melden sich mit
einer der angebotenen Methoden an (Passwort, Google, GitHub, LinkedIn). Prüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert einmalig. Ohne Terminal oder mit `--json` werden Link und Code
auf stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
verweigerte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend Ihr
Authentifikator-Code (oder ein Wiederherstellungscode) abgefragt; über den Browser bestätigen Sie dies aus
einer Konsolensitzung, die ihn verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access
tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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

Der [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in
`.env` zu schreiben. Eine erneute Ausführung ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Warten zurück. Nur für Eigentümer und Admins.

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

`claim` gibt den Claim-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bevor es nicht beansprucht gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde, in `~/.rebase/credentials.json`; die Control
Plane speichert lediglich einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
die Control Plane, ob das eigene Token des Projekts noch gültig ist. Das Beanspruchen
widerruft dieses Token; sobald jemand das Projekt beansprucht hat, verweigert `claim` daher die Ausführung
mit `already_claimed`, anstatt einen toten Link auszugeben. Es verweigert die Ausführung auch, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt unbeansprucht ist.

## Deployen und Überwachen

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
Plattform-Upgrade es neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein verfolgter `deploy`-Befehl endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, der
Deployment-ID, der Dauer und der Information, ob die neue Version dort antwortet. Er
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung), bis
`/health` eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deployment
endet mit einer Zeile, die die App und den Grund nennt, und wird mit einem Exit-Code ungleich null beendet. Die Zusammenfassung
wird auch bei Weiterleitung über eine Pipe ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder bereitgestellten statischen App:
die `.js`/`.mjs`/`.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
deren HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deployment schließt mit dem Weg zurück ab: `rebase cloud rollback`. Eine separat bereitgestellte statische
App kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktionsumgebung unberührt. Eine Preview des Backends führt ein eigenes Backend auf einer
eigenen, leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud derzeit noch nicht separat als Preview bereitgestellt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgewiesen und veröffentlicht nichts. Eine Backend-Preview
wird während ihrer Existenz als eine zusätzliche App-Einheit in Standardgröße abgerechnet, und
das Deployment gibt an, was dies pro Monat kostet, basierend auf dem Kostenvoranschlag der Control Plane selbst
(`cost` unter `--json`; nur die Regel und dieser Link, falls die Control Plane keinen
Preis ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (die Datenbank ist über das Preview-Limit gewachsen), als
`paused` mit dem Grund an (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgewiesen werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt (tailed) einen Build, der
noch läuft. `--runtime` liest stattdessen die Ausgaben der App von jedem Pod
dahinter, wobei jede Zeile mit ihrem Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine RFC3339-Zeitangabe.
- `--tail <n>` ist die Anzahl der Zeilen pro Pod, ab der begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` filtert Zeilen, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  den strukturierten `severity`-Wert, den ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.

Beim Verfolgen (Follow) wird alle zwei Sekunden gepollt und jede Zeile einmal ausgegeben. Es kündigt Pods
an, die starten, stoppen oder neu starten. Wenn ein Container neu startet, werden auch die letzten
Zeilen der beendeten Instanz ausgegeben, in denen sich normalerweise die Ursache befindet. Es wartet, solange kein
Pod läuft, und unternimmt nach einem Verbindungsabbruch erneute Versuche mit Backoff, um dort
fortzufahren, wo es unterbrochen wurde. Mit `--json` gibt Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Preview anstelle der Produktionsumgebung. Verwenden Sie den
Namen der Preview oder die Deployment-ID, die beim Preview-Deploy ausgegeben wurde. Alleine verwendet liest
`--preview` die einzige Preview des Projekts. Eine statische Preview hat ein Build-Log, aber kein
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
Schlüssel auf, den `rebase cloud init --claim` für die App erzeugt und als
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Beanspruchen des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` erzeugt einen neuen und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits definiert, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App erstellt wurden,
bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung gewährt diesen Zugriff.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten zu übernehmen. Der Schlüssel selbst wird nie
ausgegeben: dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
stellt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Der Befehl wird verweigert, während ein Deployment
läuft, und wird mit Ihrem Login ausgeführt. Das Beanspruchen eines Projekts rotiert auch dessen Service-Schlüssel.

Eine Backend-Preview übernimmt zunächst die Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable von ihnen aus, `env reset KEY --preview` stellt
den Produktionswert wieder her und `env list --preview` zeigt die Unterschiede.
Die Produktionsumgebung wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert über die Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihre Shell-History ihn einsehbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird verworfen. `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt deren Link aus: einmalig nutzbar,
7 Tage gültig, kann nur von einem Account angenommen werden, der diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung angenommen wurde – selbst jemand, der bereits einen Rebase-Account besitzt.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob sie per E-Mail gesendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu übermitteln. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie Personen als Admin ein, und
ein Eigentümer befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` erzeugt einen neuen Link, wodurch der alte ungültig wird.
Einladungen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgewiesen. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die Rolle 'Owner' oder 'Admin';
Mitgliedern wird dies mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Herabstufen eines Eigentümers
erfordert einen Eigentümer, und der letzte Eigentümer bleibt stets bestehen. `--org <id>` wählt eine andere Organisation
als die derzeit ausgewählte.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste zuerst: wer
bereitgestellt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Compute-Ressourcen eines Projekts geändert, ein Projekt gestoppt oder gelöscht hat, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe druckt den `--before`-Cursor für die nächste Seite. `--json` liefert einen einzelnen Wert:
`{ org, events, nextCursor }`. Dies erfordert die Rolle 'Owner' oder 'Admin' der Organisation.
Ein Token kann dies nur mit der Berechtigung `audit` für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die Seite **Activity** der Konsole
zeigt dasselbe Protokoll an.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank darstellt (*ist*, kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Eigentümer oder Admins.

## Gäste

Jeder Aufruf von `signInAnonymously()` in einem Test, durch einen Bot oder bei einem abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, damit
sie niemand einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` erwartet eine Zeitspanne mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt es nur und löscht nichts. Es arbeitet sich in kleinen Batches
durch Projekte jeder Größe.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile, bei der `is_anonymous` gesetzt ist, ohne Passwort und
ohne verknüpfte Identität. Die App wendet diese Regel direkt im Delete-Statement für die
Zeile an, sodass der Befehl keinen regulären Account erreichen kann – selbst wenn dieser sich einen Moment
nach der Auflistung registriert hat. `delete` verweigert reguläre Accounts mit `NOT_ANONYMOUS`.

**Zuletzt gesehen** (Last seen) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder
wann der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder
zurückkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens eines gelöschten Gastes
und alle weiteren Auth-Zeilen werden mitgelöscht.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Bleibt erhalten, Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Bleibt erhalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Bleibt erhalten und enthält eine nicht mehr existierende ID |

Prüfen Sie vor der Übergabe von `--yes`, welche Ihrer Verknüpfungen kaskadieren: Dies kann nicht rückgängig gemacht werden.

Der Befehl liest `REBASE_SERVICE_KEY` wie `env reveal`, erfordert also einen
Eigentümer oder Admin (oder ein entsprechendes Token mit der Berechtigung `env`). Der
Schlüssel verbleibt im Speicher und wird ausschließlich an die projekteigene Adresse gesendet. Ein Projekt mit
einer älteren Runtime wird darauf hingewiesen, dass eine neuere Version erforderlich ist.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was der Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
würde bedeuten, dass Daten durch einen Push gelöscht werden. Sie wird beibehalten, angebunden und abgerechnet, bis
sie jemand namentlich mit prune entfernt.

## Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` ist veraltet (retired): Jedes Backend führt mindestens eine Instanz aus, weshalb
`true` verweigert und `false` mit einer Warnung ignoriert wird. Es gibt keine
Tarifstufen (Plans): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, Benachrichtigungen, Cluster, Abrechnung und Nutzung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
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
akzeptiert eine kommagetrennte Liste von `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
ausschließlich `{ "text" }` anstelle des Event-JSON, das ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane benennt. `add` gibt
das Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` wird mit Exit-Code 1 und Code `delivery_failed` beendet, wenn der Empfänger
das Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle 'Owner' oder 'Admin'. Ein Token verwaltet diese mit der
Berechtigung `notifications` auf Organisationsebene unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` weist dem eigenen
Cluster eines Kunden eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche Registry nutzt ein Cluster die gemeinsame Registry der Plattform, worauf jedes Deployment in seinem
Log hinweist. Mit einer eigenen Registry pushen Builds mit einem Token für dieses Dienstkonto in dieses Repository,
Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die Images des Projekts dort. Images,
die das Projekt zuvor in der gemeinsam genutzten Registry erstellt hat, bleiben pullbar und stehen weiterhin als
Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle 'Platform-Admin'. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und sind ausschließlich Eigentümern und Admins der Organisation
zugänglich. Ein Token kann darauf sowie auf den Rest von `billing` mit der Berechtigung `billing`
auf Organisationsebene zugreifen; ein Token, das vor der Einführung dieser Berechtigung erstellt wurde, funktioniert für
ein Release weiterhin, gibt jedoch bei jeder Antwort eine Warnung aus. Beträge in `--json` sind in der kleinsten Währungseinheit (Cent) angegeben, genau wie
Stripe sie übermittelt. Rechnungsentwürfe (Drafts) werden nicht aufgeführt; die Vorschau wird von
Stripe berechnet und ihre nutzungsbasierten Positionen wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest ab, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
(in UTC) verbraucht hat: Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherigen Mehrkosten
(Overage) in Euro und – für den aktuellen Monat – eine Hochrechnung bei diesem
Tempo (eine Schätzung). Die Mehrkosten basieren auf der Berechnung des Overage-Reports,
die Stripe mitteilt, was abzurechnen ist, und auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation
sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann diese Information einsehen. Ein Token liest
sie mit der Berechtigung `logs` für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher liest 0), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten beanspruchtes Projekt zählt nur die Tage ab dem Claim) und
`autoscale_not_charged` (Pods liefen über `--replicas` und diese Plattform berechnet
diese noch nicht). Die Antwort eines automatisch skalierten Projekts enthält zudem `autoscale`:
`extraPodSeconds` über dem Basiswert, `amountEur` zu den entsprechenden Tarifen und `charged`.
