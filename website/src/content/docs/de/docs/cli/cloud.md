---
sourceHash: 8ba7c94e0a895b48
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud im CLI – Auth, Projekt-Verknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Im
[Rebase-Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, worum es sich handelt und was die Beta
noch nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Verwendung in einer Pipe, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

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
andernfalls die ausgewählte. Ein Token darf auch ausschließlich Organisationsberechtigungen enthalten.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen umfassen, wird unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor der Einführung von `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags erfolgt die Anmeldung mit `login` über den Browser. Der Befehl gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Entweder sind Sie bereits in der Konsole angemeldet oder Sie melden sich mit
einer beliebigen dort angebotenen Methode an (Passwort, Google, GitHub, LinkedIn). Vergewissern Sie sich, dass der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und ist einmalig gültig. Ohne Terminal oder mit `--json` werden Link und Code
über stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
abgelehnte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; im Browser bestätigen Sie dies über eine
Konsolensitzung, die 2FA verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access
tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Projekt-Verknüpfung

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Die Organisationsbefehle (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) beziehen sich auf `--org <id>`, andernfalls auf die
mit `cloud use` ausgewählte Organisation, andernfalls auf die Organisation des verknüpften Projekts. Im
letzten Fall wird angegeben, welche Organisation verwendet wurde. `orgs delete` übernimmt dies niemals
aus der Verknüpfung: hierfür ist `--org` oder eine ausgewählte Organisation erforderlich.

### Eine selbst gehostete Instanz mit Claude verbinden

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase Connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in
`.env` einzutragen. Eine erneute Ausführung ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Warten zurück. Nur für Owner und Admins.

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
in 41h`). `--open` öffnet den Link zusätzlich im Browser. Der Link wird ausschließlich auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde, und zwar in `~/.rebase/credentials.json`; die Control
Plane speichert lediglich einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
bei der Control Plane nach, ob das projekteigene Token noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim` die Ausführung
mit `already_claimed`, anstatt einen ungültigen Link auszugeben. Der Befehl schlägt ebenfalls fehl, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), oder in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt nicht beansprucht wurde.

## Bereitstellen und beobachten

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
lädt auch den Quellcode des Projekts hoch – alles, was Git trackt, niemals eine `.env` –, damit ein
Plattform-Upgrade es neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert dies und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein Plattform-Upgrade kann eine verwaltete App auf einem neueren `@rebasepro`-Release neu bauen,
als Ihr Checkout festlegt. Ein Deploy aus diesem Checkout würde das ältere Admin-Panel
und den Treiber wiederherstellen, daher wird er abgelehnt, bevor etwas gebaut wird, zusammen mit dem
Befehl, der dies behebt (`rebase upgrade --to <version>`). `rebase cloud status`
weist bereits früher darauf hin: durch eine `Rebuilt on`-Zeile und in `--json` über
`runtime.platformRebuiltVersion` und `frameworkDrift`.

Ein verfolgter `deploy`-Vorgang schließt mit einer Zusammenfassung ab: jede ausgelieferte App samt URL, die
Deployment-ID, die benötigte Zeit und ob die neue Version dort antwortet. Der Befehl
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung), bis `/health` des
Backends und die Adressen der einzelnen statischen Apps antworten. Ein fehlgeschlagener Deploy
endet mit einer Zeile, die die App und den Grund nennt, und beendet sich mit einem Exit-Code ungleich null. Die Zusammenfassung
wird auch bei Weiterleitung über eine Pipe ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
das `apps`, `hosts`, `live`, `liveChecks` und `durationMs` enthält. Ein Host, dessen HTTPS-Zertifikat
noch nicht ausgestellt ist, wird mit diesem Grund als nicht live gemeldet.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die ausgeliefert wird:
die `.js`- / `.mjs`- / `.cjs`-Dateien in deren `output` sowie die Inline-`<script>`-Blöcke in
deren HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code
`syntax_error` unter `--json`); `--no-verify` überspringt diese Prüfung. Ein erfolgreicher
Deploy endet mit dem Hinweis auf den Rollback-Weg: `rebase cloud rollback`. Eine statische App, die
einzeln bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktionsumgebung unberührt. Eine Vorschau des Backends führt ein eigenes Backend auf einer
eigenen, leeren Datenbank aus, inklusive der eingebundenen statischen Apps. Eine statische App kann
auf Rebase Cloud derzeit noch nicht separat in einer Vorschau bereitgestellt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Eine Backend-Vorschau
wird für die Dauer ihres Bestehens als eine zusätzliche App-Einheit in Standardgröße abgerechnet, und
der Deploy-Befehl gibt an, wie viel dies pro Monat kostet, basierend auf der Preisangabe der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, falls die Control Plane den Preis nicht
berechnen kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Vorschau, die von der Plattform pausiert wurde (da ihre Datenbank das Vorschau-Limit überschritten hat), als
`paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Vorschauadresse
kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für
Vorschau-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann dies gilt.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt (tails) einen Build, der
noch läuft. `--runtime` liest stattdessen das aus, was die App ausgibt, und zwar von jedem dahinterliegenden
Pod, wobei jede Zeile mit ihrem Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder einen RFC3339-Zeitstempel.
- `--tail <n>` gibt an, ab wie vielen Zeilen pro Pod begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` filtert Zeilen, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- Bei `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control Plane
  für das Zeitfenster zurückgibt (die neuesten 2000 pro Pod), und `--tail` zählt übereinstimmende
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod im Zeitfenster mehr
  Zeilen aufwies, weist die Ausgabe darauf hin, dass die älteren nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Ausgewertet werden
  das strukturierte Feld `severity`, das ein Rebase-Backend loggt, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.

Ein Follow pollt alle zwei Sekunden und gibt jede Zeile genau einmal aus. Es meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, gibt es zudem die letzten
Zeilen der beendeten Instanz aus, in denen meist die Ursache zu finden ist. Es wartet, solange kein
Pod läuft, und versucht nach einem Verbindungsabbruch mit Backoff erneut eine Verbindung aufzubauen und
setzt dort fort, wo es unterbrochen wurde. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile (NDJSON) aus: `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Vorschau anstelle der Produktion. Verwenden Sie den Namen der Vorschau
oder die Deployment-ID, die beim Vorschau-Deploy ausgegeben wurde. Ohne Namen liest `--preview`
die einzige Vorschau des Projekts. Eine statische Vorschau besitzt ein Build-Log, aber kein
Runtime-Log, da sie keinen Server ausführt.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` für einen Host, den das Projekt bereits besitzt – beispielsweise einen, den ein Deploy
aus `rebase.json` registriert hat –, gibt die DNS-Einträge und den Status dieses Hosts genauso aus wie
beim erstmaligen Hinzufügen; `--json` ergänzt `alreadyRegistered: true`. Ein verifizierter Host wird
über HTTPS bereitgestellt, sobald sein Zertifikat ausgestellt wurde – wenige Minuten nach der
Verifizierung. Bis dahin antwortet der Ingress mit einem Platzhalterzertifikat,
und `domains list`, `domains verify` sowie `status` melden
`verified, certificate pending` statt live. Die CLI ermittelt dies über
einen TLS-Handshake zu jedem verifizierten Host; `--json` gibt dies als `certificate` aus
(`ready`, `pending` oder `unreachable`, jeweils mit einem `reason`).

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` für die App generiert und als
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Beanspruchen (Claiming) des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` generiert einen neuen Schlüssel und
widerruft alle früheren Agent-Schlüssel auf einmal. Der Befehl schreibt den neuen Schlüssel in eine `.env`-Datei,
in der `REBASE_API_TOKEN` bereits gesetzt ist, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App erstellt wurden,
bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: keine Token-Berechtigung gewährt diesen Zugriff.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten Schlüssel zu übernehmen. Der Schlüssel selbst
wird niemals ausgegeben: dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
stellt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Der Befehl wird verweigert, solange ein Deploy
läuft, und wird mit Ihrem Login ausgeführt. Das Beanspruchen eines Projekts rotiert auch dessen
Service-Schlüssel.

Eine Backend-Vorschau besitzt einen eigenen Service-Schlüssel. Ihr erster Deploy erstellt ihn,
erneute Deploys behalten ihn bei, und der Produktionsschlüssel antwortet auf der Vorschau mit 401.
`service-key --preview <name>` gibt ihn aus, ebenso wie `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
schreibt einen neuen und startet nur den Pod dieser Vorschau neu; der alte Schlüssel funktioniert, bis
der neue Pod bereit ist. Der Befehl fragt vorher nach, und `--yes` überspringt die Abfrage. Beide erfordern
dieselben Berechtigungen wie `env reveal`: die Owner- oder Admin-Rolle der Organisation und bei einem
Zugriffstoken die `env`-Berechtigung auf einem beanspruchten Projekt. Der Produktionsschlüssel und der
Produktions-Pod bleiben unberührt.

Eine Backend-Vorschau übernimmt zunächst die Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` weist Vorschauen einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable von ihnen aus, `env reset KEY --preview` stellt
den Produktionswert wieder her, und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe anstatt über die
Befehlszeile, wo `ps` und Ihre Shell-History ihn anzeigen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird verworfen. `rebase_cloud_env_set` des MCP-Servers setzt
Werte auf diese Weise.

`env set KEY --prompt` fragt den Wert über eine verdeckte Eingabeaufforderung in Ihrem Terminal ab.
Es wird nichts ausgegeben, und der Wert wird wie bei `--stdin --secret` als Secret
gespeichert. Ein Agent kann Ihnen den auszuführenden Befehl vorgeben, sodass der Wert niemals
über den Chat übertragen wird. Ohne Terminal verweigert der Befehl die Ausführung (`input_required`) und verweist
auf `--stdin`.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` fügt Personen hinzu, die bereits über ein Rebase-Konto mit einer
verifizierten E-Mail-Adresse verfügen, genau wie „Add member“ in der Konsole. Sie erhalten sofort
Zugriff und es wird keine E-Mail versendet. Rebase Cloud verschickt derzeit noch keine Einladungen; eine
Person ohne Konto erhält daher keinen Link: Der Befehl bricht mit `no_account` ab und
fordert Sie auf, die Person sich zuerst registrieren zu lassen und den Befehl dann erneut auszuführen. Eine Control Plane,
die Einladungen unterstützt, erstellt stattdessen eine und gibt ihren Link aus (einmalig nutzbar, 7
Tage gültig, kann nur von einem Konto angenommen werden, das diese Adresse verifiziert hat); `invites`
listet diese auf, widerruft sie und versendet sie erneut, und antwortet andernorts mit `not_served`.
`--role` ist `admin` oder `member` (Standard). Niemand wird direkt als `owner` hinzugefügt: Fügen Sie Personen
als Admin hinzu, woraufhin ein Owner sie mit `members role <email> owner` befördern kann.
Das Hinzufügen von Mitgliedern und `invites` erfordern eine `rebase cloud login`-Sitzung;
`REBASE_TOKEN` wird abgelehnt. Beides erfordert die Owner- oder Admin-Rolle; Mitglieder erhalten
einen entsprechenden Hinweis.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Degradieren eines Owners
erfordert einen Owner, und der letzte Owner bleibt stets erhalten. `--org <id>` wählt eine andere
als die aktuell ausgewählte Organisation aus.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
bereitgestellt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder aufgedeckt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Compute-Ressourcen eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe zeigt den `--before`-Cursor für die nächste Seite an. `--json` liefert einen einzelnen Wert:
`{ org, events, nextCursor }`. Hierfür ist die Owner- oder Admin-Rolle der Organisation erforderlich.
Ein Token kann dies nur mit der `audit`-Berechtigung für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die **Activity**-Seite der Konsole
zeigt dasselbe Log an.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *darstellt* (kein öffentlicher
Endpunkt), bis Strg+C gedrückt wird; `--reveal` gibt das Passwort dazu an. Nur für Owner oder Admins.

## Gäste

Jedes `signInAnonymously()` bei Tests, durch Bots oder bei abgebrochenen Besuchen hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, sodass
niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert eine Zeitspanne mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes` zählt
der Befehl lediglich und löscht nichts. Er verarbeitet Projekte jeder Größe in kleinen
Batches.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile, bei der `is_anonymous` gesetzt ist, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel direkt im DELETE-Statement an,
sodass der Befehl reguläre Konten nicht erfassen kann – selbst wenn sich ein Nutzer kurz
nach der Auflistung registriert hat. `delete` verweigert ein reguläres Konto mit `NOT_ANONYMOUS`.

**Last seen** (Zuletzt gesehen) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, bzw.
wann der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der regelmäßig
wiederkehrt, gilt nicht als alt – egal, wie lange die Erstellung her ist. Beim Löschen eines Gastes
werden dessen Refresh-Tokens und alle weiteren Auth-Zeilen mitgelöscht.

Zeilen in Ihren eigenen Tabellen folgen deren Fremdschlüsseln (Foreign Keys):

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Bleibt erhalten, die Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Bleibt erhalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Bleibt erhalten und enthält eine ID, die nicht mehr existiert |

Prüfen Sie, welche Ihrer Verknüpfungen kaskadieren, bevor Sie `--yes` übergeben: Der Vorgang kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App verwaltet, sodass der Schlüssel niemals auf Ihren
Rechner gelangt. Er erfordert die Owner- oder Admin-Rolle in der Organisation auf einem Projekt, dessen Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Bei einem Projekt mit einer älteren Runtime wird darauf hingewiesen, dass eine neuere Version erforderlich ist.
`rebase users guests --project <slug>` ist derselbe Befehl innerhalb der Projekt-Befehlsfamilie.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Abgleich mit dem, was im Code deklariert ist.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wäre ein Datenverlust durch einen Push. Sie wird beibehalten, gebunden und abgerechnet, bis sie
jemand explizit namentlich per Prune bereinigt.

## Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wird nicht mehr unterstützt: Jedes Backend führt mindestens eine Instanz aus, daher wird
`true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine Tarifstufen
(Plan Tiers): Alles wird ressourcenbasiert abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, Benachrichtigungen, Cluster, Abrechnung und Nutzung

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
ausschließlich `{ "text" }` anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane bezeichnet. `add` gibt
das Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` beendet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger
das Testereignis nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Owner- oder Admin-Rolle. Ein Token verwaltet diese über die
`notifications`-Berechtigung auf Organisationsebene unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` weist dem kundeneigenen
Cluster eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche Registry nutzt ein solcher Cluster die geteilte Registry der Plattform, worauf jeder Deploy in
seinem Log hinweist. Mit einer eigenen Registry pushen Builds mit einem Token für
dieses Konto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
dortigen Images des Projekts. Images,
die das Projekt zuvor in der geteilten Registry gebaut hat, bleiben weiterhin pullbar und stehen als
Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und niemals wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Platform-Admin-Rolle. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und sind ausschließlich für Owner und Admins der Organisation
zugänglich. Ein Token kann darauf sowie auf den Rest von `billing` mit der `billing`-Berechtigung
auf Organisationsebene zugreifen; ein Token, das vor Einführung dieser Berechtigung erstellt wurde, funktioniert
noch für ein Release weiter, gibt jedoch bei jeder Antwort eine Warnung aus. Beträge in `--json` sind in der kleinsten Währungseinheit (Cent) angegeben, exakt so, wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die nutzungsbasierten Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest ab, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
in UTC verbraucht hat: Requests im Vergleich zum inkludierten Kontingent, 5xx-Fehler, die bisherige
Mehrnutzung in Euro sowie für den laufenden Monat eine Hochrechnung bei aktuellem
Tempo (Schätzung). Die Mehrnutzung entspricht der Berechnung des Overage-Reports – genau jener,
die Stripe mitteilt, was abgerechnet werden soll, und die auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use`
ausgewählten Organisation auf sowie die Gesamtsumme. Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest
dies mit der `logs`-Berechtigung auf dem Projekt; `usage org` listet die Projekte auf, für die
das Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher zeigt 0 an), `multi_pod_undercount` (Requests, die bedient wurden, während zwei oder
mehr App-Pods liefen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
über einen Agenten beanspruchtes Projekt zählt erst ab dem Zeitpunkt des Claims) und
`autoscale_not_charged` (Pods liefen oberhalb von `--replicas` und diese Plattform stellt
sie noch nicht in Rechnung). Die Antwort für ein automatisch skaliertes Projekt enthält zudem `autoscale`:
`extraPodSeconds` oberhalb des Basiswerts, `amountEur` zu den jeweiligen Tarifen und `charged`.

## Deploy-Hooks, Alerts und der Rest

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

`domains redirect` wird pro Domain konfiguriert und ist standardmäßig deaktiviert, sodass ein Projekt, das neben seiner Website einen `api.`-Host betreibt, beide beibehält; die Weiterleitung greift, solange die Domain verifiziert und eine andere als primär definiert ist, und gilt niemals für eine Domain, auf der eine App ausgeliefert wird. `deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert haben müssen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Control-Plane-Route noch nicht bereitgestellt ist, antwortet mit `not_served` und nennt diesen Grund. Destruktive Befehle fragen vorher nach und brechen mit `confirmation_required` ab, wenn keine Eingabe möglich ist: übergeben Sie `--yes`.
