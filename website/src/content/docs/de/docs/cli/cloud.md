---
sourceHash: 720d2918ad0263cf
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Authentifizierung, Projektverknüpfung, Deployments, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Speicher, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe
[Rebase Cloud guide](/docs/deployment/cloud/) für Details dazu, was es ist und was die Beta
nicht beinhaltet.

Jede Gruppe reagiert auf `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt, ohne es zu verknüpfen.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Pipes, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung einer
bestimmten Control Plane (oder `REBASE_CLOUD_URL`) und `--project, -p <id>`.

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
(`--project` oder das verknüpfte), und `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte. Ein Token darf nur Organisationsberechtigungen enthalten.
`logs` deckt auch `usage` ab. Was jede Berechtigung erreicht, ist in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Es gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Sie sind bereits in der Konsole angemeldet oder melden sich mit
einer der angebotenen Methoden an (Passwort, Google, GitHub, LinkedIn). Überprüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert einmalig. Ohne Terminal oder mit `--json` werden Link und Code
auf stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
abgelehnte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; bestätigen Sie über den Browser aus einer
Konsolensitzung heraus, die ihn verwendet hat. Ohne Terminal kann keiner der beiden Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access tokens erstellt wurde.
Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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

Der [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht diese Instanz dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in
`.env` zu schreiben. Ein erneutes Ausführen ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Warten zurück. Besitzer und Administratoren.

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` gibt den Claim-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bevor es nicht beansprucht gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde, in `~/.rebase/credentials.json`; die Control
Plane speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
die Control Plane, ob das eigene Token des Projekts noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim` die Ausführung
mit `already_claimed`, anstatt einen ungültigen Link anzuzeigen. Es bricht ebenfalls ab, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt unbeansprucht ist.

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

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – was Git nachverfolgt, niemals eine `.env` –, damit ein
Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert dies und löscht die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

Ein verfolgter `deploy`-Vorgang endet mit einer Zusammenfassung: jede ausgelieferte App mit ihrer URL, der
Deployment-ID, der Dauer und der Information, ob die neue Version dort antwortet. Es
wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung), bis das
`/health` eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deployment
endet mit einer Zeile, die die App und den Grund nennt, und wird mit einem Exit-Code ungleich null beendet. Die Zusammenfassung
wird auch bei einer Pipe ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`/`.mjs`/`.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
ihrem HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deployment endet mit dem Rückweg, `rebase cloud rollback`. Eine statische App, die einzeln bereitgestellt
wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktion unberührt. Eine Preview des Backends führt ein eigenes Backend auf einer
eigenen leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann
auf Rebase Cloud derzeit noch nicht separat als Preview bereitgestellt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Eine Backend-Preview
wird für die Dauer ihrer Existenz als eine zusätzliche App-Einheit in Standardgröße abgerechnet, und
das Deployment gibt an, wie viel dies pro Monat kostet, basierend auf dem Angebot der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane keinen
Preis ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (weil die Datenbank das Preview-Limit überschritten hat), als
`paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` folgt einem Build, der
noch läuft. `--runtime` liest stattdessen aus, was die App ausgibt, und zwar von jedem Pod
dahinter, wobei jede Zeile mit ihrem Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine RFC3339-Zeitangabe.
- `--tail <n>` gibt die Anzahl der Zeilen pro Pod an, mit denen begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für
  reguläre Ausdrücke.
- Mit `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control Plane
  für das Zeitfenster zurückgibt (die neuesten 2000 pro Pod), und `--tail` zählt die übereinstimmenden
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod mehr
  Zeilen im Zeitfenster hatte, weist die Ausgabe darauf hin, dass die älteren nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  die strukturierte `severity`, die ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  normalen Zeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne diese Angaben werden ausgelassen.

Ein Follow-Vorgang pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Er meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, werden auch die letzten
Zeilen der beendeten Instanz ausgegeben, in denen sich normalerweise die Ursache befindet. Er wartet, solange kein
Pod läuft, und versucht nach einem Verbindungsabbruch mit Backoff erneut eine Verbindung aufzubauen, um
dort fortzufahren, wo er aufgehört hat. Mit `--json` gibt ein Follow-Vorgang ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Preview anstelle der Produktion. Verwenden Sie den Namen der
Preview oder die Deployment-ID, die ein Preview-Deploy ausgegeben hat. Für sich allein
liest `--preview` die einzige Preview des Projekts. Eine statische Preview hat ein Build-Log, aber kein
Runtime-Log, da sie keinen Server ausführt.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` auf der App generiert und als
`REBASE_API_TOKEN` in `.env` geschrieben hat, anhand seines Präfix und niemals seines Werts. Das
Beanspruchen (Claiming) des Projekts übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` generiert einen neuen Schlüssel und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App
erstellt wurden, bleiben unberührt. Es wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung gewährt dies.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten zu übernehmen. Es gibt niemals
den Schlüssel selbst aus: Dafür ist `env reveal REBASE_SERVICE_KEY` zuständig. `service-key rotate`
generiert einen neuen Schlüssel und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Es wird verweigert, während ein Deploy
läuft, und läuft mit Ihrem Login. Das Beanspruchen eines Projekts rotiert auch seinen Service-Schlüssel.

Eine Backend-Preview besitzt einen eigenen Service-Schlüssel. Ihr erstes Deployment erstellt ihn,
erneute Deployments behalten ihn bei, und der Schlüssel der Produktion antwortet auf der Preview mit 401.
`service-key --preview <name>` gibt ihn aus, ebenso wie `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
generiert einen neuen und startet nur den Pod dieser Preview neu; der alte Schlüssel funktioniert, bis
der neue Pod bereit ist. Es erfolgt eine Bestätigungsabfrage, die mit `--yes` übersprungen werden kann. Beide erfordern
dasselbe wie `env reveal`: die Besitzer- oder Administratorrolle der Organisation und bei einem
Zugriffstoken die `env`-Berechtigung für ein beanspruchtes Projekt. Der Produktionsschlüssel und
der Produktions-Pod bleiben unberührt.

Eine Backend-Preview startet mit den Variablen der Produktion, einschließlich der Live-Schlüssel.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable davon aus, `env reset KEY --preview` setzt
sie auf den Wert der Produktion zurück, und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe statt von der
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn anzeigen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird entfernt. Der Befehl `rebase_cloud_env_set` des MCP-Servers setzt
Werte auf diese Weise.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt deren Link aus: einmalig verwendbar,
7 Tage gültig, kann nur von einem Konto angenommen werden, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung nicht angenommen wurde – auch Personen nicht, die bereits ein Rebase-Konto besitzen.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob sie per E-Mail gesendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie Personen als Admin ein, und
ein Owner kann sie nach dem Beitritt mit `members role <email> owner` befördern.
`invites resend` erzeugt einen neuen Link, und der alte verliert seine Gültigkeit.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgewiesen. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die
Rolle 'Owner' oder 'Admin'; einem Member wird dies entsprechend mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Herabstufen eines Owners
erfordert einen Owner, und der letzte Owner bleibt bestehen. `--org <id>` wählt eine andere
Organisation als die aktuell ausgewählte.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
deployed, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
das Compute eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite enthält bis zu 100 Einträge (`--limit`, Standard 50); die
Ausgabe druckt den `--before`-Cursor für die nächste Seite. `--json` ist ein einzelner Wert,
`{ org, events, nextCursor }`. Es erfordert die Rolle 'Owner' oder 'Admin' der Organisation.
Ein Token liest dies nur mit der `audit`-Berechtigung für die Organisation
(`rebase cloud tokens create --can audit`). Die Seite **Activity** in der Konsole
zeigt dasselbe Protokoll an.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank darstellt (*is*) (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` blendet das Passwort ein. Nur für Owner oder Admin.

## Guests

Jedes `signInAnonymously()` in einem Test, durch einen Bot oder bei einem abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie,
sodass sie niemand einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert eine Zeitspanne mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt es nur und löscht nichts. Es arbeitet Projekte beliebiger Größe in kleinen
Batches ab.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel direkt in der Anweisung an, die die Zeile löscht,
sodass der Befehl kein reguläres Konto erfassen kann – selbst wenn es sich kurz nach dem Auflisten registriert hat.
`delete` verweigert ein Konto mit `NOT_ANONYMOUS`.

**Last seen** ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder
wann der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder
zurückkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens eines gelöschten Gastes
und alle anderen Authentifizierungszeilen werden mitgelöscht.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile passiert |
|---|---|
| Optional link (`ON DELETE SET NULL`, the default) | Beibehalten, Link wird geleert |
| Required link (`ON DELETE RESTRICT`, the default) | Beibehalten, und der Gast mit ihr: der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| No foreign key (a `userSelect` field, a plain id) | Beibehalten, enthält eine ID, die nicht mehr existiert |

Überprüfen Sie, welche Ihrer Verknüpfungen kaskadieren, bevor Sie `--yes` übergeben: Dies kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App hält, sodass der Schlüssel niemals Ihren
Rechner erreicht. Er erfordert einen Owner oder Admin der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Bei einem Projekt mit einer älteren Runtime wird gemeldet, dass eine neuere erforderlich ist.
`rebase users guests --project <slug>` ist derselbe Befehl in der Projekt-Familie.

## Resources

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was der Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt eine bereitgestellte Datenbank niemals, wenn deren Deklaration entfernt wird – das
wären durch einen Push gelöschte Daten. Sie wird beibehalten, gebunden und abgerechnet, bis
sie jemand namentlich mit Prune entfernt.

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
wird `true` abgewiesen und `false` mit einer Warnung ignoriert. Es gibt keine Tarifstufen:
Alles wird pro Ressource abgerechnet. Siehe
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
akzeptiert eine kommagetrennte Liste von `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
nur `{ "text" }` anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane benennt. `add` gibt
das Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` bricht mit Exit-Code 1 und dem Code `delivery_failed` ab, wenn der Empfänger das
Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle 'Owner' oder 'Admin'. Ein Token verwaltet diese mit der
`notifications`-Berechtigung für die Organisation unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` weist dem eigenen
Cluster eines Kunden eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche verwendet ein solcher Cluster die gemeinsam genutzte Registry der Plattform, und jedes Deployment darauf
weist im Log darauf hin. Mit einer eigenen Registry pushen Builds mit einem Token für dieses
Konto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Images des Projekts dort. Images,
die das Projekt zuvor in der gemeinsam genutzten Registry erstellt hat, bleiben pullbar und stehen weiterhin als
Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder zurückgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle 'Platform-Admin'. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und sind ausschließlich den Ownern und Admins der Organisation
zugänglich. Ein Token erreicht diese sowie den Rest von `billing` mit der `billing`-Berechtigung
für die Organisation; ein Token, das vor Einführung dieser Berechtigung erstellt wurde, funktioniert noch für
ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` werden in der kleinsten Währungseinheit (Cent) angegeben, genau wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die nutzungsabhängigen Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
(in UTC) verbraucht hat: Anfragen gegenüber dem enthaltenen Kontingent, 5xx-Fehler, die bisherige
Mehrnutzung (Overage) in Euro und – für den laufenden Monat –, worauf es bei diesem
Tempo hinausläuft (eine Schätzung). Die Mehrnutzung ist die eigene Berechnung des Overage-Berichts, die
Stripe mitteilt, was abgerechnet werden soll, und erscheint auf der Rechnung des Folgemonats.
`usage org` listet jedes Projekt der mit `rebase cloud
use` ausgewählten Organisation sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest
dies mit der `logs`-Berechtigung für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher liefert 0), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten beanspruchtes Projekt zählt erst ab dem Tag des Claims) und
`autoscale_not_charged` (Pods liefen über `--replicas` und diese Plattform stellt
sie noch nicht in Rechnung). Die Antwort für ein automatisch skaliertes Projekt enthält zudem `autoscale`:
`extraPodSeconds` über dem Mindestwert, `amountEur` zu den entsprechenden Tarifen und `charged`.

## Deploy hooks, alerts and the rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` gilt pro Domain und ist standardmäßig deaktiviert, sodass ein Projekt, das neben seiner Website einen `api.`-Host bedient, beide behält; es wird wirksam, solange die Domain verifiziert ist und eine andere als primär festgelegt ist, und gilt niemals für eine Domain, auf der eine App bereitgestellt wird. `deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert benötigen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Route auf der Control Plane noch nicht bereitgestellt ist, antwortet mit `not_served` und nennt diese. Destruktive Befehle fragen vorher nach und verweigern die Ausführung mit `confirmation_required`, wenn niemand antworten kann: Übergeben Sie `--yes`.
