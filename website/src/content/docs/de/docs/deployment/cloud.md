---
sourceHash: 325c29335f5ae263
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Tenants und wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein freigeschaltetes Konto. Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image läuft. Deploys sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und danach abgerechnet, was sie reserviert, statt pro Benutzer (Seat).

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository lässt sich mit `docker compose` selbst hosten, und der Notausstieg (Escape Hatch) ist echt: `rebase build` erzeugt ein Bundle, das überall startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie, ob die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal übernimmt die Sitzung und speichert sie in `~/.rebase/credentials.json`. Wenn Sie nicht in der Konsole angemeldet sind, melden Sie sich dort zuerst mit der von Ihnen genutzten Methode an, einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link aus, den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` nimmt kein Positionsargument entgegen. Der Name und die Subdomain sind Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein Headless-Lauf, der eines davon auslässt, bricht mit `input_required` ab, anstatt eines zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der Host `<slug>.rebase.website`, unter dem das Projekt antwortet; wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID und der Slug gespeichert sind. Diese Datei ist kein Geheimnis und enthält keine Anmeldedaten – diese liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und weder der eigene der Plattform ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt `login` diesen und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit `--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder LinkedIn registriert?** Ihr Konto hat kein Passwort, verwenden Sie stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und Sie geben ihn an der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt `rebase cloud login`, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen voraus, dass die Control Plane E-Mails versenden kann; wenn dies nicht der Fall ist, weist `--code` darauf hin und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus Ihrer Authenticator-App oder einem Ihrer Wiederherstellungscodes – unabhängig davon, wie Sie sich angemeldet haben. Über den Browser fragt die Konsole bei der dortigen Anmeldung danach. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden. Für ein Skript erstellen Sie ein Zugriffstoken in der Konsole (**Settings → Access tokens**) und setzen `REBASE_TOKEN`; siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und denselben zwei Anmeldeoptionen, da die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` hinterlegt einmalig eine Kreditkarte für die Organisation. Es steht bewusst an erster Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne hinterlegte Karte verweigert, und dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Danach listet die Seite **Billing** der Konsole die Rechnungen der Organisation auf, jeweils mit Stripes gehosteter Seite und PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus. Beides ist für die Eigentümer und Admins der Organisation bestimmt. Wo die Plattform es anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die Karte, die Rechnungsdaten und vergangene Rechnungen.

Wenn bereits eine Karte hinterlegt ist, erfordert das Erstellen eines weiteren Projekts in der Konsole keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte abgelehnt oder verlangt die Bank eine Bestätigung der Zahlung, führt Sie die Konsole zu **Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the payment** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in dessen Übersicht unter **Usage this month** angezeigt, sowie für alle Projekte gleichzeitig auf der Seite **Billing**: Anfragen im Vergleich zum enthaltenen Kontingent (der Balken wird bei 80 % gelb/orange), 5xx-Fehler, der bisherige Mehrverbrauch (Overage) und wohin sich der Monat bei diesem Tempo entwickelt. Der Mehrverbrauch wird durch denselben Code berechnet, der ihn an Stripe meldet, entspricht also dem Betrag auf der Rechnung; er erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus, und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen. Die Zahlen geben an, was sie noch nicht erfassen können: Objektspeicher wird nicht gemessen, daher wird kein Speicher-Mehrverbrauch berechnet; solange ein Projekt zwei oder mehr App-Pods ausführt, werden dessen Anfragen nicht gezählt; und ein Tag mit verpassten Messungen zählt zu wenig. Ein automatisch skaliertes Projekt zeigt auch die Pods, die über `--replicas` hinaus liefen, in Pod-Stunden an, was diese zu den eigenen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein von einem Agenten übernommenes (claimed) Projekt zählt erst ab dem Tag der Übernahme: Davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird beim Durchlauf gemeldet (`rebase.json declares runtime: managed — deploying a bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Zustand. Der Exit-Code ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends gab `ok` zurück, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deploy dennoch mit Exit-Code 0 beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen mit einer einzelnen Zeile, die die App und den Grund nennt, mit dem Verweis auf `rebase cloud logs` für das vollständige Build-Log.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`, `live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud` wechselt `deploy` bei einer Pipe nicht automatisch zu JSON.

Was diese Runtime erlaubt – Pakete und native Module, Arbeitsspeicher und Instanzen, Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender Netzwerkverkehr – steht auf einer eigenen Seite: [Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das zuvor gebaut wurde – etwa ein CI-Job, der einmal baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der Managed Runtime erfolgt über ein eigenes Flag, `--eject`, und nichts anderes fordert dazu auf: Ein Build, der ein verwaltetes Projekt auf ein Container-Image umstellen würde, das es dann selbst besitzt, wird verweigert, bis Sie dies explizit angeben. Früher bedeutete `--force` genau dies, wodurch die am wenigsten umkehrbare Aktion der CLI unter demselben Begriff wie „diese Datei überschreiben“ stand; mittlerweile ist dies eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet, stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build` lediglich handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine Datei mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also etwas hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl eine einzeln bereitgestellte statische App als auch in das Backend-Bundle integrierte statische Apps ab. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder andere Nicht-JavaScript-`type`, ein `<script src>` sowie ein Skript, das noch ungerendertes Template-Markup wie `{{ }}` enthält. Eine `.js`-Datei besteht die Prüfung, wenn sie sich entweder als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, was davon zutrifft. Unter `node_modules` wird nichts gelesen, ebenso wenig in einem vorab erstellten `--bundle-dir`. `--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Verfolgen:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas angegeben ist, wartet dieses Etwas auf Sie.

Eines davon ist `email_not_configured`: Die App hat Magic-Link- oder E-Mail-Code-Anmeldung (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) aktiviert und verfügt über keinen E-Mail-Dienst, sodass das Deployment zwar live ist, sich aber niemand darüber anmelden kann. Rebase Cloud versendet keine E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und `SMTP_FROM` mit `rebase cloud env set` und deployen Sie anschließend. `status` liest dies aus dem App-eigenen `GET /api/auth/config` (dessen `unavailable`-Feld) aus, und `deploy` weist im Rahmen seines Live-Checks auf dasselbe hin.

## Vorschau einer Änderung {#preview-a-change}

```bash
rebase cloud deploy --preview
```

Dies baut und lädt exakt das hoch, was auch `deploy` ausführen würde, stellt es jedoch unter einer eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktion liefert weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die Vorschau-Adresse aus, sobald der Build abgeschlossen ist.

Um eine feste Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie das Preview. Ein erneutes Deployment mit demselben Namen aktualisiert es:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit ein Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** zeigt eine Vorschau des Backends mit integrierten statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf einer **eigenen leeren Datenbank**, niemals auf der Produktionsdatenbank. Ein Start gegen die Produktionsdatenbank würde das Schema und die Zugriffsregeln des Previews darauf anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der Vorschau zeigen, deren Seiten das **Produktions-Backend** aufrufen. Dafür wird eine Control Plane benötigt, die statische Websites separat ausliefert, was Rebase Cloud derzeit noch nicht unterstützt: Es bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Nutzen Sie stattdessen die Vorschau des Backends, das die darin integrierten statischen Apps ausliefert; ein Projekt ohne verwaltetes Backend kann derzeit nicht als Preview bereitgestellt werden.

Ein Preview lädt keinen Quellcode hoch und registriert weder Apps noch Hostnamen, da jedes davon das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit `--preview` kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und ermöglicht das Öffnen, Einsehen des Build-Logs oder Löschen der einzelnen Einträge. Das Erstellen bleibt ein CLI-Schritt.

Ein Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Vorschau-Adresse antwortet, genau wie bei einem Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat eines neuen Previews kann ein bis zwei Minuten dauern, daher kann ein erfolgreiches Deployment melden, dass die Adresse noch nicht antwortet.

Ein Backend-Preview wird wie eine App-Einheit in der Standardgröße (100m CPU und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität) abgerechnet, anteilig (proratiert) für die Dauer seines Bestehens, und erscheint im monatlichen Kostenvoranschlag des Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag dafür pro Monat aus (`cost` unter `--json`). Das Starten eines Previews erfordert eine hinterlegte Karte, genau wie ein Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor überhaupt etwas ausgeführt wird, wird entfernt statt abgerechnet. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, welches einer Domain 50 neue Zertifikate pro Woche gestattet, geteilt mit jeder Produktions-Site darauf. Previews dürfen plattformweit bis zu 20 davon innerhalb von 7 Tagen beanspruchen. Darüber hinaus wird ein neues Preview abgewiesen (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem es wieder bereitgestellt werden kann; das erneute Deployment eines bereits existierenden Previews zählt dabei nie mit.

Die Datenbank eines Backend-Previews ist eine zweite Datenbank auf dem PostgreSQL-Server der **Produktion**: mit eigenen Daten, aber auf derselben Instanz und derselben Festplatte. Sie ist auf 10 Verbindungen beschränkt, damit Previews nicht die Verbindungen der Produktion aufbrauchen, sowie auf 2 GB: Ein Preview, dessen Datenbank darüber hinaus anwächst, wird pausiert. Dessen Backend stoppt, seine Adresse antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen es als `paused` mit dem entsprechenden Grund an, und die Eigentümer und Admins des Projekts werden benachrichtigt (`preview.paused`). Seine Daten bleiben erhalten, bis es abläuft. Deployen Sie es erneut, um es zu starten (es wird erneut pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie es. Ein pausiertes Preview wird weiterhin abgerechnet, bis es gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. In der Produktion installierte Extensions werden in der Datenbank eines Previews nicht installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die diese noch nicht unterstützt, verweigert `--preview` mit `previews_unavailable` und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf das, was ein vorheriges erfolgreiches Deployment ausgeliefert hat, und baut niemals neu – der Wert eines Rollbacks liegt darin, dass es ein Artefakt ausliefert, das bereits erfolgreich gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird, und beide Varianten funktionieren:

| Wie bereitgestellt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, auf der das Projekt aktuell läuft |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy` bei einem Projekt mit Backend), sind Teil dieses Bundles und werden daher zusammen mit diesem zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht zurückgesetzt werden. Ihr Deployment zeichnet auf, welche App veröffentlicht wurde, aber kein Bundle, sodass die Control Plane keine Basis für eine Wiederherstellung hat. Die Lösung besteht darin, die letzte funktionierende Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem fehlerhaften. Nach einem solchen Deploy weist `deploy` darauf hin, anstatt auf `rollback` zu verweisen, und `rollback` ohne ID bricht ab, anstatt das aktuell laufende Backend erneut bereitzustellen.

Ein Rollback erfordert daher ein Deployment, das eines der beiden aufgezeichnet hat – was ein Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments` markiert die qualifizierten Versionen, und `--json` meldet pro Zeile `rollbackable` zusammen mit dem `image` oder `bundle`, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: eines, das nicht erfolgreich war, und eines aus der Zeit, bevor die Plattform Artefakte aufzeichnete. In keinem der Fälle wird geraten – ein Raten würde bedeuten, das zuletzt Gebaute oder Hochgeladene auszuliefern, während behauptet wird, diese Version wiederherzustellen; deployen Sie stattdessen die gewünschte Version.

Jedes erfolgreiche Deployment endet mit dem Hinweis auf den Rückweg (`rebase cloud rollback`), sodass dieser sofort im Blick ist, sobald ein fehlerhafter Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## Wiederherstellung der Datenbank zu einem bestimmten Zeitpunkt

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters zurückgesetzt werden, über **Database → Backups** in der Konsole oder mit der CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies erfordert zwei Schritte. Zuerst wird eine wiederhergestellte Kopie neben der Live-Datenbank bereitgestellt (staged); Ihre App läuft auf der Live-Datenbank weiter, und der Speicher der Kopie wird abgerechnet, bis Sie den Cutover durchführen oder sie verwerfen.
Sobald die Kopie bereit ist, lenkt der Cutover die App darauf um und startet sie neu. Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche Datenbank bleibt als Rückfallebene erhalten und belegt weiterhin abrechenbaren Speicher; ein Zurückwechseln, Entfernen oder eine zweite Wiederherstellung erfolgt über den Support. Nur ein Eigentümer oder Admin kann bereitstellen, umschalten (cut over) oder verwerfen, und die Konsole fragt vor dem Cutover nach dem Projektnamen.

## Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungen – schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar in der Konsole (oder gehen Sie zu `/account`). Diese Seite gehört Ihnen persönlich, nicht einer Organisation: Was Sie dort einstellen, gilt für jede Organisation, der Sie angehören.

- **Bestätigung in zwei Schritten.** Aktivieren Sie diese mit einer beliebigen Authenticator-App (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen zur App oder einen Link, der die App auf einem Smartphone mit vorausgefülltem Schlüssel öffnet, und fragt anschließend nach dem 6-stelligen Code aus der App. Von da an verlangt jede Anmeldung einen Code, egal ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden. Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authenticator-Codes, falls Sie Ihr Telefon verlieren; speichern Sie diese daher, bevor Sie den Dialog schließen. **New recovery codes** ersetzt diese, und die alten verlieren ihre Gültigkeit. Sowohl das Deaktivieren der Bestätigung in zwei Schritten als auch das Anfordern neuer Codes verlangen zuerst die Eingabe eines aktuellen Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über Google, GitHub oder LinkedIn erstelltes Konto besitzt kein Passwort; die Seite bietet an, Ihnen einen Link per E-Mail zu senden, um eines festzulegen.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist, mit dessen Adresse und dem Anmeldezeitpunkt. Melden Sie unbekannte Geräte oder alle auf einmal ab.

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern keinen zweiten Faktor, sodass CI auch nach der Aktivierung weiterhin deployen kann. Widerrufen Sie Token, denen Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Team einladen

Über **Members → Add member** fügen Sie Personen hinzu, die bereits ein Rebase-Konto mit bestätigter E-Mail-Adresse besitzen – entweder als Admin oder als Mitglied; ein Eigentümer kann sie nachträglich zum Eigentümer ernennen. Sie erhalten sofort Zugriff, und es wird keine E-Mail versendet. Rebase Cloud versendet derzeit noch keine Einladungen; bitten Sie Teammitglieder ohne Konto daher, sich zuerst zu registrieren und ihre E-Mail-Adresse zu bestätigen. Im Terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), was darauf hinweist, falls für die Adresse kein Konto existiert.

## Nachvollziehen, wer was getan hat {#see-who-did-what}

Die Seite **Activity** der Konsole und `rebase cloud activity` zeigen Eigentümern und Admins der Organisation, wer wann bereitgestellt hat, eine Umgebungsvariable gesetzt oder aufgedeckt hat (nur nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt, die Größe eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Token erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag über ein gelöschtes Projekt bleibt erhalten. Ein Skript kann dies mit einem Token auslesen, das mit `--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter finden Sie in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie stattdessen ein Token, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt von einem angemeldeten Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs`, und setzen Sie es als
`REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen einer Organisation sind eigenständige Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur erhält, wenn sie explizit angefordert werden. Die Berechtigungen, ein GitHub-Actions-Workflow und was einer angemeldeten Person vorbehalten bleibt, finden Sie unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, noch bevor sich jemand registriert hat, und gibt eine Claim-URL aus, über die das Projekt dauerhaft übernommen werden kann; ein Projekt, das niemand innerhalb von 72 Stunden beansprucht (claimed), wird gelöscht. Welche Berechtigungen das Token des unbeanspruchten Projekts hat, was das geschriebene
`REBASE_API_TOKEN` bewirkt und was sich durch das Übernehmen ändert, finden Sie unter
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute und die Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen (Tiers). `compute` gibt jeden Regler und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert, und ob diese jeweils bereitgestellt sind – siehe die [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard, der von der Region abhängt (siehe unten) |
| `--replicas` | Instanzen, die dauerhaft existieren: das Minimum des Autoscalers und der monatliche Grundbetrag des Projekt-Abonnements |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen abgerechnet und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** gibt darüber Auskunft. `--no-autoscale` schaltet dies aus |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Unterbrechbare (Preemptible) Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine einzelne Instanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein nicht gesetzter Regler ist nicht dasselbe wie ein auf denselben Wert festgelegter: Ein leerer Regler folgt dem Plattformstandard und passt sich an, wenn sich dieser ändert.

In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi und kann kurzzeitig (burst) auf 2 CPU und 2 GiB ansteigen; in Falkenstein und Helsinki kann der Arbeitsspeicher auf das 1,4-fache des Requests und die CPU auf das 10-fache (maximal 1,7 vCPU) skaliert werden. `rebase cloud compute` zeigt die Werte Ihres Projekts.

Die CLI führt bewusst keine Validierung durch – die Limits hängen vom Cluster ab, auf dem ein Projekt läuft, und unterscheiden sich je nach Provider. Die Control Plane lehnt Werte ab, die sie nicht bedienen kann, und nennt das entsprechende Feld. Führen Sie `rebase cloud compute` aus, um die Kosten in €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort wirksam und ab heute anteilig berechnet. Eine Datenbankänderung wird sofort angewendet und bis zur Fertigstellung in der bisherigen Größe abgerechnet. Eine neue Datenbank-CPU oder ein neuer Arbeitsspeicher bzw. weniger Instanzen starten die Datenbank neu (ca. 30 Sekunden bis 3 Minuten; Verbindungen werden getrennt und neu aufgebaut): `compute set` weist darauf hin und bittet um Bestätigung; außerhalb eines Terminals dient `--yes` als Zustimmung. Schlägt dieser Neustart fehl, versucht `rebase cloud compute apply` es erneut.

## Die weiteren Befehle

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI jetzt senden würde, für Skripte und den MCP-Server |
| `tokens` | Token für CI und Agents, jeweils auf ein einzelnes Projekt beschränkt. Siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreichen kann. `--list` listet sie auf, `--remove` entfernt einen. Eigentümer und Admins |
| `init`, `claim` | Mit `--claim`: ein Live-Backend ohne Konto und ein Link zum Übernehmen; `claim` gibt diesen Link erneut aus. Siehe [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, prüfen, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird nur einmal angezeigt), widerrufen. |
| `previews` | Builds, die von `deploy --preview` unter einer eigenen Adresse bereitgestellt werden, sowie deren Löschung. Siehe [Preview a change](#vorschau-einer-änderung-preview-a-change) |
| `sleep` | Ruhezustand bei Inaktivität: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` und `status` (Standard). Im Ruhezustand belegt ein Projekt weder CPU noch Arbeitsspeicher und die nächste Anfrage weckt es auf; geplante Jobs und Hintergrundaufgaben laufen in dieser Zeit nicht. Wenn ein Projekt nicht in den Ruhezustand versetzt werden kann, verweigert die Control Plane dies mit einer Begründung |
| `start`, `stop`, `restart` | Ein Projekt anhalten und wieder fortsetzen. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte nur Speicher und die Plattformgebühr; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies der Fall ist |
| `status`, `metrics`, `debug` | Was es tut und warum nicht |
| `alerts` | Die offenen Vorfälle des Projekts sowie deren Bestätigung (Acknowledge) oder Zurückstellung (Snooze). |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt (Read-only) |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist schreibgeschützt (write-only) |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in die `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Eigentümer und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin auf der App-eigenen API: wann er zuletzt rotiert wurde; `rotate` vergibt einen neuen an die App. Eigentümer und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains antworten, die jeweils separat verifiziert werden; `verify` und `remove` akzeptieren die zu bearbeitende Domain, die nur dann weggelassen werden darf, wenn es nur eine gibt (bei `verify` eine noch ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` wählt die kanonische Domain und `redirect <domain>` leitet eine andere mit einem 308-Redirect darauf weiter, wobei Pfad und Query erhalten bleiben (`--off` liefert sie wieder direkt aus) – tun Sie dies für `www.` neben einer Apex-Domain, da Google-Anmeldung, Cookies und Passkeys pro Origin gelten. Eine Domain, unter der eine einzelne App ausgeliefert wird (ein App-`path` mit Hostname), leitet niemals weiter. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform und bleibt nicht garantiert immer dieselbe: Zieht die Plattform um, zeigt ein A-Record weiterhin auf die alte Adresse. Wenn Ihr DNS-Anbieter ALIAS, ANAME oder CNAME-Flattening an der Apex-Domain anbietet, verweisen Sie mit der Apex-Domain stattdessen auf den `tenantHost` des Projekts, der der Plattform folgt. Der CNAME einer Subdomain folgt ihr bereits. `list` meldet `verified, certificate pending`, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anhängen oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldung hinterlassen wurden: zählen, einzelne löschen, lange inaktive bereinigen. Siehe [Guests](/docs/cli/cloud/#guests). Eigentümer und Admins |
| `extensions` | Die Allowlist für PostgreSQL-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, im Abgleich mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `events` | Was im Backend passiert ist, neueste zuerst: Skalierung der App, geplante und angewendete Datenbankänderungen, Übernahme durch eine Standby-Instanz, Vergrößerung des Speicherplatzes |
| `usage` | In diesem Monat genutzte Anfragen im Vergleich zum enthaltenen Kontingent und der bisherige Mehrverbrauch, wie er auf der Rechnung erfasst wird. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder und Einladungen, Bezahlung |
| `activity` | Das Audit-Log der Organisation: wer bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Eigentümer und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat-see-who-did-what) |
| `notifications` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige HTTPS-URL ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Verwendungszeile, ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test überwacht den Index dieser Seiten, sodass eine neu hinzugefügte Gruppe ohne Hilfeseite den Build fehlschlagen lässt, anstatt mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal; eine ohne Tabellenzeile hinzugefügte Gruppe führt daher ebenfalls zum Fehlschlagen des Builds.

Wird die Ausgabe weitergeleitet (piped), antwortet `--help` stattdessen in JSON: dieselbe Verwendungszeile, Flags und Beispiele als lesbare Struktur anstelle von sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und offen kommuniziert, denn es erst später herauszufinden, ist ärgerlicher:

- **Keine freie Regionswahl.** Aktuell läuft alles in einer einzigen Region. Das Placement-Modell existiert in der Plattform, aber ein Projekt kann die Region nicht frei wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen: Sie halten fest, zu welchem der registrierten Deployment-Ziele der Control Plane ein Projekt gehört; da es nur eines gibt, greift standardmäßig dieses, und keines der Flags verschiebt ein Projekt an einen anderen Ort. `rebase cloud projects create --help` weist auf dasselbe hin.
- **Kein Self-Service.** Der Zugang wird schrittweise in Batches gewährt; es gibt keine direkte Registrierung mit sofortiger Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, erwähnen Sie dies bei Ihrer Zugangsanfrage, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine offizielle GitHub-App. Deploy-Hooks – geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierungsmethode. [Preview-Deployments](#vorschau-einer-änderung-preview-a-change) werden schrittweise eingeführt und über die CLI gestartet.
- **Token handeln als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird von einem Konto ausgestellt und agiert in dessen Namen; es gibt noch keine organisationsbezogene Maschinen-Identität. Wenn Sie sich stattdessen aus einer CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store – `--password` legt das Passwort in Ihrer Shell-Historie und in der Prozesstabelle ab und weist darauf hin, bevor die Anmeldung erfolgt. Wenn die `.rebase/cloud.json` des Repositorys eine andere Control Plane als die plattforminterne angibt, übergeben Sie diese ebenfalls über `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden, der nur in der ausgecheckten Datei benannt wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das Internet freigegeben; der Host, den die Konsole anzeigt, ist die interne Adresse Ihres Backends dafür und löst auf Ihrem Rechner zu nichts auf. `rebase cloud db connect` öffnet einen lokalen Port zu dieser Datenbank, getunnelt über die Control Plane, solange der Befehl läuft – es gibt jedoch keinen permanenten Hostnamen, mit dem sich ein Drittanbieterdienst verbinden könnte. Um SQL ohne lokalen Postgres-Client auszuführen, öffnet `rebase cloud db query "<sql>"` oder `rebase cloud db query --file file.sql` denselben Tunnel für eine Abfrage, führt den Text als einzelnes Skript aus (und stoppt beim ersten Fehler) und gibt das Ergebnis jedes Statements aus (`--json` für Skripte). Sowohl dieser Tunnel als auch das Passwort hinter `rebase cloud db info --reveal` erfordern die Eigentümer- oder Admin-Rolle der Organisation: dieselbe Rolle, die auch der SQL-Editor von Studio verlangt, da alle drei Zugriffe auf Ihre Produktionsdaten ermöglichen.
- **Ein Deployment führt Code mit den Produktions-Secrets aus.** Die Umgebung der App enthält `REBASE_SERVICE_KEY` (Admin auf der eigenen API), `DATABASE_URL` und `JWT_SECRET`; von einem Mitglied bereitgestellter Code kann diese also auslesen, auch wenn nur Eigentümer und Admins sie in der Konsole im Klartext einsehen können. Laden Sie nur Personen als Mitglieder ein, denen Sie diese Werte anvertrauen würden.
- **Der Service-Key kann ausgetauscht werden.** Die **Settings** des Projekts (oder `rebase cloud service-key rotate`) stellen einen neuen `REBASE_SERVICE_KEY` aus und starten die App damit neu. Der alte Schlüssel funktioniert noch, bis der Neustart abgeschlossen ist, danach jedoch nicht mehr; alles, was ihn kopiert hat, wird ab diesem Zeitpunkt abgewiesen. Das Übernehmen (Claiming) eines Projekts bewirkt dasselbe.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/) führt das identische Image und Bundle mit `docker compose` aus, und der [Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das Helm-Chart ab.
