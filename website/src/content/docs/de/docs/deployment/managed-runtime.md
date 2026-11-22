---
sourceHash: 3f40bdbdc8b0c722
title: Verwaltete Backend-Laufzeitumgebung
sidebar_label: Managed Runtime
description: Was ein Backend mit der Laufzeitumgebung "managed" auf Rebase Cloud tun kann und was nicht – Pakete und Binärdateien, Arbeitsspeicher und CPU, Timeouts und Body-Größen, das Dateisystem, In-Memory-Zustand, Secrets, Speicher für generierte Dateien und ausgehender Netzwerkverkehr.
---

Eine Backend-App, die in `rebase.json` wie folgt deklariert ist, läuft auf der **verwalteten
Laufzeitumgebung (Managed Runtime)**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

„Managed“ bedeutet, dass Sie ein Bundle ausliefern, kein Image. `rebase cloud deploy` baut Ihre
Tabellen, `backend/functions/` und Crons in `dist-bundle`, lädt dieses hoch, und
Rebase Cloud startet es auf dem veröffentlichten `rebasepro/server`-Image. Sie schreiben niemals
ein Dockerfile und können auch nicht ändern, was im Image enthalten ist. Diese Seite listet auf,
was dadurch möglich ist, damit Sie ein Feature planen können, bevor Sie es entwickeln.

Die Zahlen hier basieren auf der aktuellen Laufzeitumgebung und Plattform. Einige
sind Stellschrauben, die Sie anpassen können; auf dieser Seite wird angegeben, welche das sind. Die wenigen Dinge, die
noch nicht garantiert werden, sind [am Ende](#noch-nicht-garantiert) zusammengefasst.

## Auf einen Blick

| Frage | Antwort |
|---|---|
| Node-Version | Node 22, auf Debian slim, `linux`/`x64` |
| npm-Pakete | Ja, aus der öffentlichen Registry oder einer privaten. Werden beim Deployment in das Bundle installiert |
| Native Module (`.node`, node-gyp) | Nein. `rebase cloud deploy` verweigert das Bundle |
| WebAssembly | Ja |
| Child-Prozess starten | Ja, für eine `linux`/`x64`-Binärdatei, die von einem npm-Paket mitgeliefert wird. Siehe [Binärdateien](#binärdateien-und-child-prozesse) |
| Arbeitsspeicher und CPU | Pro Projekt über `rebase cloud compute` festlegbar. Siehe [Compute](#compute-und-instanzen) |
| Instanzen | Standardmäßig 1, immer aktiv. Sie können bis zu 5 Instanzen fest zuweisen oder den Autoscaler auf bis zu 16 skalieren lassen |
| Funktions-Timeout | 30 Sekunden, danach `504 FUNCTION_TIMEOUT`. Konfigurierbar bis zu 10 Minuten |
| Request-Body | 10 MiB, danach `413`. Konfigurierbar, bis zu den 64 MiB, die der Edge akzeptiert |
| Beschreibbares Dateisystem | Ja, aber es ist temporär und gehört zu einer einzelnen Instanz |
| Zustand auf Modulebene (ein `Map`-Cache) | Bleibt zwischen Anfragen auf derselben Instanz erhalten. Geht bei jedem Deploy und Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Umgebungsvariablen und Secrets | `rebase cloud env set`, wird beim nächsten Deploy angewendet |
| Dateispeicher | Ein Bucket pro Projekt, bereitgestellt durch Ihr Backend unter `/api/storage/file/…` |
| Ausgehendes HTTP | Ja, auf Port 80 und 443 (sowie 465, 587, 993 für E-Mail). Andere Ports sind blockiert. Eine feste ausgehende IP: `207.175.138.15` |

## Code und Pakete

**Node und das Image.** Das Laufzeit-Image basiert auf `node:22-slim`
(Debian), und Ihr Bundle läuft auf `linux`/`x64` als Nicht-Root-Benutzer. Ihre
`tsconfig` und die Node-Version auf Ihrem lokalen Rechner ändern daran nichts.

**Abhängigkeiten.** `rebase cloud deploy` installiert die in Ihren
`package.json`-Dateien deklarierten Abhängigkeiten für `linux`/`x64` in das Bundle und lädt
sie mit hoch, sodass eine neue Instanz nichts mehr installieren muss. Ein Bundle, das
mit ihnen das Upload-Limit von 1 GB überschreiten würde, wird ohne sie hochgeladen, was beim
Deploy auch angezeigt wird: Jede Instanz installiert sie dann beim Starten selbst mit `npm ci` (oder
`npm install` ohne Lockfile). Aus dieser Art der Installation ergeben sich vier Punkte:

- **Installationsskripte werden niemals ausgeführt.** Die Installation verwendet `--ignore-scripts`. Ein Paket,
  das eine Binärdatei herunterlädt oder etwas in `postinstall` baut, wird ohne
  diese Schritte installiert.
- **Nur Versionen aus einer Registry werden installiert.** Eine `file:`-, `link:`-, `git+…`- oder `github:`-Abhängigkeit
  führt zum Abbruch des Builds, da die Laufzeitumgebung keine Bezugsquelle hat,
  um sie aufzulösen.
- **Manche Pakete stammen aus dem Image, nicht von Ihnen.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` und `zod` werden aus den
  Abhängigkeiten des Bundles entfernt und die versionseigenen Kopien des Images werden verlinkt, sodass Ihre
  Version dieser Pakete keine Anwendung findet. Andere `@rebasepro/*`-Pakete wie der
  Datenbanktreiber werden wie jede gewöhnliche Abhängigkeit aus Ihrer `package.json` installiert.
  `typescript` und `tsx` werden ebenfalls entfernt; sie sind reine Build-Tools.
- **Private Pakete erfordern eine `.npmrc`.** `rebase build` kopiert die `.npmrc`
  des Projekts (sowie `backend/.npmrc`) in das Bundle, sodass die Installation dieselben
  Registry-Einstellungen verwendet wie Ihr lokaler Rechner. Jede darin enthaltene Anmeldeinformation muss eine
  Umgebungsvariablen-Referenz sein, niemals das Token selbst; ein literales Token führt zum
  Build-Fehler, da das Bundle zusammen mit Ihrem Code hochgeladen wird:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Der Bundle-Upload ist auf 1 GB komprimiert begrenzt.

**Native Module werden abgewiesen.** Ein Paket, das eine kompilierte `.node`-Binärdatei
enthält, kann auf der verwalteten Laufzeitumgebung nicht geladen werden. `rebase build` warnt davor, und
`rebase cloud deploy` bricht vor dem Upload ab:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Die Prüfung sucht nach bekannten nativen Paketen (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
nach `binding.gyp` oder `gypfile`, nach Installationsskripten, die `node-gyp` oder
`prebuild` aufrufen, und nach `.node`-Dateien. Der
[Deployment-Leitfaden](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
listet die üblichen Umgehungsmöglichkeiten auf. Die Kurzfassung: Erledigen Sie die Arbeit zur Build-Zeit,
rufen Sie einen externen Dienst auf oder deployen Sie mit `runtime: "custom"`.

**WebAssembly funktioniert.** Ein Paket, das eine `.wasm`-Datei ausliefert und sie aus
JavaScript heraus lädt, ist kein natives Modul und läuft unter Node 22. Dies wurde im
Basis-Image der Laufzeitumgebung mit den Sicherheitseinstellungen des Pods unter Verwendung von `esbuild-wasm` getestet.
Beachten Sie das [Arbeitsspeicher-Limit](#compute-und-instanzen), falls das Modul sehr groß ist,
wie etwa ein Sprach- oder ML-Modell.

### Binärdateien und Child-Prozesse

`child_process` funktioniert. Das Image selbst enthält nur sehr wenig Ausführbares: `node`, `npm`,
`sh`, `tar` und die PostgreSQL-Client-Tools (`pg_dump`, `pg_restore`). Es gibt
kein `ffmpeg`, kein ImageMagick, kein Python und keinen Compiler, und Sie können keine
Systempakete hinzufügen, da es kein Dockerfile gibt und der Prozess nicht als Root läuft.

Eine Binärdatei, die ein npm-Paket **innerhalb seines eigenen Tarballs** mitbringt, wird zusammen mit
dem Paket installiert und lässt sich ausführen. Sie muss für `linux`/`x64` gegen glibc
(Debian) kompiliert sein und läuft als nicht privilegierter Benutzer ohne Linux-Capabilities.
Getestet mit `@esbuild/linux-x64` im Basis-Image der Laufzeitumgebung. Eine Binärdatei, die ein
Paket in `postinstall` *herunterlädt*, wird niemals bereitgestellt, da Installationsskripte
nicht ausgeführt werden; Pakete wie `ffmpeg-static` funktionieren auf diese Weise.

Wenn ein Feature eine Binärdatei benötigt, nutzen Sie eine gehostete API für diese Aufgabe oder stellen Sie das
Backend auf `runtime: "custom"` um, wo Sie Ihr eigenes Image bauen.

## Compute und Instanzen

Jedes Projekt läuft in seinen eigenen Pods. Arbeitsspeicher und CPU gelten pro Instanz, und Sie legen
diese über die [Compute-Einstellungen](/docs/deployment/cloud/#compute-and-what-it-costs) fest:

```bash
rebase cloud compute                              # was das Projekt aktuell reserviert
rebase cloud compute set --cpu 500m --memory 1Gi
```

Ein Projekt, für das nie eine Einstellung konfiguriert wurde, läuft als Burstable-Pod: Es reserviert `100m` CPU
und `384Mi` Arbeitsspeicher und kann bei Bedarf auf bis zu 2 CPUs und 2 GiB ansteigen (burst). Eine konfigurierte Ressourcenzuweisung behält
dieses Verhältnis zwischen Request und Limit bei. Führen Sie `rebase cloud compute` aus, um die Werte
Ihres Projekts einzusehen.

Instanzen:

- **Standardmäßig eine, immer aktiv.** `--replicas` fixiert den Wert zwischen 1 und 5.
  Ein Skalieren auf null findet bei einem Backend nicht statt.
- **Autoscaling ist optional.** `--autoscale-max` legt eine Obergrenze von bis zu 16 fest, und
  `--autoscale-cpu-target` (Standard: 70) definiert die CPU-Auslastung, die der Autoscaler anpeilt.
- **Deploys erfolgen rollierend (Rolling Updates).** Eine neue Instanz startet und wird als bereit markiert, bevor die alte Instanz
  gestoppt wird, sodass für kurze Zeit zwei Versionen Anfragen bedienen.

`--spot` ist standardmäßig deaktiviert; Spot-Instanzen sind günstiger, werden jedoch ohne
Vorankündigung neu gestartet.

## Arbeitsspeicher und Zustand auf Modulebene

Ein Wert auf Modulebene, wie `const cache = new Map()` am Anfang einer Funktionsdatei,
lebt im Node-Prozess. Er bleibt von einer Anfrage zur nächsten auf
derselben Instanz erhalten. Er geht jedoch verloren, sobald dieser Prozess beendet wird:

- bei **jedem Deploy**, da jedes Deployment neue Instanzen startet;
- wenn sich eine **Umgebungsvariable** ändert und deployt wird;
- wenn eine Instanz neu gestartet, neu zugewiesen oder (bei `--spot`) zurückgefordert wird.

Bei mehr als einer Instanz verfügt jede über ihre eigene Kopie, sodass zwei Anfragen
unterschiedliche Caches vorfinden können.

Verwenden Sie eine `Map` auf Modulebene als Cache, dessen Verlust Sie verschmerzen können: einen Speicher, der die
nächste Anfrage beschleunigt, aber nicht die einzige Quelle für Daten darstellt. Speichern Sie alles, dessen
Erzeugung Ressourcen oder Geld gekostet hat – wie generiertes Audio oder ein teures API-Ergebnis –, in der
Datenbank oder im [Storage](#speicher-für-generierte-dateien). Für Clients, die Sie nur
einmalig initialisieren, wie ein API-SDK, nutzen Sie `lazyResource`, damit der Client bei der ersten
Verwendung anhand der Umgebungsvariablen der Anfrage instanziiert wird. Siehe
[Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

Unter [Mehrere Instanzen ausführen](/docs/deployment/multiple-instances/) ist aufgeführt,
welchen Zustand Rebase selbst pro Prozess verwaltet, wie etwa Rate-Limit-Zähler und
Echtzeit-Kanäle (Realtime Channels).

## Das Dateisystem

Das Dateisystem des Containers ist beschreibbar, und `/tmp` funktioniert. Aber alles,
was dorthin geschrieben wird:

- gehört zu einer einzelnen Instanz und ist für andere Instanzen nicht sichtbar;
- wird gelöscht, wenn die Instanz stoppt, spätestens also beim nächsten Deploy;
- teilt sich ein Limit von 6 GiB an flüchtigem Speicher (Ephemeral Storage) mit dem Bundle und den installierten
  `node_modules`. Eine Instanz, die dieses Limit überschreitet, wird beendet (evicted).

Nutzen Sie es für temporäre Arbeitsdateien während einer einzelnen Anfrage. Verwenden Sie es nicht als Cache über
Deployments hinweg oder als Speicherort für Uploads. Aus diesem Grund ist
[`STORAGE_TYPE=local` in der Produktionsumgebung deaktiviert](/docs/backend/storage/#environment-variables).

## Anfragen (Requests)

| Limit | Standard | Ändern mit |
|---|---|---|
| Funktions-Timeout | 30 s, danach `504` mit Code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` schaltet es aus) oder über das funktionsspezifische `defineFunction(…, { timeoutMs })` |
| Funktions-Timeout maximal | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Warten am Edge auf Ihre Instanz | 10 Minuten zwischen Lese- oder Schreibvorgängen | Fest |
| Request-Body, `/api/*`-Routen ohne eigenes Limit | 10 MiB, danach `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in Bytes |
| Request-Body am Edge | 64 MiB | Fest |
| Einzelne Datei über `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonyme Aufrufe an `/api/functions/*` | 3000 pro IP pro 15 Minuten | `rateLimit.anonymousFunctions` |

Einige Details:

- **Das Timeout befreit den Aufrufer, nicht die Hintergrundarbeit.** Nach 30 Sekunden erhält der Aufrufer
  ein `504`, und `getSignal(c)` wird abgebrochen. Übergeben Sie dieses Signal an `fetch` und
  alles andere, was ein AbortSignal akzeptiert, damit auch die Ausführung gestoppt wird. Siehe
  [Timeouts und Rate-Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **Der Edge wartet länger als die Laufzeitumgebung.** Der Ingress vor Ihren
  Instanzen wartet bis zu 10 Minuten; das Limit, auf das eine Anfrage trifft, ist also das der Laufzeitumgebung,
  die mit JSON antwortet und das Signal abbricht. Erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS`
  bis zu diesem Wert, oder weisen Sie der betreffenden Funktion ihr eigenes
  [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits) zu. Für Arbeiten, die länger dauern oder die ein Deployment überstehen müssen
  (eine Instanz wird 15 Sekunden lang geleert/drained), antworten Sie sofort und führen Sie die Arbeit in einem
  [Job](/docs/backend/jobs/) aus.
- **Uploads über 64 MiB** erfordern den fortsetzbaren Upload (TUS), der
  die Datei in Chunks sendet. `client.storage.putObject()` wechselt ab 8 MiB automatisch
  zu diesem Verfahren.
- **Antwortgröße (Response size).** Weder die Laufzeitumgebung noch der Edge legen ein Limit für die
  Antwortgröße fest. Eine große Antwort wird dennoch im Arbeitsspeicher gehalten, wenn Ihr Handler sie als
  Ganzes aufbaut; streamen Sie sie daher oder liefern Sie sie direkt aus dem Storage aus.

## Umgebungsvariablen und Secrets

Legen Sie diese über das CLI oder in der Konsole fest. Es gibt dafür kein Feld in
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: wird nie wieder im Klartext angezeigt
rebase cloud env list                            # nur Namen, niemals Werte
rebase cloud deploy                              # wendet die Änderungen an
```

- **Eine Änderung wird beim nächsten Deploy angewendet.** Laufende Instanzen behalten die Werte,
  mit denen sie gestartet wurden. `set` und `unset` weisen Sie darauf hin
  (`Pending redeploy`).
- **Limits:** bis zu 100 Variablen pro Projekt, 32 KiB pro Wert und 256 KiB
  insgesamt. Namen müssen dem Schema `[A-Za-z_][A-Za-z0-9_]*` entsprechen.
- **Einige Namen sind reserviert.** Die Plattform setzt `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` sowie `NODE_ENV` selbst und legt fest, wie der Prozess
  ausgeführt wird (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Das Setzen eines dieser Namen wird
  verweigert, und die Fehlermeldung listet sie alle auf.
- **`CORS_ORIGINS` basiert auf Ihren Domains.** Die Plattform setzt dies auf den
  Host des Projekts und seine verifizierten [benutzerdefinierten Domains](/docs/deployment/cloud/#the-rest-of-the-surface).
  Ein von Ihnen gesetzter Wert für `CORS_ORIGINS` wird zu dieser Liste hinzugefügt, falls ein Frontend von
  woanders bereitgestellt wird: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Die Storage-Variablen sind Standardwerte.** Die Plattform schreibt die `STORAGE_*`-
  und `S3_*`-Variablen für ihren Bucket; ein von Ihnen festgelegter Wert überschreibt diese.
- **Namen für Build-Zeiten werden abgewiesen.** `VITE_`-, `NEXT_PUBLIC_`-, `PUBLIC_`- und
  `REACT_APP_`-Variablen sind für Frontends zur Build-Zeit gedacht; das Backend
  erhält sie nie rechtzeitig. `--force` speichert eine solche Variable dennoch.

Lesen Sie diese Variablen in einer Funktion immer innerhalb des Handlers aus, niemals am Anfang der Datei:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Ein lesender Zugriff auf `process.env` im Modul-Scope, der leer zurückkehrt, führt dazu, dass die gesamte Datei
nicht geladen werden kann und ihre Routen mit `404` antworten. Siehe
[Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Speicher für generierte Dateien

Ein Cloud-Projekt erhält Dateispeicher, sobald Sie diesen erstellen:

```bash
rebase cloud storage create   # ein verwalteter Bucket und seine Zugangsdaten
rebase cloud deploy           # das laufende Backend erhält die Zugangsdaten beim Deploy
```

Alternativ können Sie das Projekt mit `rebase cloud storage attach` mit einem Bucket verknüpfen,
den Sie bereits besitzen (S3, R2, MinIO oder jeder andere S3-kompatible Bucket).
Ohne eine dieser Optionen antworten Uploads mit `501 STORAGE_NOT_CONFIGURED`. Weitere Buckets werden
in `backend/resources.ts` deklariert; siehe
[Mehrere Buckets](/docs/backend/storage/#several-buckets).

Ein Deployment mit Storage wird verweigert, solange das Projekt nicht festlegt, wer Dateien lesen und schreiben
darf. Die Gerüstdatei `backend/storage.ts` exportiert hierfür einen `storageAuthorize`-Hook.
Siehe [Objektbezogene Autorisierung](/docs/backend/storage-authorization/).

**Wie Dateien bereitgestellt werden.** Ihr Backend stellt jede Datei unter
`GET /api/storage/file/<key>` bereit. Es liest das Objekt aus dem Bucket und streamt
es inklusive `Content-Type`, Range-Requests und Caching-Headern. Es gibt keine direkte
Bucket-URL, die herausgegeben werden könnte.

- Ein Schlüssel unter **`public/`** wird für jedermann ohne Token unter einer URL
  bereitgestellt, die sich niemals ändert. Nutzen Sie dies für Dateien, die jeder Besucher laden darf, wie z. B.
  generiertes Audio für ein öffentliches Spiel.
- Jeder andere Schlüssel ist privat. Ein Client fordert über `/api/storage/metadata/<key>` eine
  Download-URL an, die ein Token enthält, das standardmäßig 300 Sekunden lang gültig ist
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, konfigurierbar bis zu einer Woche).

Aus einer Funktion heraus schreiben Sie mit `rebase.storage` (dem Standard-Bucket) oder
`rebase.bucket(…)` (einem benannten Bucket). Ihr `storageAuthorize`-Hook entscheidet
weiterhin, ob der Schreibvorgang zulässig ist.

Bildtransformationen (`?width=`, `?format=`) erfordern `sharp`, was ein natives Modul
und nicht im Managed-Image enthalten ist. Auf der verwalteten Laufzeitumgebung liefert
eine Transformationsanfrage das Originalbild zurück.

### Beispiel: Generiertes Audio cachen

Eine Funktion, die Text über eine gehostete API in Sprache umwandelt, jedes Ergebnis
einmal speichert und danach aus dem Storage bereitstellt. Die `Map` erspart auf einer
warmen Instanz lediglich den Abruf aus dem Storage; der Bucket ist der eigentliche Cache, sodass bei einem Deploy
nichts verloren geht.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

Die Route ist öffentlich, wie jede Route in `backend/functions/`, solange Sie sie nicht
absichern. In der Praxis würde man prüfen, wer neue Audiodaten generieren darf, damit niemand Fremdes
Ihr Budget für die Sprach-API aufbraucht.

## Ausgehendes Netzwerk

Funktionen können externe Dienste aufrufen. Ausgehende Verbindungen von Ihren Instanzen
zu beliebigen Internetadressen sind ausschließlich auf diesen TCP-Ports gestattet:

| Port | Zweck |
|---|---|
| 80, 443 | HTTP und HTTPS |
| 465, 587 | E-Mail-Versand über SMTP mit TLS oder STARTTLS |
| 993 | IMAP über TLS |

Alles andere ist blockiert. Das umfasst Port 25, unverschlüsseltes IMAP sowie Datenbanken oder
Caches auf ihren Standard-Ports: Redis auf 6379 oder MongoDB auf 27017 außerhalb von Rebase
Cloud können nicht erreicht werden. Die Cloud-Metadaten-Adresse (`169.254.169.254`) ist
ebenfalls blockiert.

Die einzige Ausnahme ist Ihre eigene Datenbank. Wenn das Projekt eine eigene
PostgreSQL-Datenbank mitbringt (BYODB), erlaubt jedes Deployment zusätzlich Verbindungen zum
Host dieser Datenbank auf dem in ihrem Verbindungsstring angegebenen Port – und zu nichts anderem auf diesem Port.
Der Host wird beim Deployen zu seinen IP-Adressen aufgelöst; falls Ihr Anbieter
die Datenbank also auf eine andere Adresse verschiebt, deployen Sie erneut. Die Datenbank muss
Verbindungen aus dem Internet akzeptieren: Die App verbindet sich direkt über den Verbindungsstring.
Die SSH-Bastion-Einstellungen werden ausschließlich für den Verbindungstest verwendet, nicht
von der bereitgestellten App.

Die Plattform fügt weder einen Proxy noch ein ausgehendes Rate-Limit hinzu; die von Ihnen aufgerufenen Dienste
haben ihre eigenen Limits. Übergeben Sie `getSignal(c)` an `fetch`, damit ein Aufruf abgebrochen wird,
wenn für die Anfrage ein Timeout auftritt.

Der gesamte ausgehende Datenverkehr stammt von **einer festen IP-Adresse: `207.175.138.15`**.
Fügen Sie diese zu einer Drittanbieter-Allowlist hinzu, wenn ein Dienst eine solche verlangt. Diese Adresse wird
von allen Projekten auf Rebase Cloud geteilt. Ein Eintrag in einer Allowlist beweist daher nur, dass der Aufrufer
auf Rebase Cloud läuft, nicht jedoch, dass es sich um Ihr spezifisches Projekt handelt: Authentifizieren Sie sich
beim externen Dienst daher stets zusätzlich mit einem Schlüssel.

## Start und Herunterfahren (Shutdown)

- **Kaltstart (Cold start).** Eine neue Instanz lädt das Bundle herunter und entpackt es, bevor sie
  Anfragen bedient; ein großer Abhängigkeitsbaum verlangsamt daher jedes Hochskalieren. Ein Bundle,
  das ohne seine Abhängigkeiten hochgeladen wurde, muss diese zudem installieren, was 40 bis 60
  Sekunden zusätzlich beansprucht. Die Plattform wartet bis zu 300 Sekunden darauf, dass eine Instanz einsatzbereit ist.
- **Health Checks.** Die Plattform prüft `/livez` (der Prozess läuft) und
  `/health` (er kann die Datenbank erreichen). Beide Endpunkte werden von der Laufzeitumgebung bereitgestellt,
  Sie müssen diese also nicht selbst schreiben.
- **Herunterfahren.** Bei einem Deploy oder Neustart nimmt die Instanz keine neuen Anfragen mehr an,
  wartet 5 Sekunden, bis sich der Datenverkehr verlagert hat, und empfängt dann `SIGTERM`. Laufende
  Anfragen haben bis zu 15 Sekunden Zeit, um abgeschlossen zu werden. Promises, die an `waitUntil` übergeben wurden,
  erhalten davon bis zu 5 Sekunden. Ein Promise, das nicht an `waitUntil` übergeben wurde, wird verworfen.
  Siehe [Hintergrundarbeit](/docs/backend/custom-functions/#background-work).

## Wann Managed nicht die richtige Wahl ist

Wechseln Sie für das Backend zu `"runtime": "custom"`, wenn Folgendes benötigt wird:

- ein natives Modul oder eine System-Binärdatei, die von keinem npm-Paket mitgeliefert wird, wie etwa `sharp`,
  ImageMagick oder eine lokale Speech-Engine;
- Systempakete oder ein anderes Basis-Image;
- eine langlebige Verbindung zu einem Dienst außerhalb der erlaubten Ports.

Eine benutzerdefinierte Laufzeitumgebung (Custom Runtime) baut Ihr eigenes Dockerfile, und Sie verwalten das Image fortan
selbst. Mit `rebase cloud deploy --eject` führen Sie diesen Wechsel durch. Siehe
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Noch nicht garantiert

- **Protokollverlauf (Log history).** `rebase cloud logs --runtime` liest aus den aktuell laufenden
  Instanzen, und `rebase cloud debug logs --previous` aus dem letzten Durchlauf einer Instanz,
  die neu gestartet wurde. Die Ausgabe einer Instanz, die durch ein Deploy ersetzt wurde, ist verloren. Schreiben
  Sie alle Daten, die Sie dauerhaft benötigen, in die Datenbank oder an einen eigenen Protokollierungsdienst.
- **Scale to Zero** wird nicht angeboten. Jedes Backend betreibt zu jeder Zeit
  mindestens eine Instanz.

## Weiterführende Seiten

- [Rebase Cloud](/docs/deployment/cloud/): Verknüpfen, Deployen, Compute-Einstellungen
  und was die Beta noch nicht enthält
- [Eigene Funktionen](/docs/backend/custom-functions/): Schreiben der Routen in
  `backend/functions/`
- [Laufzeitumgebung und Bundles](/docs/architecture/runtime-and-bundles/): Was ein Bundle
  ist und wie die Laufzeitumgebung es startet
- [Storage](/docs/backend/storage/): Buckets, Endpunkte, Größenbeschränkungen und Zugriffsregeln
- [Mehrere Instanzen ausführen](/docs/deployment/multiple-instances/): Der Zustand, den Rebase
  pro Prozess verwaltet
