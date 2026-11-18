---
sourceHash: 932f7373eaaf4e2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied besteht darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Mandanten und wird schrittweise
freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein freigeschaltetes Konto.
Alles andere auf dieser Website funktioniert auch ohne eines.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Dingen, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Speicher** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach reservierten Ressourcen
statt pro Benutzerplatz (Per-Seat) abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort ausgeführt zu werden.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und der Ausstiegsweg (Escape Hatch) ist real: `rebase build`
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
übernimmt die Sitzung und schreibt sie in `~/.rebase/credentials.json`. Wenn Sie nicht in
der Konsole angemeldet sind, melden Sie sich dort zuerst mit Ihrer bevorzugten Methode an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link
aus, den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Lauf, der eines davon auslässt, bricht mit `input_required` ab, anstatt eines zu
erfinden. **Die Subdomain kann nachträglich nicht mehr geändert werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wählen Sie sie daher mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein separater
`link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin Projekt-ID und
Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält keine Anmeldedaten –
diese liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch zusammen mit dem Code committet, sodass ein geklontes Repository jede
beliebige Control Plane angeben kann. Wenn der Host ausschließlich aus dieser Datei stammt
und weder der plattformeigene ist noch einer, bei dem Sie sich zuvor angemeldet haben,
benennt `login` ihn und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin
gesendet werden. Ohne Terminal oder mit `--json` wird dies mit `unknown_control_plane`
verweigert; übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich
gezielt dort anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder LinkedIn
registriert?** Ihr Konto hat kein Passwort, verwenden Sie daher stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten gültig ist,
und Sie geben ihn an der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt
`rebase cloud login`, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen
voraus, dass die Control Plane E-Mails senden kann; falls nicht, meldet `--code` dies und
bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem
Code aus Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig davon,
wie Sie sich angemeldet haben. Über den Browser fragt die Konsole bei der dortigen Anmeldung danach. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden.
Erstellen Sie für ein Skript ein Access Token in der Konsole (**Settings → Access tokens**)
und setzen Sie `REBASE_TOKEN`; siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und denselben zwei Wegen zur Anmeldung,
da die häufigste Ursache ein Konto ist, das nie ein Passwort besessen hat.

`billing setup` verknüpft einmalig eine Zahlungskarte mit der Organisation. Es steht absichtlich
an erster Stelle der Abfolge: Das erste Deployment eines Projekts wird ohne Zahlungskarte
abgelehnt, und dies erst nach Abschluss des Bundle-Uploads festzustellen, wäre die schlechtere
Reihenfolge.

Danach listet die **Billing**-Seite der Konsole die Rechnungen der Organisation auf, jeweils mit
Stripes gehosteter Seite und PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus.
Beides ist für Eigentümer und Administratoren der Organisation gedacht. Wo die Plattform es
anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die Karte, die Abrechnungsdetails
und frühere Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der
Konsole keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt.
Wird die Karte abgelehnt oder verlangt die Bank eine Bestätigung der Zahlung, führt Sie die
Konsole zu **Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the
payment** die Rechnung von Stripe öffnet.

Die Ressourcennutzung eines Projekts wird in seiner Übersicht unter **Usage this month** angezeigt
sowie für alle Projekte gleichzeitig auf der Seite **Billing**: Anfragen im Vergleich zum
enthaltenen Freikontingent (der Balken wird bei 80 % bernsteinfarben), 5xx-Fehler, die bisherige
Mehrnutzung (Overage) und die Hochrechnung für den restlichen Monat bei diesem Tempo. Die
Mehrnutzung wird von demselben Code berechnet, der sie an Stripe meldet, entspricht also genau
dem Betrag auf der Rechnung; sie erscheint auf der Rechnung des Folgemonats. `rebase cloud usage`
gibt dasselbe aus, und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied
kann dies einsehen. Die Zahlen weisen darauf hin, was noch nicht erfasst wird: Objektspeicher
wird nicht gemessen, daher wird keine Speicher-Mehrnutzung abgerechnet; solange ein Projekt
zwei oder mehr App-Pods ausführt, werden dessen Anfragen nicht gezählt; und ein Tag mit
fehlenden Messwerten zählt zu wenig. Ein automatisch skaliertes Projekt zeigt außerdem die über
`--replicas` hinaus ausgeführten Pods in Pod-Stunden an, was diese zu den jeweiligen Tarifen
kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein von einem Agenten übernommenes
(geclaimtes) Projekt zählt nur die Tage ab der Übernahme: Davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds
deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird
beim Durchlauf bestätigt (`rebase.json declares runtime: managed — deploying a bundle`), baut
die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus
und verfolgt das Deployment bis zu einem finalen Zustand. Der Exit-Code ist das Ergebnis,
sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends
gab `ok` zurück, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn
die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig
60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deploy dennoch
mit Exit-Code 0 beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an,
welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen
mit einer einzigen Zeile, die die App und den Grund nennt, wobei `rebase cloud logs` das
vollständige Build-Protokoll liefert.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud`
schaltet `deploy` bei einer Pipe nicht automatisch auf JSON um.

Was diese Runtime zulässt – Pakete und native Module, Arbeitsspeicher und Instanzen, Timeouts
und Body-Größen, das Dateisystem, Secrets, Speicher und ausgehender Netzwerkverkehr – wird
auf einer eigenen Seite beschrieben:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein zuvor erstelltes Artefakt auszuliefern – etwa ein CI-Job, der einmal baut und zweimal
deployt –, verweisen Sie auf das Verzeichnis, anstatt es neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes
fordert dazu auf: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben
würde, das es dann selbst besitzt, wird abgelehnt, bis Sie dies explizit angeben. `--force`
bedeutete früher dies, was die am wenigsten umkehrbare Aktion der CLI unter dasselbe Wort
wie „diese Datei überschreiben“ stellte; heute ist es eine unbekannte Option statt eines Alias,
sodass ein Skript, das sie verwendet, stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie sind. Wenn ihr `build`
lediglich handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine
Datei mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder
statischen App sowie jedes Inline-`<script>` in ihren `.html`-Dateien. Dies deckt sowohl
eigenständig bereitgestellte statische Apps als auch statische Apps ab, die in das Bundle
des Backends integriert sind. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei,
Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht
als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und alle anderen
Nicht-JavaScript-`type`s, ein `<script src>` sowie ein Skript, das noch ungerendertes Template-Markup
wie `{{ }}` enthält. Eine `.js`-Datei gilt als gültig, wenn sie sich entweder als klassisches
Skript oder als Modul parsen lässt, da die Seite entscheidet, was davon zutrifft. Unter
`node_modules` wird nichts gelesen, ebenso wenig ein vorgefertigtes `--bundle-dir`.
`--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Verfolgen:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist, arbeitet
die Plattform tatsächlich und Polling ist der richtige Weg; wenn dort etwas benannt wird,
wartet dieses Etwas auf Sie.

Eines davon ist `email_not_configured`: Die App hat die Anmeldung per Magic Link oder
E-Mail-Code (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) aktiviert und verfügt über keinen E-Mail-Dienst,
sodass das Deployment zwar live ist, sich aber niemand damit anmelden kann. Rebase Cloud
versendet keine E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
und `SMTP_FROM` mit `rebase cloud env set` und deployen Sie anschließend. `status` liest dies
aus dem app-eigenen `GET /api/auth/config` (dem Feld `unavailable`), und `deploy` meldet
dasselbe bei seiner Live-Prüfung.

## Vorschau einer Änderung

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` ausführen würde, stellt es jedoch unter
einer eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktion
liefert weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die
Vorschau-Adresse aus, sobald der Build abgeschlossen ist.

Um dieselbe Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview.
Ein erneutes Deployment unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** stellt eine Vorschau des Backends bereit, inklusive der
  integrierten statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf
  einer **eigenen leeren Datenbank**, niemals auf der Produktionsdatenbank. Ein Start gegen die
  Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview darauf anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der
  Vorschau zeigen, deren Seiten das **Produktions**-Backend aufrufen. Dies erfordert eine
  Control Plane, die statische Websites eigenständig ausliefert, was Rebase Cloud derzeit
  noch nicht unterstützt: Es verweigert dies mit `PREVIEW_STATIC_UNSERVED` und veröffentlicht
  nichts. Nutzen Sie stattdessen die Vorschau für das Backend, das die darin integrierten
  statischen Apps ausliefert; ein Projekt ohne verwaltetes Backend kann derzeit noch nicht in
  der Vorschau angezeigt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da jeder
dieser Schritte das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht
mit `--preview` kombiniert werden. Beide erstellen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und ermöglicht das Öffnen,
Einsehen des Build-Protokolls oder Löschen jeder einzelnen. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer
neuen Preview kann ein bis zwei Minuten dauern, sodass ein erfolgreiches Deployment melden kann,
dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität),
anteilig für die Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag des
Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag pro
Monat dafür aus (`cost` unter `--json`). Das Starten erfordert eine hinterlegte Zahlungskarte,
genau wie ein Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor irgendetwas
ausgeführt wird, wird entfernt statt in Rechnung gestellt. Ein Projekt darf bis zu drei
Backend-Previews gleichzeitig ausführen.

Jede neue Vorschau-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, das einer
Domain 50 neue Zertifikate pro Woche gestattet, geteilt mit jeder Produktions-Website darauf.
Previews dürfen plattformweit bis zu 20 davon innerhalb von jeweils 7 Tagen beanspruchen.
Darüber hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`) unter Angabe
des Zeitpunkts, ab dem sie bereitgestellt werden kann; das erneute Deployen einer bereits
existierenden Preview zählt niemals dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem Postgres der **Produktion**:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10 Verbindungen begrenzt,
damit Previews nicht die Verbindungen der Produktion aufbrauchen, und auf 2 GB: Eine Preview,
deren Datenbank darüber hinaus wächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet
nicht mehr, `rebase cloud previews` und die Konsole zeigen sie als `paused` mit dem Grund an,
und die Eigentümer und Administratoren des Projekts werden benachrichtigt (`preview.paused`).
Ihre Daten bleiben erhalten, bis sie abläuft. Deployen Sie sie erneut, um sie zu starten (sie
wird erneut pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte
Preview wird weiterhin abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews,
die Sie nicht mehr benötigen. In der Produktion installierte Erweiterungen werden nicht in der
Datenbank einer Preview installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die diese noch nicht unterstützt,
verweigert `--preview` mit `previews_unavailable` und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments
und führt niemals einen Rebuild durch – der Wert eines Rollbacks besteht darin, dass ein Artefakt
ausgeliefert wird, das bereits gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt deployt wird; beide Arten
funktionieren:

| Wie bereitgestellt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, auf der das Projekt derzeit läuft |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy`
bei einem Projekt mit Backend), sind Teil dieses Bundles und werden daher zusammen mit ihm zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch
nicht zurückgesetzt werden. Ihr Deployment zeichnet zwar auf, welche App veröffentlicht wurde,
aber kein Bundle, sodass die Control Plane nichts hat, woraus sie wiederhergestellt werden
könnte. Die Lösung besteht darin, die letzte funktionierende Version erneut zu deployen,
beispielsweise aus dem Commit vor dem fehlerhaften. Nach einem solchen Deployment weist `deploy`
darauf hin, anstatt auf `rollback` zu verweisen, und `rollback` ohne ID bricht ab, anstatt das
aktuell aktive Backend erneut bereitzustellen.

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert die geeigneten Deployments, und `--json` meldet pro Zeile `rollbackable` zusammen mit
dem `image` oder `bundle`, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: eines, das nicht
erfolgreich war, und eines aus der Zeit, bevor die Plattform Artefakte aufzeichnete. In keinem
der beiden Fälle gibt es Raum für Vermutungen – ein Raten würde das ausliefern, was zuletzt
gebaut oder hochgeladen wurde, während behauptet wird, dieses wiederherzustellen; deployen Sie
stattdessen die gewünschte Version.

Jedes erfolgreiche Deployment endet mit dem Hinweis auf den Weg zurück (`rebase cloud rollback`),
sodass dieser genau in dem Moment sichtbar ist, in dem ein fehlerhaftes Release auffällt.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzudrehen, und wartet
darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird.
Verfolgen Sie dies mit `rebase cloud logs -f`.

## Datenbank auf einen bestimmten Zeitpunkt wiederherstellen (PITR)

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
zurückgesetzt werden – über **Database → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zuerst wird eine wiederhergestellte Kopie neben der
Live-Datenbank bereitgestellt (gestaged); Ihre App läuft auf der Live-Datenbank weiter,
und der Speicherplatz der Kopie wird abgerechnet, bis Sie den Cutover durchführen oder
sie verwerfen.
Sobald die Kopie bereit ist, verweist der Cutover die App darauf und startet sie neu.
Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten.
Die ursprüngliche Datenbank bleibt als Rückfallebene erhalten und wird weiterhin für den
Speicher abgerechnet; ein Zurückwechseln, das Entfernen oder eine zweite Wiederherstellung
erfolgt über den Support. Nur ein Eigentümer oder Administrator kann stagen, den Cutover
durchführen oder verwerfen, und die Konsole fragt vor dem Cutover nach dem Projektnamen.

## Ihr Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungsdaten –
schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar
in der Konsole (oder rufen Sie `/account` auf). Diese Seite gehört Ihnen persönlich, nicht
einer Organisation: Was Sie dort festlegen, gilt für jede Organisation, der Sie angehören.

- **Zwei-Schritt-Verifizierung.** Aktivieren Sie diese mit einer beliebigen Authentifikator-App
  (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum
  Hinzufügen zur App oder einen Link, der die App auf einem Smartphone mit vorausgefülltem
  Schlüssel öffnet, und fragt anschließend nach dem 6-stelligen Code aus der App. Ab diesem
  Zeitpunkt erfordert jede Anmeldung einen Code, egal ob Sie sich mit Passwort, Google oder
  GitHub anmelden.
- **Wiederherstellungscodes.** Das Aktivieren liefert zehn Einmalcodes, die einmalig angezeigt
  werden. Jeder davon ermöglicht die Anmeldung anstelle des Authentifikator-Codes, falls Sie
  Ihr Telefon verlieren; speichern Sie diese daher, bevor Sie den Dialog schließen. **New recovery
  codes** ersetzt sie, wodurch die alten ungültig werden. Sowohl das Deaktivieren der
  Zwei-Schritt-Verifizierung als auch das Abrufen neuer Codes erfordern zunächst die Eingabe
  eines Codes.
- **Passwort.** Das Ändern meldet Sie auf allen anderen Geräten ab. Ein mit Google, GitHub oder
  LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an, Ihnen einen Link per E-Mail
  zu senden, um eines festzulegen.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist,
  mit Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte oder alle Geräte auf einmal ab.

[Access Tokens](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern
keinen zweiten Faktor, sodass CI nach der Aktivierung weiterhin deployen kann. Widerrufen Sie
ein Token, dem Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

**Members → Invite member** liefert einen Link zum Kopieren (der per E-Mail versendet wird, wenn
diese Control Plane E-Mails unterstützt), der einmalig für 7 Tage für ein Konto gültig ist, das
diese Adresse verifiziert hat; niemand tritt bei, bevor die Einladung angenommen wurde. Laden Sie
einen Admin oder ein Mitglied ein und ernennen Sie sie nach dem Beitritt zum Eigentümer. Eigentümer
und Administratoren können Einladungen unter **Pending invitations** einsehen, erneut senden oder
widerrufen; im Terminal über [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Nachvollziehen, wer was getan hat

Die Seite **Activity** der Konsole und `rebase cloud activity` zeigen den Eigentümern und
Administratoren der Organisation, wer wann bereitgestellt hat, eine Umgebungsvariable gesetzt
oder aufgedeckt hat (nach Name, niemals nach Wert), eine Domain geändert hat, ein Backup
wiederhergestellt hat, ein Projekt in der Größe verändert, gestoppt oder gelöscht hat, die Rolle
eines Mitglieds geändert hat oder ein Token erstellt hat. Die **Settings** eines Projekts verlinken
auf die jeweils eigenen Einträge; ein Eintrag zu einem gelöschten Projekt bleibt erhalten. Ein
Skript kann dies mit einem Token auslesen, das mit `--can audit` für die Organisation erstellt
wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter sind in
[`rebase cloud`](/docs/cli/cloud/#organizations) beschrieben.

## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Weisen Sie ihm stattdessen ein
Token zu, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist. Erstellen Sie es über
ein angemeldetes Terminal mit `rebase cloud tokens create --project shop --can deploy,logs` und
setzen Sie es als `REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die
Benachrichtigungseinstellungen einer Organisation sind eigene Berechtigungen (`--can billing`,
`audit`, `notifications`), die ein Token nur dann besitzt, wenn sie explizit angefordert werden.
Die Berechtigungen, ein GitHub-Actions-Workflow und was einer angemeldeten Person vorbehalten
bleibt, finden Sie unter [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, mit der die Person es dauerhaft übernehmen kann;
ein Projekt, das niemand innerhalb von 72 Stunden übernimmt, wird gelöscht. Welche Aktionen das
Token des unbeanspruchten Projekts ausführen darf, was das geschriebene `REBASE_API_TOKEN`
beinhaltet und was sich durch die Übernahme ändert, ist unter
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) beschrieben.

## Compute und die Kosten

Die Preise eines Projekts richten sich nach den reservierten Ressourcen, nicht nach Tarifen.
`compute` gibt jeden Parameter und das detaillierte Angebot der Control Plane dafür aus.
(`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code
deklariert, und ob jede Komponente bereitgestellt ist – siehe [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `100m` und `384Mi`, mit Bursting auf bis zu 2 CPUs und `2Gi` |
| `--replicas` | Instanzen, die dauerhaft existieren: die Untergrenze des Autoscalers und das, was das Projekt-Abonnement monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen gemessen und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** gibt Auskunft darüber. `--no-autoscale` deaktiviert dies |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger und wird ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Parameter ist nicht dasselbe wie ein auf denselben Wert fixierter: Ein leerer Parameter
folgt dem Plattform-Standard und passt sich an, wenn dieser sich ändert.

Die CLI validiert absichtlich nichts – die Grenzwerte gehören zu dem Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt einen Wert ab,
den sie nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um die
monatlichen Kosten in € vor und nach der Änderung zu sehen; Änderungen werden sofort wirksam
und ab heute anteilig berechnet – mit Ausnahme von Änderungen, die einen Neustart der Datenbank
erfordern, welcher auf ein Wartungsfenster wartet.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI aktuell senden würde, nützlich für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agenten, jeweils auf ein Projekt eingegrenzt. Siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude ihn neben Ihren Cloud-Projekten erreichen kann. `--list` listet sie auf, `--remove` entfernt einen. Eigentümer und Admins |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto und ein Link zur Übernahme; `claim` gibt diesen Link erneut aus. Siehe [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird einmalig angezeigt), widerrufen. |
| `previews` | Builds, die über `deploy --preview` unter einer eigenen Adresse bereitgestellt werden, sowie deren Löschung. Siehe [Preview a change](#vorschau-einer-änderung) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederaufnahme. Ein gestopptes Projekt behält sein Abonnement bei, es sei denn, die Plattform berechnet für gestoppte Projekte nur den Speicherplatz und die Plattformgebühr; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies der Fall ist |
| `status`, `metrics`, `debug` | Was es gerade tut und warum es nicht funktioniert |
| `alerts` | Die offenen Vorfälle des Projekts sowie das Bestätigen oder Zurückstellen (Snooze) eines Vorfalls. |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist nur schreibbar |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Eigentümer und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin-Schlüssel für die eigene API der App: Wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Eigentümer und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` erwarten die jeweilige Domain, was nur weggelassen werden darf, wenn es nur eine gibt (bei `verify` eine noch ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` wählt die kanonische Domain und `redirect <domain>` leitet eine andere mit einem 308-Redirect darauf weiter, wobei Pfad und Query erhalten bleiben (`--off` liefert sie wieder direkt aus) – tun Sie dies für `www.` neben einer Apex-Domain, da Google-Sign-in, Cookies und Passkeys pro Origin gelten. Eine Domain, unter der eine bestimmte App bereitgestellt wird (ein App-`path` mit Hostname), leitet niemals weiter. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anhängen oder erstellen, vom eigenen Rechner aus verbinden, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen hinterlassen wurden: zählen, einzelne löschen, diejenigen bereinigen, die seit langer Zeit inaktiv sind. Siehe [Guests](/docs/cli/cloud/#guests). Eigentümer und Admins |
| `extensions` | Die Allowlist für Postgres-Erweiterungen |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, im Abgleich mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `events` | Was am Backend geschehen ist, neueste zuerst: Skalierung der App, geplante und angewendete Datenbankänderungen, Übernahme durch ein Standby-System, Speicherplatzvergrößerung |
| `usage` | Im laufenden Monat verbrauchte Anfragen im Vergleich zum enthaltenen Freikontingent und die bisherige Mehrnutzung, wie auf der Rechnung erfasst. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Administratoren |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder sowie Einladungen, Abrechnung |
| `activity` | Das Audit-Log der Organisation: Wer wann bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Eigentümer und Admins. Siehe [See who did what](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Wohin die Events des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige HTTPS-URL ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – einer
Nutzungszeile, ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein
automatisierter Test prüft den Index dieser Seiten; wird eine Gruppe ohne Hilfeseite hinzugefügt,
schlägt der Build fehl, anstatt das Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die
Tabelle selbst mit diesem Index ab: Jede von der CLI bereitgestellte Gruppe taucht hier genau
einmal auf, sodass eine Gruppe, die ohne Zeile hinzugefügt wird, den Build ebenfalls fehlschlagen lässt.

Wird die Ausgabe weitergeleitet (gepiped), antwortet `--help` stattdessen in JSON: dieselbe
Nutzungszeile, Flags und Beispiele als lesbare Datenstruktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und offen gesagt, denn es später herauszufinden, ist ärgerlicher:

- **Keine freie Regionswahl.** Derzeit läuft alles in einer einzigen Region. Das Placement-Modell
  existiert in der Plattform, ein Projekt kann die Region jedoch nicht frei wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie halten fest, zu welchem der registrierten Deployment-Ziele der Control Plane ein Projekt
  gehört – da es aktuell nur eines gibt, fallen beide standardmäßig darauf zurück und keines
  verschiebt ein Projekt an einen anderen Ort. `rebase cloud projects create --help` weist
  ebenfalls darauf hin.
- **Kein Self-Service.** Der Zugang wird schrittweise in Batches gewährt; es gibt keine direkte
  Registrierung mit anschließender Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, geben Sie dies
  bitte bei der Zugangsbeantragung an, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine First-Party-GitHub-App. Deploy Hooks – geheime URLs,
  auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierung.
  [Preview deploys](#vorschau-einer-änderung) werden schrittweise eingeführt und über die CLI gestartet.
- **Tokens agieren als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird
  von einem Benutzerkonto ausgestellt und handelt in dessen Namen; es gibt noch keine
  organisationsbezogene Maschinen-Identität. Wenn Sie sich stattdessen über CI anmelden,
  übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store –
  `--password` legt das Passwort in Ihrer Shell-Historie und in der Prozesstabelle ab und
  weist darauf hin, bevor es Sie anmeldet. Wenn die `.rebase/cloud.json` des Repositorys eine
  andere Control Plane als die plattformeigene benennt, übergeben Sie diese ebenfalls über `--url`:
  Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden, der nur in der
  ausgecheckten Datei angegeben wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das
  Internet freigegeben, sodass der in der Konsole angezeigte Host die interne Adresse Ihres
  Backends dafür darstellt und auf Ihrem lokalen Rechner zu nichts auflöst. `rebase cloud db connect`
  öffnet einen lokalen Port, der diese Datenbank repräsentiert – getunnelt über die Control Plane,
  solange der Befehl läuft. Es gibt jedoch keinen dauerhaften Hostnamen, zu dem ein
  Drittanbieterdienst eine Verbindung aufbauen könnte. Um SQL ohne lokalen Postgres-Client
  auszuführen, öffnet `rebase cloud db query "<sql>"` oder `rebase cloud db query --file file.sql`
  denselben Tunnel für eine Abfrage, führt den Text als einzelnes Skript aus (und stoppt beim
  ersten Fehler) und gibt die Antwort jeder Anweisung aus (`--json` für Skripte). Sowohl dieser
  Tunnel als auch das Passwort hinter `rebase cloud db info --reveal` erfordern die Rolle
  Eigentümer oder Administrator der Organisation: dieselbe, die auch der SQL-Editor von Studio
  voraussetzt, da alle drei Zugriffswege in einer Sitzung auf Ihren Produktionsdaten enden.
- **Ein Deployment führt Code mit den Produktions-Secrets aus.** Die Umgebung der App enthält
  `REBASE_SERVICE_KEY` (Admin-Berechtigung auf ihrer eigenen API), `DATABASE_URL` und
  `JWT_SECRET`, sodass von Mitgliedern bereitgestellter Code diese auslesen kann – selbst wenn
  nur Eigentümer und Administratoren sie in der Konsole im Klartext einsehen können. Laden Sie
  nur Personen als Mitglieder ein, denen Sie diese Werte anvertrauen würden.
- **Der Service-Key kann ausgetauscht werden.** Die **Settings** des Projekts
  (oder `rebase cloud service-key rotate`) erstellen einen neuen `REBASE_SERVICE_KEY`
  und starten die App damit neu. Der alte Schlüssel funktioniert noch, bis der Neustart
  abgeschlossen ist, danach jedoch nicht mehr, sodass alle Systeme, die ihn kopiert haben,
  ab diesem Moment abgewiesen werden. Das Übernehmen (Claimen) eines Projekts bewirkt dasselbe.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) stellt dieselbe Topologie über das
Helm-Chart bereit.
