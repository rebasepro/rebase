---
sourceHash: ea9a6d9deb4ba31b
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Auth, Projektverknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe den
[Rebase Cloud guide](/docs/deployment/cloud/) für Details darüber, was es ist und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` agiert auf
ein Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Weiterleitung per Pipe, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung einer
bestimmten Control-Plane (oder `REBASE_CLOUD_URL`) und `--project, -p <id>`.

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
(`--project` oder das verknüpfte Projekt) sowie `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte Organisation. Ein Token darf auch ausschließlich Organisations-Berechtigungen enthalten.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen umfassen, steht unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Wenn die Control-Plane
eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Es gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Sie sind entweder bereits in der Konsole angemeldet oder melden sich mit
einer der angebotenen Methoden an (Passwort, Google, GitHub, LinkedIn). Überprüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert nur einmal. Ohne Terminal oder mit `--json` werden Link und Code
an stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
verweigerte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control-Plane
Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; über den Browser bestätigen Sie dies über eine
Konsolensitzung, die diesen verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access tokens erstellt wurde.
Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Die Organisationsbefehle (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) wirken sich auf `--org <id>` aus, andernfalls auf die
Organisation, die mit `cloud use` ausgewählt wurde, andernfalls auf die Organisation des verknüpften Projekts. In
diesem letzten Fall geben sie an, welche Organisation verwendet wurde. `orgs delete` übernimmt dies niemals aus
der Verknüpfung: Es erfordert `--org` oder eine ausgewählte Organisation.

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in
`.env` zu schreiben. Ein erneutes Ausführen ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt zurück, ohne zu warten. Nur für Owner und Admins.

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
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bevor es unbeansprucht gelöscht
wird (`Unclaimed: deleted in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde, und zwar in `~/.rebase/credentials.json`; die Control-Plane
speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
die Control-Plane, ob das projekteigene Token noch funktioniert. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim`
die Ausführung mit `already_claimed`, anstatt einen ungültigen Link auszugeben. Es verweigert die Ausführung auch, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt unbeansprucht ist.

`projects transfer` verschiebt ein Projekt unverändert in eine andere Organisation:
dieselbe ID, Adresse, benutzerdefinierte Domains, Datenbank, Speicher, Umgebungsvariablen und
Bereitstellungen. Nur Eigentümer, Sichtbarkeit und Abrechnung ändern sich. Sie
müssen Owner oder Admin beider Organisationen sein und über `rebase cloud login` angemeldet sein;
ein Zugriffstoken kann ein Projekt nicht verschieben. Die Zielorganisation wird von da an abgerechnet;
eine Organisation ohne hinterlegte Zahlungskarte (die nicht intern abgerechnet wird) verweigert den Umzug daher, und
nichts ändert sich. Ein Projekt, das noch darauf wartet, geclaimt zu werden, wird stattdessen über seinen Claim-Link
verschoben. Die Konsole bietet dieselbe Aktion unter den Settings des Projekts in der
Danger Zone.

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
rebase cloud sleep [status|on|off|wake]  # sleep when idle; `on --after 15m|30m|1h|4h`
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` ohne App-Namen stellt das Backend bereit. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – alles, was von Git getrackt wird, niemals eine `.env` –, damit ein
Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` stoppt dies und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein Plattform-Upgrade kann eine verwaltete App auf einem neueren `@rebasepro`-Release
neu bauen, als in Ihrem Checkout festgelegt ist. Ein Deploy aus diesem Checkout würde das ältere Admin-Panel
und den älteren Treiber wiederherstellen, daher wird er verweigert, bevor etwas gebaut wird, zusammen mit dem
Befehl zur Behebung (`rebase upgrade --to <version>`). `rebase cloud status`
zeigt dies bereits früher an: eine `Rebuilt on`-Zeile und unter `--json` die Werte
`runtime.platformRebuiltVersion` sowie `frameworkDrift`.

Ein verfolgter `deploy`-Vorgang endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, die
Deployment-ID, die benötigte Zeit und die Information, ob die neue Version dort antwortet. Er
wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung), bis `/health`
eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagener Deploy
endet mit einer Zeile, die die App und den Grund nennt, und gibt einen Exit-Code ungleich null zurück. Die Zusammenfassung
wird auch bei Weiterleitung über eine Pipe ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`. Ein Host, dessen HTTPS-Zertifikat
noch nicht ausgestellt wurde, wird mit diesem Grund als nicht live gemeldet.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die bereitgestellt wird:
die `.js`/`.mjs`/`.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
ihrem HTML. Ein Syntaxfehler stoppt den Deploy mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreicher
Deploy endet mit dem Rückweg: `rebase cloud rollback`. Eine statische App, die einzeln
bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktionsumgebung unberührt. Eine Vorschau des Backends führt ein eigenes Backend auf einer
eigenen, leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud noch nicht einzeln in der Vorschau angezeigt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` verweigert und veröffentlicht nichts. Eine Backend-Vorschau
wird für die Dauer ihrer Existenz als eine zusätzliche App-Einheit in Standardgröße abgerechnet, und
der Deploy gibt an, was dies pro Monat kostet, basierend auf dem Kostenvoranschlag der Control-Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control-Plane den Preis nicht
ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Vorschau, die von der Plattform pausiert wurde (die Datenbank ist über das Vorschaulimit hinaus gewachsen),
als `paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Vorschauadresse
kann mit `preview_cert_budget` verweigert werden, wenn das wöchentliche Budget der Plattform für
Vorschau-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` folgt einem noch laufenden
Build im Tail-Modus. `--runtime` liest stattdessen aus, was die App ausgibt, und zwar von jedem Pod
dahinter, wobei jede Zeile den jeweiligen Pod benennt, wenn mehr als einer geschrieben hat:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw                 # the lines exactly as the pods wrote them
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine Zeitangabe nach RFC3339.
- `--tail <n>` gibt die Zeilenanzahl pro Pod an, mit der begonnen werden soll (die Control-Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- Mit `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control-Plane
  für das Zeitfenster zurückgibt (die neuesten 2000 jedes Pods), und `--tail` zählt übereinstimmende
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod mehr
  Zeilen im Zeitfenster hatte, weist die Ausgabe darauf hin, dass die älteren nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  die strukturierte `severity`, die ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  einfachen Zeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne diese Angaben werden ausgelassen.
- Eine strukturierte Zeile wird lesbar ausgegeben: `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"` und ein Request als `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` gibt jede Zeile stattdessen genau so aus, wie der Pod sie geschrieben hat; Nur-Text-Zeilen werden in beiden Fällen unverändert ausgegeben, und `--json` enthält immer die Originalzeilen.

Ein Follow-Vorgang pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Er meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, gibt er auch die letzten
Zeilen der beendeten Instanz aus, in denen sich meist der Grund findet. Er wartet, solange kein
Pod läuft, und nach einem Verbindungsabbruch versucht er es mit Backoff erneut und
setzt dort fort, wo er aufgehört hat. Mit `--json` gibt ein Follow-Vorgang ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Vorschau anstelle der Produktion. Verwenden Sie den
Namen der Vorschau oder die Deployment-ID, die ein Preview-Deploy ausgegeben hat. Alleine ausgeführt
liest `--preview` die einzige Vorschau des Projekts. Eine statische Vorschau hat ein Build-Log, aber kein
Runtime-Log, da sie keinen Server betreibt.

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

`domains add` für einen Host, den das Projekt bereits besitzt – wie etwa ein Host, den ein Deploy
über `rebase.json` registriert hat –, gibt die DNS-Einträge und den Status dieses Hosts wie bei einem
neu hinzugefügten Host aus; `--json` ergänzt `alreadyRegistered: true`. Ein verifizierter Host wird
über HTTPS bereitgestellt, sobald sein Zertifikat ausgestellt wurde, wenige Minuten nach
der Verifizierung. Bis dahin antwortet der Ingress mit einem Platzhalterzertifikat,
und `domains list`, `domains verify` sowie `status` zeigen
`verified, certificate pending` statt live an. Die CLI ermittelt dies über
einen TLS-Handshake zu jedem verifizierten Host; `--json` überträgt dies als `certificate`
(`ready`, `pending` oder `unreachable`, mit einem `reason`).

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` auf der App generiert und in `.env` als
`REBASE_API_TOKEN` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Claimen des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` generiert einen neuen Schlüssel und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App
erstellt wurden, bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung gewährt diesen Zugriff.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um auf den neuesten Schlüssel umzustellen. Der Schlüssel
selbst wird nie ausgegeben: Dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
stellt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Dies wird verweigert, während ein Deploy
läuft, und erfordert Ihr Login. Das Claimen eines Projekts rotiert auch
dessen Service-Key.

Eine Backend-Vorschau verfügt über einen eigenen Service-Key. Ihr erster Deploy erstellt ihn,
erneute Deploys behalten ihn bei, und der Schlüssel der Produktionsumgebung antwortet in der Vorschau mit 401.
`service-key --preview <name>` gibt ihn aus, ebenso wie `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
schreibt einen neuen Schlüssel und startet nur den Pod dieser Vorschau neu; der alte Schlüssel funktioniert, bis
der neue Pod bereit ist. Es erfolgt zunächst eine Sicherheitsabfrage; `--yes` überspringt diese. Beide fordern
die gleichen Berechtigungen wie `env reveal`: die Owner- oder Admin-Rolle der Organisation und bei einem
Zugriffstoken die `env`-Berechtigung für ein geclaimtes Projekt. Schlüssel und
Pod der Produktion bleiben unberührt.

Eine Backend-Vorschau startet mit den Variablen der Produktionsumgebung, einschließlich Live-Keys.
`env set KEY=VALUE --preview` gibt Vorschauen einen eigenen Wert, `env unset KEY
--preview` schließt die Variable von ihnen aus, `env reset KEY --preview` setzt
sie auf den Wert der Produktion zurück, und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn sichtbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird entfernt. `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

`env set KEY --prompt` fragt den Wert über eine verdeckte Eingabeaufforderung in Ihrem Terminal ab.
Es wird nichts angezeigt, und der Wert wird als Secret gespeichert, genau wie bei `--stdin
--secret`. Ein Agent kann Ihnen den auszuführenden Befehl vorgeben, sodass der Wert niemals
über den Chat übertragen wird. Ohne Terminal wird dies verweigert (`input_required`) und
auf `--stdin` verwiesen.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` fügt Personen hinzu, die bereits ein Rebase-Konto mit einer
verifizierten E-Mail-Adresse haben, genau wie „Add member“ in der Konsole. Sie erhalten sofort
Zugriff, und es wird keine E-Mail versendet. Rebase Cloud verschickt derzeit noch keine Einladungen;
Personen ohne Konto erhalten daher keinen Link: Der Befehl bricht mit `no_account` ab und
fordert Sie auf, die Person sich zuerst registrieren zu lassen und den Befehl dann erneut auszuführen. Eine Control-Plane,
die Einladungen unterstützt, erstellt stattdessen eine Einladung und gibt deren Link aus (einmalig nutzbar, 7
Tage gültig, kann nur von einem Konto akzeptiert werden, das diese Adresse verifiziert hat); `invites`
listet diese auf, widerruft sie oder sendet sie erneut und antwortet andernfalls mit `not_served`.
`--role` ist `admin` oder `member` (Standard). Niemand wird als `owner` hinzugefügt: Fügen Sie Personen
als Admin hinzu, und ein Owner stuft sie mit `members role <email> owner` hoch.
Das Hinzufügen von Mitgliedern und `invites` erfordert eine `rebase cloud login`-Sitzung;
`REBASE_TOKEN` wird abgelehnt. Beide erfordern die Owner- oder Admin-Rolle; Mitgliedern
wird dies mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Herabstufen eines Owners
erfordert einen Owner, und der letzte Owner bleibt bestehen. `--org <id>` wählt eine andere als die
aktuell ausgewählte Organisation.

### Project access

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` verwaltet, wer auf ein Projekt zugreifen kann – entweder auf das verknüpfte Projekt oder auf `--project`.
Die Owner und Admins einer Organisation sind `admin` in jedem Projekt, das sie besitzt, und
ihre Mitglieder sind `developer`; `access` weist jemandem eine Rolle ausschließlich für dieses Projekt zu,
unabhängig davon, ob die Person der Organisation angehört. Die effektive Rolle ist die
höhere der beiden, und `access` listet sie zusammen mit ihrer Herkunft auf. `admin` umfasst
alles, einschließlich Zugriff und Einstellungen; `developer` führt Deploys durch und nutzt Studio,
Logs und die Umgebungsvariablen; `viewer` hat Lesezugriff.

`invite` erstellt eine Einladung zum Projekt (`--role` ist standardmäßig `developer`)
und gibt deren Link aus: einmalig nutzbar, 7 Tage gültig, kann nur von einem Konto
akzeptiert werden, das diese Adresse verifiziert hat. `role` und `remove` ändern oder entfernen die
projekteigene Rolle und fragen vorher nach (`--yes` überspringt dies); jemand, der über die
Organisation Zugriff auf das Projekt hat, wird über `orgs members remove` entfernt.
Der Verlust der `admin`-Rolle in einem Projekt entzieht der Person auch die `admin`-Rolle innerhalb der App,
die über **Open admin panel** vergeben wurde, und beendet deren dortige Sitzungen. Jede
Änderung erfordert eine `rebase cloud login`-Sitzung sowie `admin`-Rechte für das Projekt; eine
Control-Plane ohne Projektzugriffsunterstützung antwortet mit `not_served`.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
deployed, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder aufgedeckt hat (nach Name,
niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
das Compute eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite fasst bis zu 100 Einträge (`--limit`, Standard 50); die
Ausgabe druckt den `--before`-Cursor für die nächste Seite. `--json` ist ein einzelner Wert:
`{ org, events, nextCursor }`. Es erfordert die Owner- oder Admin-Rolle der Organisation.
Ein Token kann dies nur mit der `audit`-Berechtigung für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die Seite **Activity** der Konsole
zeigt dasselbe Protokoll an.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db query [sql] [--file <path>]
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der bis Strg-C direkt die verwaltete Datenbank *ist* (kein
öffentlicher Endpunkt); `--reveal` gibt das Passwort dazu an. Nur für Owner oder Admins.

`db query` führt SQL auf der verwalteten Datenbank aus und gibt das Ergebnis jedes Statements aus,
ohne lokales `psql`: Es öffnet denselben Tunnel für die Dauer einer Abfrage. Eine Datei mit mehreren
Statements wird als einzelnes Skript ausgeführt und stoppt beim ersten Fehler; es wird keine Transaktion hinzugefügt –
umschließen Sie die Datei daher mit `BEGIN`/`COMMIT`, um sie als Alles-oder-Nichts auszuführen.
`COPY … FROM STDIN` wird abgelehnt. Nur für Owner oder Admins. Mit
`--json` wird `{ projectId, results: [{ command, rowCount, rows }] }` ausgegeben.

`db connect`, `db query` und `db backup` akzeptieren `--database <key>` für eine
der [anderen Datenbanken](/docs/backend/multiple-sources/) des Projekts – den `key` einer
`database("<key>")`-Deklaration. Ohne diesen Parameter wirken sie sich auf die Standarddatenbank aus.

## Guests

Jedes `signInAnonymously()` in einem Test, durch einen Bot oder bei einem abgebrochenen Besuch hinterlässt
eine Zeile in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie,
sodass niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert eine Zeitspanne mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt der Befehl nur und löscht nichts. Er arbeitet Projekte beliebiger Größe
in kleinen Batches ab.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile, bei der `is_anonymous` gesetzt ist, ohne
Passwort und ohne verknüpfte Identität. Die App wendet diese Regel direkt in der Anweisung an, die die
Zeile löscht, sodass der Befehl kein echtes Konto erfassen kann – selbst wenn sich dieses einen Moment
nach dem Listing registriert hat. `delete` weist ein reguläres Konto mit `NOT_ANONYMOUS` ab.

**Zuletzt gesehen** (**Last seen**) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder
der Erstellungszeitpunkt des Gastes, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder
zurückkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens eines gelöschten Gastes
und alle weiteren Auth-Zeilen werden mitgelöscht.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, der Standard) | Bleibt erhalten, die Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, der Standard) | Bleibt erhalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Bleibt erhalten und enthält eine ID, die nicht mehr existiert |

Prüfen Sie vor der Angabe von `--yes`, welche Ihrer Verknüpfungen kaskadieren: Dies kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App verwaltet, sodass der Schlüssel niemals Ihren
Rechner erreicht. Er erfordert einen Owner oder Admin der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Bei einem Projekt mit einer älteren Runtime wird darauf hingewiesen, dass eine neuere erforderlich ist.
`rebase users guests --project <slug>` ist derselbe Befehl in der Projekt-Befehlsfamilie.

## Resources

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt eine bereitgestellte Datenbank niemals, wenn deren Deklaration entfernt wird – das
wären Daten, die durch einen Push gelöscht würden. Die Plattform behält sie bei, bindet sie ein und rechnet sie ab, bis
jemand sie namentlich per Prune bereinigt.

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
wird `true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine
Tarifstufen (Plans): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
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
ausschließlich `{ "text" }` anstelle des vollständigen Event-JSON, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein positionsbezogenes Argument, da `--url` die Control-Plane benennt. `add` gibt
das Signatur-Secret einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` beendet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger das
Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Owner- oder Admin-Rolle. Ein Token verwaltet sie mit der
`notifications`-Berechtigung auf der Organisation unter Einhaltung derselben Rollenregel. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` weist dem eigenen
Cluster eines Kunden eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird.
Ohne diese verwendet ein solcher Cluster die gemeinsame Registry der Plattform, und jeder Deploy darauf
weist im Log darauf hin. Mit einer Registry pushen Builds mit einem Token für
dieses Dienstkonto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Images des Projekts dort. Images,
die das Projekt zuvor in der gemeinsam genutzten Registry erstellt hat, bleiben pullbar und stehen weiterhin als
Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Platform-Admin-Rolle. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registriert Kapazität, die von Rebase betrieben wird: Projekte,
die in dieser Region platziert sind, deployen dorthin, sobald deren Baseline bereit ist. Die Region wird
Kunden damit noch nicht angeboten. `--open-to-customers` bietet sie bereits bei der Registrierung an, oder später
über `clusters open <id-or-name>`; `clusters close <id-or-name>` stoppt das Angebot.
Operatoren können auf einem geschlossenen Cluster deployen. Belassen Sie einen Cluster im geschlossenen Zustand, solange seine
Basis-Domain mit einem anderen Cluster geteilt wird: Bis der Wildcard-Eintrag umgezogen ist, lösen seine
Hostnamen nur über explizite Records auf (`ingress.<baseDomain>`,
`s3.<baseDomain>` und einer pro Projekt), und `clusters add` gibt aus, welche Records
hinzugefügt werden müssen. Wenn die Domain geteilt wird, warnt `open`, dass der Wildcard-Record bereits
auf den Cluster zeigen muss. Es erfolgt keine interaktive Abfrage, sodass es in Skripten funktioniert.

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und stehen ausschließlich Ownern und Admins der
Organisation offen. Ein Token greift darauf und auf den Rest von `billing` mit der `billing`-Berechtigung
auf Organisationsebene zu; ein Token, das vor dieser Berechtigung erstellt wurde, funktioniert noch
für ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Währungseinheit (Cents) angegeben, genau wie
Stripe sie übermittelt. Entwurfsrechnungen (Draft Invoices) werden nicht aufgeführt; die Vorschau wird von
Stripe berechnet und ihre verbrauchsabhängigen Zeilen wachsen weiter, bis der Abrechnungszeitraum endet.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
verbraucht hat (in UTC): Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherigen
Mehrkosten (Overage) in Euro und für den laufenden Monat eine Hochrechnung bei aktuellem
Verlauf (eine Schätzung). Die Overage entspricht der Berechnung des Overage-Berichts selbst – jener,
die Stripe mitteilt, was abgerechnet werden soll, und die auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation sowie die
Gesamtsumme auf. Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest dies mit der
`logs`-Berechtigung für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher zeigt 0 an), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten geclaimtes Projekt zählt nur die Tage ab dem Claim) und
`autoscale_not_charged` (Pods liefen über `--replicas` und diese Plattform berechnet
sie noch nicht). Die Antwort für ein automatisch skaliertes Projekt enthält zudem `autoscale`:
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

`domains redirect` gilt pro Domain und ist standardmäßig deaktiviert, sodass ein Projekt, das neben seiner Website einen `api.`-Host bedient, beide behält; die Weiterleitung wird aktiv, wenn die Domain verifiziert ist und eine andere als primär festgelegt wurde, und gilt niemals für eine Domain, auf der eine App ausgeliefert wird. `deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control-Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert benötigen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Control-Plane-Route noch nicht bereitgestellt ist, antwortet mit `not_served` und nennt diese. Destruktive Befehle fragen vorher nach und verweigern die Ausführung mit `confirmation_required`, wenn niemand antworten kann: Übergeben Sie `--yes`.
