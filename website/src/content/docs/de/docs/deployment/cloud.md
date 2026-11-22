---
sourceHash: 6a1d65000e50846a
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Tenants und
wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es handelt sich nicht um Self-Service, daher erfordern die folgenden Befehle ein Konto, das
bereits freigeschaltet wurde. Alles andere auf dieser Website funktioniert auch ohne.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Dingen, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image ausgeführt wird. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Database** | Ein verwaltetes PostgreSQL mit automatischen Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigenes Bucket, falls Ihr Projekt Dateispeicher verwendet |

Die App und die Datenbank werden beim ersten Deployment bereitgestellt; ein Bucket erst
dann, wenn Sie eines anfordern ([Dateispeicher](#dateispeicher)). Jedes wird nach den reservierten
Ressourcen und nicht pro Benutzer/Sitzplatz abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und der Notausstieg (Escape Hatch) ist real: `rebase build`
erzeugt ein Bundle, das überall startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie,
ob die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und schreibt sie in `~/.rebase/credentials.json`. Wenn Sie
nicht in der Konsole angemeldet sind, melden Sie sich dort zuerst mit Ihrer bevorzugten Methode an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link
aus, den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` nimmt kein Positionsargument entgegen. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Lauf, der eines davon auslässt, wird mit `input_required` beendet, anstatt einen
zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist, wählen Sie sie also mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein separater
`link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin Projekt-ID
und Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten –
diese befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch zusammen mit dem Code committet, sodass ein geklontes Repository jede
beliebige Control Plane benennen kann. Wenn der Host nur aus dieser Datei stammt und es
sich weder um den plattformeigenen Host noch um einen handelt, bei dem Sie sich zuvor angemeldet haben,
benennt `login` diesen und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden.
Ohne Terminal oder mit `--json` bricht der Befehl mit `unknown_control_plane` ab;
übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder
LinkedIn registriert?** Ihr Konto hat kein Passwort, verwenden Sie daher stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist,
und Sie geben ihn an der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt
`rebase cloud login`, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes erfordern,
dass die Control Plane E-Mails versenden kann; ist dies nicht der Fall, meldet `--code` dies
und wird mit `otp_unavailable` beendet.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus
Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes – unabhängig davon, wie Sie sich angemeldet haben.
Über den Browser fragt die Konsole bei der Anmeldung danach. Weder ein Anmeldecode noch ein zweiter Faktor
können ohne Terminal eingegeben werden. Erstellen Sie für ein Skript ein Zugriffstoken in der Konsole
(**Settings → Access tokens**) und setzen Sie `REBASE_TOKEN`; siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und zeigt dieselben zwei Wege an,
da die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` verknüpft einmalig eine Kreditkarte mit der Organisation. Es steht absichtlich
an erster Stelle der Abfolge: Das erste Deployment eines Projekts wird ohne Zahlungskarte abgelehnt,
und dies erst nach dem vollständigen Upload eines Bundles festzustellen, wäre die schlechtere Reihenfolge.

Danach listet die **Billing**-Seite der Konsole die Rechnungen der Organisation auf,
jeweils mit Stripes gehosteter Seite und PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts an. `rebase cloud billing invoices` und `rebase cloud billing upcoming`
geben dasselbe aus. Beides ist für Eigentümer und Admins der Organisation gedacht. Wo die
Plattform dies anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die
Karte, die Rechnungsdaten und vergangene Rechnungen.

Wenn bereits eine Karte hinterlegt ist, wird beim Erstellen eines weiteren Projekts in der Konsole
keine zweite Zahlung verlangt: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wenn die Karte
abgelehnt wird oder die Bank eine Zahlungsbestätigung verlangt, führt die Konsole Sie zu
**Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the
payment** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in dessen Übersicht unter **Usage this month** angezeigt
und für jedes Projekt gleichzeitig auf der **Billing**-Seite: Anfragen im Vergleich zum
enthaltenen Kontingent (der Balken wird bei 80 % gelb), 5xx-Fehler, der bisherige Mehrverbrauch
und die Hochrechnung für den restlichen Monat bei diesem Tempo. Der Mehrverbrauch wird von
demselben Code berechnet, der ihn an Stripe meldet, entspricht also genau dem Betrag auf der Rechnung;
er erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus, und
`rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen.
Die Zahlen geben an, was sie noch nicht erfassen können: Objektspeicher wird nicht gemessen,
daher wird kein Speicher-Mehrverbrauch abgerechnet; solange ein Projekt zwei oder mehr App-Pods ausführt,
werden dessen Anfragen nicht gezählt; und ein Tag mit fehlenden Messwerten zählt zu wenig. Ein
automatisch skaliertes Projekt zeigt auch die Pods an, die es über `--replicas` hinaus ausgeführt hat (in Pod-Stunden),
was sie zu den eigenen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein
von einem Agent beanspruchtes (geclaimtes) Projekt zählt nur die Tage ab dem Claim: davor gehörte
das Projekt der Plattform.

Ein bestehendes Projekt kann verknüpft werden, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Ein Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration aus –
dies wird währenddessen ausgegeben (`rebase.json declares runtime: managed — deploying a bundle`),
baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem Endzustand. Der Exit-Code
ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: `/health` eines Backends
gab `ok` zurück, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn
die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig
60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird der Deploy dennoch mit Exit-Code
0 beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht geantwortet
hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen in einer einzigen Zeile, die die App und den
Grund nennt, wobei `rebase cloud logs` das vollständige Build-Protokoll bereitstellt.

Skripte übergeben `--json` für ein einzelnes Objekt, das dieselben Fakten enthält – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von
`rebase cloud` wechselt `deploy` bei einer Pipe nicht automatisch zu JSON.

Was diese Runtime zulässt – Pakete und native Module, Arbeitsspeicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Speicher und ausgehende
Netzwerkverbindungen – wird auf einer eigenen Seite beschrieben:
[Managed Backend Runtime](/docs/deployment/managed-runtime/).

Um ein zuvor erstelltes Artefakt bereitzustellen – etwa bei einem CI-Job, der einmal baut und
zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der Managed Runtime erfolgt über ein eigenes Flag, `--eject`, und nichts anderes
fordert dies an: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es
dann selbst besitzt, wird abgelehnt, bis Sie dies explizit angeben. Früher bedeutete `--force` dies,
womit die am wenigsten umkehrbare Aktion der CLI unter demselben Wort wie „diese Datei überschreiben“
lag; inzwischen ist dies eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet,
stattdessen stoppt.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build`
lediglich handgeschriebene Skripte in `output` kopiert, wurden sie von nichts geparst, und eine Datei
mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen
App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl eine einzeln bereitgestellte
statische App ab als auch statische Apps, die in das Bundle des Backends integriert sind. Ein Syntaxfehler
stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser
nicht als JavaScript ausführt, werden übersprungen: JSON, Import-Maps, Templates und jeder
andere Nicht-JavaScript-`type`, ein `<script src>` sowie ein Skript, das noch
ungerendertes Template-Markup wie `{{ }}` enthält. Eine `.js`-Datei besteht die Prüfung, wenn sie sich
entweder als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, worum es sich handelt.
Unterhalb von `node_modules` wird nichts gelesen, ebenso wenig in einem vorgefertigten `--bundle-dir`.
`--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Beobachten:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet die
Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas angegeben ist, wartet
dieses Etwas auf Sie.

Eines davon ist `email_not_configured`: Die App hat die Anmeldung per Magic Link oder E-Mail-Code
aktiviert (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`), verfügt jedoch über keinen E-Mail-Dienst, sodass
das Deployment zwar live ist, sich aber niemand darüber anmelden kann. Rebase Cloud versendet keine
E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und
`SMTP_FROM` mit `rebase cloud env set` und führen Sie dann das Deployment durch. `status` liest dies aus dem
app-eigenen `GET /api/auth/config` (dessen Feld `unavailable`) aus, und `deploy` meldet dasselbe
bei seiner Live-Prüfung.

## Dateispeicher

Ein neues Projekt hat kein Bucket: Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgelehnt,
und die Deployment-Zusammenfassung weist darauf hin, anstatt dass Daten auf eine Festplatte geschrieben werden, die bei jedem Deployment ersetzt wird.

Weisen Sie ihm eine von zwei Arten zu und führen Sie dann erneut ein Deployment durch, damit die App dies übernimmt:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` listet die Buckets des Projekts auf. Ein Projekt mit mehreren
bindet jedes über `--source <key>` an; ein Projekt, das Storage im Code konfiguriert, benötigt keines von beidem.

## Eine Änderung in der Vorschau anzeigen

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` verarbeiten würde, liefert es jedoch unter einer
eigenen Adresse aus, z. B. `https://shop--k3x9ab.rebase.website`. Die Produktion liefert weiterhin das aus,
was sie zuvor ausgeliefert hat. Das Deployment gibt die Adresse der Preview aus, sobald der
Build abgeschlossen ist.

Um eine Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview. Ein erneutes
Deployment unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** zeigt eine Vorschau des Backends einschließlich der integrierten
  statischen Apps an, genau so, wie die Produktion sie ausführt. Es erhält ein eigenes Backend auf
  einer **eigenen leeren Datenbank**, niemals auf der Produktionsdatenbank. Das Starten gegen
  die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview darauf anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der Vorschau
  anzeigen, deren Seiten das **Produktions**-Backend aufrufen. Dies erfordert eine Control Plane,
  die statische Websites eigenständig ausliefert, was Rebase Cloud derzeit noch nicht unterstützt: es
  bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Zeigen Sie stattdessen eine
  Vorschau des Backends an, welches die darin integrierten statischen Apps ausliefert; ein Projekt
  ohne verwaltetes Backend kann derzeit noch nicht in der Vorschau angezeigt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da jedes
davon das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit
`--preview` kombiniert werden. Beide erstellen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und ermöglicht das Öffnen,
Einsehen des Build-Protokolls oder Löschen der einzelnen Previews. Das Erstellen bleibt ein Schritt in der CLI.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer
neuen Preview kann ein bis zwei Minuten dauern, sodass ein erfolgreiches Deployment melden kann,
dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität),
anteilig für die Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag des
Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag dafür
pro Monat aus (`cost` unter `--json`). Zum Starten ist eine hinterlegte Zahlungskarte erforderlich,
genau wie bei einem Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor irgendetwas
ausgeführt wird, wird entfernt statt abgerechnet. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, das pro
Domain 50 neue Zertifikate pro Woche zulässt, geteilt mit jeder darauf betriebenen Produktions-Website.
Previews dürfen plattformweit 20 davon innerhalb von jeweils 7 Tagen beanspruchen. Darüber hinaus
wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem sie
wieder bereitgestellt werden kann; das erneute Deployment einer bereits vorhandenen Preview zählt nie dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf der **Produktions**-Postgres-Instanz:
mit eigenen Daten, aber auf derselben Instanz und derselben Festplatte. Sie ist auf 10 Verbindungen
begrenzt, sodass Previews nicht die Verbindungen der Produktion aufbrauchen können, sowie auf 2 GB:
Eine Preview, deren Datenbank darüber hinaus wächst, wird pausiert. Ihr Backend stoppt, ihre Adresse
antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie als `paused` mit dem entsprechenden
Grund an, und die Eigentümer und Admins des Projekts werden benachrichtigt (`preview.paused`). Ihre Daten
bleiben bis zum Ablauf erhalten. Führen Sie erneut ein Deployment durch, um sie zu starten (sie wird erneut pausiert,
solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird weiterhin abgerechnet,
bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. In der Produktion
installierte Erweiterungen werden nicht in der Datenbank einer Preview installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die diese noch nicht unterstützt,
lehnt `--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback durchführen

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand, den ein früheres erfolgreiches Deployment
ausgeliefert hat, und baut niemals neu – der Wert eines Rollbacks liegt darin, dass ein
Artefakt ausgeliefert wird, das bereits erfolgreich gelaufen ist.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird; beide
Varianten funktionieren:

| Wie bereitgestellt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt jetzt ausführt |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy`
bei einem Projekt mit Backend), sind Teil dieses Bundles und werden daher zusammen mit ihm zurückgerollt.

Eine einzeln bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht
zurückgerollt werden. Ihr Deployment zeichnet auf, welche App veröffentlicht wurde, aber kein Bundle,
sodass die Control Plane keine Grundlage hat, aus der sie wiederhergestellt werden könnte. Die Lösung
besteht darin, die letzte funktionierende Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem
fehlerhaften. Nach einem solchen Deployment weist `deploy` hierauf hin, anstatt auf `rollback` zu verweisen,
und `rollback` ohne ID verweigert die Ausführung, anstatt das aktive Backend erneut bereitzustellen.

Ein Rollback benötigt also ein Deployment, das eines von beiden aufgezeichnet hat, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
kennzeichnet diejenigen, die dafür infrage kommen, und `--json` meldet pro Zeile `rollbackable`
zusammen mit dem `image` oder `bundle`, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: eines, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform dessen Artefakt aufgezeichnet hat. In beiden Fällen gibt es
nichts zu erraten – ein Erraten würde dasjenige ausliefern, was zuletzt gebaut oder hochgeladen wurde,
während behauptet würde, dieses wiederherzustellen –, stellen Sie daher stattdessen die gewünschte
Version bereit.

Jedes erfolgreiche Deployment endet mit der Nennung des Rückwegs (`rebase cloud rollback`),
sodass dieser in dem Moment im Blickfeld ist, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Versionshistorie zurückzuspulen, und
wartet, bis die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird.
Verfolgen Sie dies mit `rebase cloud logs -f`.

## Die Datenbank zu einem bestimmten Zeitpunkt wiederherstellen

Eine verwaltete Datenbank kann über **Database → Backups** in der Konsole oder über
die CLI auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters wiederhergestellt werden:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zuerst wird eine wiederhergestellte Kopie neben der Live-Datenbank
bereitgestellt (gestaged); Ihre App läuft auf der Live-Datenbank weiter, und der Speicher der Kopie
wird abgerechnet, bis Sie den Cutover durchführen oder sie verwerfen.
Sobald die Kopie bereit ist, leitet der Cutover die App darauf um und startet sie neu.
Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche
Datenbank bleibt als Rückweg erhalten und wird weiterhin für den Speicher abgerechnet; das Zurückwechseln,
Entfernen oder eine zweite Wiederherstellung erfolgt über den Support. Nur ein Eigentümer oder Admin
kann stagen, den Cutover durchführen oder verwerfen, und die Konsole verlangt vor dem Cutover
den Projektnamen zur Bestätigung.

## Ihr Konto sichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und die Abrechnung;
schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar
in der Konsole (oder gehen Sie zu `/account`). Diese Seite gehört Ihnen, nicht einer
Organisation: Was Sie dort festlegen, gilt in jeder Organisation, der Sie angehören.

- **Zwei-Schritt-Verifizierung (Two-step verification).** Aktivieren Sie diese mit einer beliebigen Authentifikator-App (1Password,
  Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen zur App oder einen
  Link, der die App auf einem Smartphone mit vorausgefülltem Schlüssel öffnet, und fragt anschließend nach dem
  6-stelligen Code, den die App anzeigt. Von da an erfordert jede Anmeldung einen Code,
  unabhängig davon, ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes (Recovery codes).** Beim Aktivieren erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden.
  Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authentifikator-Codes, falls Sie Ihr
  Telefon verlieren; speichern Sie diese also, bevor Sie das Dialogfenster schließen. **New recovery codes**
  ersetzt sie, woraufhin die alten ihre Gültigkeit verlieren. Sowohl das Deaktivieren der Zwei-Schritt-Verifizierung
  als auch das Anfordern neuer Codes verlangen zuerst die Eingabe eines Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über
  Google, GitHub oder LinkedIn erstelltes Konto besitzt kein Passwort; die Seite bietet an,
  Ihnen einen Link per E-Mail zu senden, um eines festzulegen.
- **Angemeldete Geräte (Signed-in devices).** Jeder Browser und jedes Terminal, das an Ihrem Konto angemeldet ist,
  mit seiner Adresse und dem Anmeldezeitpunkt. Melden Sie unbekannte Geräte ab,
  oder alle auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern keinen zweiten
Faktor, sodass CI nach der Aktivierung weiterhin Deployments durchführen kann. Widerrufen Sie ein Token, dem Sie nicht mehr
vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

**Members → Add member** fügt eine Person hinzu, die bereits über ein Rebase-Konto mit
bestätigter E-Mail-Adresse verfügt, entweder als Admin oder als Mitglied; ein Eigentümer kann sie nachträglich
zum Eigentümer ernennen. Sie haben sofort Zugriff und es wird keine E-Mail versendet. Da Rebase Cloud derzeit
noch keine Einladungen per E-Mail verschickt, bitten Sie Teammitglieder ohne Konto, sich zuerst zu registrieren
und ihre Adresse zu bestätigen. Über das Terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), was
darauf hinweist, wenn für die Adresse kein Konto existiert.

## Sehen, wer was getan hat

Die Seite **Activity** in der Konsole und `rebase cloud activity` zeigen den
Eigentümern und Admins der Organisation, wer wann ein Deployment durchgeführt, eine Umgebungsvariable
gesetzt oder offengelegt (nach Namen, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt,
die Größe eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert
oder ein Token erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag
zu einem gelöschten Projekt bleibt erhalten. Ein Skript kann diese mit einem Token lesen, das mit
`--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter finden Sie in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie stattdessen ein Token, das auf
wenige Aktionen für ein Projekt beschränkt ist und von einem angemeldeten Terminal aus mit
`rebase cloud tokens create --project shop --can deploy,logs` erstellt wurde, und setzen Sie es als
`REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen einer
Organisation sind eigenständige Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur dann besitzt, wenn sie explizit angefordert wurden. Die Berechtigungen, ein
GitHub-Actions-Workflow und was einer angemeldeten Person vorbehalten bleibt, finden Sie unter
[CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stattet eine App mit einem Live-Backend aus, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, mit der die Person es übernehmen kann; ein Projekt, das
innerhalb von 72 Stunden von niemandem beansprucht (geclaimt) wird, wird gelöscht. Welche Aktionen das
Token des unbeanspruchten Projekts ausführen darf, was das geschriebene `REBASE_API_TOKEN` bewirkt und was sich durch
das Claiming ändert, wird unter [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) beschrieben.

## Compute und die Kosten

Die Preisgestaltung eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach einem Tarifmodell (Tier).
`compute` gibt jeden Stellwert und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob sie jeweils bereitgestellt sind – siehe die [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Stellwert | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard, welcher von der Region abhängt (unten) |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was das Abonnement des Projekts monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen gemessen und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** gibt Aufschluss darüber. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, gemessen am Request statt am Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger und wird ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Stellwert ist nicht dasselbe wie ein auf denselben Wert fixierter: Ein leerer Stellwert
folgt dem Plattformstandard und passt sich an, wenn dieser sich ändert.

In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi und kann kurzzeitig auf
2 CPU und 2 GiB ansteigen (Burst); in Falkenstein und Helsinki kann der Arbeitsspeicher auf das 1,4-fache
des Requests und die CPU auf das 10-fache (maximal 1,7 vCPU) anwachsen. `rebase cloud compute` zeigt die Werte
Ihres Projekts an.

Von der CLI wird absichtlich nichts validiert – die Limits gehören zu dem Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt einen Wert ab, den sie
nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um die
€/Monat vor und nach der Änderung zu sehen; eine Änderung gilt ab sofort, anteilig ab heute berechnet.
Eine Datenbankänderung wird sofort angewendet; abgerechnet wird die bisherige Größe, bis sie läuft.
Eine neue CPU- oder Arbeitsspeichergröße der Datenbank oder weniger Instanzen starten die Datenbank neu
(ca. 30 Sekunden bis 3 Minuten; Verbindungen werden getrennt und neu aufgebaut): `compute set`
weist darauf hin und fragt nach; außerhalb eines Terminals dient `--yes` als Zustimmung. Schlägt
dieser Neustart fehl, unternimmt `rebase cloud compute apply` einen erneuten Versuch.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt den Bearer aus, den die CLI jetzt senden würde, für Skripte und den MCP-Server |
| `tokens` | Token für CI und Agents, jeweils auf ein Projekt beschränkt. Siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Binden dieses Verzeichnisses an ein Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, sodass der [Rebase-Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude ihn neben Ihren Cloud-Projekten erreicht. `--list` zeigt sie an, `--remove` entfernt einen. Für Eigentümer und Admins |
| `init`, `claim` | Mit `--claim`: ein Live-Backend ohne Konto und ein Link, um es zu beanspruchen (claimen); `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, Auflisten, Überprüfen, Löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird einmalig angezeigt), widerrufen. |
| `previews` | Builds, die von `deploy --preview` unter einer eigenen Adresse ausgeliefert werden, und deren Löschung. Siehe [Eine Änderung in der Vorschau anzeigen](#eine-änderung-in-der-vorschau-anzeigen) |
| `sleep` | Bei Inaktivität in den Ruhezustand versetzen: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` und `status` (Standard). Im Ruhezustand belegt ein Projekt weder CPU noch Arbeitsspeicher, und die nächste Anfrage weckt es auf; geplante Jobs und Hintergrundaufgaben laufen währenddessen nicht. Wo ein Projekt nicht schlafen kann, verweigert die Control Plane dies und begründet es |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme. Ein gestopptes Projekt behält sein Abonnement bei, es sei denn, die Plattform stellt für gestoppte Projekte nur Speicher und Plattformgebühr in Rechnung; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies der Fall ist |
| `status`, `metrics`, `debug` | Was es tut und warum es das nicht tut |
| `alerts` | Die offenen Vorfälle des Projekts sowie das Bestätigen oder Zurückstellen (Snooze) eines Vorfalls. |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist Write-only |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der beim Claim übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Für Eigentümer und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin auf der App-eigenen API: wann er zuletzt rotiert wurde; `rotate` vergibt einen neuen an die App. Für Eigentümer und Admins |
| `domains` | Eigene Domains, die hinzuzufügenden DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, von denen jede einzeln verifiziert wird; `verify` und `remove` nehmen die Domain entgegen, auf die eingewirkt werden soll, was nur weggelassen werden darf, wenn es nur eine gibt (für `verify`: eine noch ausstehende). Jede verifizierte Domain liefert das Projekt als sie selbst aus; `primary <domain>` wählt die kanonische Domain und `redirect <domain>` leitet eine andere mit einem 308-Redirect darauf weiter, wobei Pfad und Abfrageparameter beibehalten werden (`--off` liefert sie wieder regulär aus) – tun Sie dies für `www.` neben einer Apex-Domain, da Google-Anmeldung, Cookies und Passkeys pro Origin gelten. Eine Domain, auf der eine einzelne App bereitgestellt wird (ein App-`path` mit Hostname), leitet niemals weiter. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform, und es ist nicht garantiert, dass sie immer gleich bleibt: Wenn die Plattform umzieht, zeigt ein A-Record weiterhin auf die alte Adresse. Wo Ihr DNS-Host ALIAS-, ANAME- oder CNAME-Flattening an der Apex-Domain anbietet, verweisen Sie mit der Apex stattdessen auf den `tenantHost` des Projekts, welcher der Plattform folgt. Der CNAME einer Subdomain folgt ihr bereits. `list` gibt `verified, certificate pending` aus, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen zurückgeblieben sind: zählen, einzelne löschen, lange inaktive bereinigen. Siehe [Gäste](/docs/cli/cloud/#guests). Für Eigentümer und Admins |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Das Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, im Vergleich zu dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `events` | Was am Backend passiert ist, neueste zuerst: Skalierung der App, geplante und angewendete Datenbankänderungen, Übernahme durch ein Standby, Vergrößerung der Festplatte |
| `usage` | Diesen Monat genutzte Anfragen im Vergleich zum enthaltenen Kontingent und der bisherige Mehrverbrauch, wie er auf der Rechnung erfasst wird. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen die Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder sowie Einladungen, Bezahlung |
| `activity` | Das Audit-Protokoll der Organisation: wer ein Deployment durchgeführt, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Für Eigentümer und Admins. Siehe [Sehen, wer was getan hat](#sehen-wer-was-getan-hat) |
| `notifications` | Wohin die Events des Projekts per POST gesendet werden: Slack, Discord oder jede beliebige https-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – einer Verwendungszeile,
ihren Flags und Beispielen –, und `--help` führt den Befehl niemals aus. Ein Test gleicht den
Index dieser Seiten ab, sodass eine ohne Hilfeseite hinzugefügte Gruppe den Build fehlschlagen lässt, anstatt
mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit diesem
Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal; eine Gruppe, die ohne Zeile
hinzugefügt wird, lässt den Build daher ebenfalls fehlschlagen.

Wird die Ausgabe weitergeleitet (piped), antwortet `--help` stattdessen in JSON: dieselbe Verwendungszeile,
Flags und Beispiele als lesbare Struktur anstelle von sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Keine Regionsauswahl, keine Self-Service-Registrierung, kein veröffentlichtes SLA, keine Branch-Deployments,
Token, die als Person agieren, und kein öffentlicher Datenbank-Endpunkt. [Was die Beta
noch nicht enthält](/docs/deployment/cloud-beta-limits/) führt jeden dieser Punkte klar auf,
zusammen mit den Auswirkungen eines Deployments mit den Produktions-Secrets.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) erzeugt dieselbe Topologie aus
dem Helm-Chart.
