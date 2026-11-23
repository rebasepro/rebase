---
sourceHash: 6cf201fcae853f37
title: Verwaltete Backend-Runtime
sidebar_label: Managed Runtime
description: Was ein Backend mit der Runtime "managed" auf Rebase Cloud tun kann und was nicht — Pakete und Binärdateien, Arbeitsspeicher und CPU, Timeouts und Body-Größen, das Dateisystem, Zustand im Speicher, Secrets, Speicher für generierte Dateien und ausgehender Netzwerkverkehr.
---

Eine Backend-App, die in `rebase.json` wie folgt deklariert ist, läuft auf der **Managed-Runtime**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managed bedeutet, dass Sie ein Bundle ausliefern, kein Image. `rebase cloud deploy` baut Ihre Tabellen, `backend/functions/` und Crons in `dist-bundle`, lädt es hoch, und Rebase Cloud startet es auf dem veröffentlichten `rebasepro/server`-Image. Sie schreiben niemals ein Dockerfile und können auch nicht ändern, was sich im Image befindet. Diese Seite listet auf, was dadurch möglich ist, damit Sie ein Feature planen können, bevor Sie es erstellen.

Die Zahlen hier stammen aus dem aktuellen Stand der Runtime und der Plattform. Einige sind Stellschrauben, die Sie anpassen können, und diese Seite gibt an, welche das sind. Die wenigen Dinge, die derzeit noch nicht zugesichert werden, sind [am Ende](#bislang-noch-nicht-zugesichert) aufgeführt.

## Auf einen Blick

| Frage | Antwort |
|---|---|
| Node-Version | Node 22, auf Debian slim, `linux`/`x64` |
| npm-Pakete | Ja, aus der öffentlichen Registry oder einer privaten. Werden beim Bereitstellen (Deploy) im Bundle installiert |
| Native Module (`.node`, node-gyp) | Nein. `rebase cloud deploy` weist das Bundle ab |
| WebAssembly | Ja |
| Einen Kindprozess starten (child process) | Ja, für ein `linux`/`x64`-Binary, das von einem npm-Paket mitgeliefert wird. Siehe [Binärdateien](#binärdateien-und-kindprozesse) |
| Arbeitsspeicher und CPU | Pro Projekt über `rebase cloud compute` festgelegt. Siehe [Compute](#compute-und-instanzen) |
| Instanzen | Standardmäßig 1, immer aktiv (always on). Sie können bis zu 5 festlegen oder den Autoscaler auf bis zu 16 skalieren lassen |
| Funktions-Timeout | 30 Sekunden, dann `504 FUNCTION_TIMEOUT`. Konfigurierbar bis zu 10 Minuten |
| Request-Body | 10 MiB, dann `413`. Konfigurierbar, bis zu den 64 MiB, die die Edge akzeptiert |
| Beschreibbares Dateisystem | Ja, aber es ist temporär und gehört zu einer einzelnen Instanz |
| Zustand auf Modulebene (ein `Map`-Cache) | Bleibt zwischen Requests auf einer Instanz erhalten. Geht bei jedem Deploy und Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Umgebungsvariablen und Secrets | `rebase cloud env set`, wird beim nächsten Deploy angewendet |
| Dateispeicher | Ein Bucket pro Projekt, ausgeliefert durch Ihr Backend unter `/api/storage/file/…` |
| Ausgehender HTTP-Verkehr | Ja, auf den Ports 80 und 443 (sowie 465, 587, 993 für E-Mail). Andere Ports sind blockiert. Eine feste ausgehende IP: `207.175.138.15` |

## Code und Pakete

**Node und das Image.** Das Runtime-Image basiert auf `node:22-slim` (Debian), und Ihr Bundle läuft auf `linux`/`x64` als Nicht-Root-Benutzer. Ihre `tsconfig` und die Node-Version auf Ihrem lokalen Rechner ändern daran nichts.

**Abhängigkeiten.** `rebase cloud deploy` installiert die in Ihren `package.json`-Dateien deklarierten Abhängigkeiten für `linux`/`x64` in das Bundle und lädt sie mit hoch, sodass eine neue Instanz nichts mehr installieren muss. Ein Bundle, das mit ihnen das Upload-Limit von 1 GB überschreiten würde, wird ohne sie hochgeladen, und der Deploy meldet dies: Jede Instanz installiert sie dann beim Start mit `npm ci` (oder `npm install` ohne Lockfile). Aus der Art der Installation ergeben sich vier Dinge:

- **Install-Skripte werden niemals ausgeführt.** Die Installation verwendet `--ignore-scripts`. Ein Paket, das ein Binary herunterlädt oder etwas in `postinstall` baut, wird ohne dieses installiert.
- **Nur Registry-Versionen werden installiert.** Eine Abhängigkeit via `file:`, `link:`, `git+…` oder `github:` lässt den Build fehlschlagen, da die Runtime über keine Möglichkeit verfügt, diese aufzulösen.
- **Einige Pakete stammen aus dem Image, nicht von Ihnen.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` und `zod` werden aus den Abhängigkeiten des Bundles entfernt und die im Image vorhandenen Kopien werden verlinkt, sodass Ihre Version davon keine Anwendung findet. Andere `@rebasepro/*`-Pakete, wie z. B. der Datenbanktreiber, werden ganz normal aus Ihrer `package.json` installiert. `typescript` und `tsx` werden ebenfalls entfernt; sie sind Build-Tools.
- **Private Pakete erfordern eine `.npmrc`.** `rebase build` kopiert die `.npmrc` des Projekts (und `backend/.npmrc`) in das Bundle, sodass die Installation dieselben Registry-Einstellungen wie Ihr Rechner verwendet. Jede darin enthaltene Anmeldeinformation muss eine Umgebungsreferenz sein, niemals der Token selbst; ein literaler Token führt zum Fehlschlagen des Builds, da das Bundle mit Ihrem Code hochgeladen wird:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Der Bundle-Upload ist im komprimierten Zustand auf 1 GB begrenzt.

**Native Module werden abgewiesen.** Ein Paket, das eine kompilierte `.node`-Binärdatei mitbringt, kann in der Managed-Runtime nicht geladen werden. `rebase build` warnt davor, und `rebase cloud deploy` bricht vor dem Upload ab:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Die Prüfung sucht nach bekannten nativen Paketen (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), nach `binding.gyp` oder `gypfile`, nach Install-Skripten, die `node-gyp` oder `prebuild` aufrufen, sowie nach `.node`-Dateien. Der [Deployment-Leitfaden](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) listet die üblichen Auswege auf. Die Kurzfassung: Erledigen Sie die Arbeit zur Build-Zeit, rufen Sie einen Dienst auf oder deployen Sie mit `runtime: "custom"`.

**WebAssembly funktioniert.** Ein Paket, das eine `.wasm`-Datei mitliefert und diese aus JavaScript lädt, ist kein natives Modul, und Node 22 führt es aus. Getestet im Basis-Image der Runtime mit den Sicherheitseinstellungen des Pods unter Verwendung von `esbuild-wasm`. Beachten Sie das [Speicherlimit](#compute-und-instanzen), falls das Modul groß ist, wie etwa ein Sprach- oder ML-Modell.

### Binärdateien und Kindprozesse

`child_process` funktioniert. Das Image selbst enthält nur sehr wenig Ausführbares: `node`, `npm`, `sh`, `tar` und die PostgreSQL-Client-Tools (`pg_dump`, `pg_restore`). Es gibt kein `ffmpeg`, kein ImageMagick, kein Python und keinen Compiler, und Sie können keine Systempakete hinzufügen, da es kein Dockerfile gibt und der Prozess nicht als Root läuft.

Ein Binary, das ein npm-Paket **in seinem eigenen Tarball** mitführt, wird mit dem Paket installiert und ausgeführt. Es muss für `linux`/`x64` gegen glibc (Debian) gebaut sein und läuft als unprivilegierter Benutzer ohne Linux-Capabilities. Getestet mit `@esbuild/linux-x64` im Basis-Image der Runtime. Ein Binary, das ein Paket in `postinstall` *herunterlädt*, wird nie ankommen, da Install-Skripte nicht ausgeführt werden; Pakete wie `ffmpeg-static` funktionieren auf diese Weise.

Wenn ein Feature eine Binärdatei benötigt, nutzen Sie eine gehostete API für diese Aufgabe oder stellen Sie das Backend auf `runtime: "custom"` um, wo Sie Ihr eigenes Image bauen.

## Compute und Instanzen

Jedes Projekt läuft in seinen eigenen Pods. Arbeitsspeicher und CPU gelten pro Instanz und werden über die [Compute-Stellschrauben](/docs/deployment/cloud/#compute-and-what-it-costs) festgelegt:

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Ein Projekt, für das nie eine Einstellung vorgenommen wurde, läuft als Burstable-Pod. In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi und kann bei Bedarf auf 2 CPU und 2 GiB bursten; in Falkenstein und Helsinki kann sich der Speicher auf das 1,4-Fache der Anforderung und die CPU auf das 10-Fache (maximal 1,7 vCPU) ausdehnen. `rebase cloud compute` zeigt die Werte Ihres Projekts an.

Instanzen:

- **Standardmäßig eine, läuft immer.** `--replicas` legt einen festen Wert zwischen 1 und 5 fest. Nichts skaliert ein Backend auf null.
- **Autoscaling ist optional (Opt-in).** `--autoscale-max` legt eine Obergrenze von bis zu 16 fest, und `--autoscale-cpu-target` (Standard 70) bestimmt die CPU-Auslastung, die der Autoscaler anstrebt.
- **Deploys erfolgen rollierend.** Eine neue Instanz startet und wird als einsatzbereit eingestuft, bevor die alte Instanz stoppt, sodass für kurze Zeit zwei Versionen Traffic bedienen.

`--spot` ist standardmäßig deaktiviert; Spot-Instanzen sind günstiger, werden aber ohne Vorankündigung neu gestartet.

## Arbeitsspeicher und Zustand auf Modulebene

Ein Wert auf Modulebene, wie `const cache = new Map()` am Anfang einer Funktionsdatei, verbleibt im Node-Prozess. Er überdauert aufeinanderfolgende Anfragen auf derselben Instanz. Er geht verloren, sobald dieser Prozess beendet wird:

- bei **jedem Deploy**, da jeder Deploy neue Instanzen startet;
- wenn eine **Umgebungsvariable** geändert und deployed wird;
- wenn eine Instanz neu gestartet, neu zugewiesen oder (bei `--spot`) zurückgefordert wird.

Bei mehr als einer Instanz verfügt jede über eine eigene Kopie, sodass zwei Anfragen unterschiedliche Caches sehen können.

Verwenden Sie eine `Map` auf Modulebene als Cache, dessen Verlust Sie verschmerzen können: einen, der die nächste Anfrage beschleunigt, aber nicht die einzige Kopie von irgendetwas darstellt. Bewahren Sie alles, dessen Erstellung Sie etwas gekostet hat, wie generierte Audiodaten oder teure API-Antworten, in der Datenbank oder im [Dateispeicher](#speicher-für-generierte-dateien) auf. Für Clients, die Sie nur einmal erstellen, wie z. B. ein API-SDK, verwenden Sie `lazyResource`, damit der Client bei der ersten Verwendung aus der Umgebung der Anfrage erstellt wird. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/) listet den Zustand auf, den Rebase selbst pro Prozess verwaltet, wie z. B. Rate-Limit-Zähler und Echtzeit-Kanäle.

## Das Dateisystem

Das Dateisystem des Containers ist beschreibbar, und `/tmp` funktioniert. Aber alles, was dorthin geschrieben wird:

- gehört zu einer Instanz, und andere Instanzen sehen es nicht;
- wird gelöscht, wenn die Instanz stoppt, spätestens also beim nächsten Deploy;
- teilt sich ein Limit von 6 GiB an ephemerem Speicher mit dem Bundle und seinen installierten `node_modules`. Eine Instanz, die dieses Limit überschreitet, wird beendet (evicted).

Nutzen Sie es für temporäre Arbeitsdateien während einer einzelnen Anfrage. Verwenden Sie es nicht als Cache über Deploys hinweg oder als Speicher für Uploads. Das ist auch der Grund, warum [`STORAGE_TYPE=local` in der Produktionsumgebung deaktiviert ist](/docs/backend/storage/#environment-variables).

## Anfragen

| Limit | Standard | Ändern mit |
|---|---|---|
| Funktions-Timeout | 30 s, dann `504` mit Code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` schaltet es ab) oder das eigene `defineFunction(…, { timeoutMs })` einer Funktion |
| Maximales Timeout einer Funktion | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Warten auf Ihre Instanz an der Edge | 10 Minuten zwischen Lese- oder Schreibvorgängen | Fest |
| Request-Body, `/api/*`-Routen ohne eigenes Limit | 10 MiB, dann `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in Bytes |
| Request-Body an der Edge | 64 MiB | Fest |
| Einzelne Datei über `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonyme Aufrufe an `/api/functions/*` | 3000 pro IP alle 15 Minuten | `rateLimit.anonymousFunctions` |

Einige Details:

- **Das Timeout befreit den Aufrufer, bricht aber nicht die Arbeit ab.** Nach 30 Sekunden erhält der Aufrufer einen `504` und `getSignal(c)` wird abgebrochen. Übergeben Sie dieses Signal an `fetch` und alles andere, was eines akzeptiert, damit auch die Verarbeitung stoppt. Siehe [Timeouts und Rate-Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **Die Edge wartet länger als die Runtime.** Der Ingress vor Ihren Instanzen wartet bis zu 10 Minuten. Das Limit, auf das eine Anfrage trifft, ist daher das der Runtime, die mit JSON antwortet und das Signal abbricht. Erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS` bis zu diesem Wert oder weisen Sie der einzelnen Funktion, die es benötigt, ein eigenes [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits) zu. Für Arbeiten, die länger dauern oder die einen Deploy überstehen müssen (eine Instanz benötigt für das Draining 15 Sekunden), antworten Sie sofort und führen Sie die Arbeit in einem [Job](/docs/backend/jobs/) aus.
- **Uploads von mehr als 64 MiB** erfordern den wiederaufnehmbaren Upload (TUS, resumable upload), der die Datei in Chunks sendet. `client.storage.putObject()` wechselt ab 8 MiB automatisch dazu.
- **Response-Größe.** Weder die Runtime noch die Edge setzen ein Limit für die Response-Größe. Eine große Response wird dennoch im Arbeitsspeicher gehalten, wenn Ihr Handler sie an einem Stück zusammenbaut; streamen Sie sie daher oder liefern Sie sie direkt aus dem Storage aus.

### Monitore und geplante Aufgaben in `/metrics`

Eine Anfrage von einem bekannten Uptime-Monitor (erkannt anhand seines `User-Agent`) oder eine mit einem `x-rebase-probe`-Header mit beliebigem Wert wird beantwortet, aber in `rebase_probe_requests_total` statt in `rebase_requests_total` gezählt, sodass ein Monitor nicht als normaler Traffic erfasst wird. `rebase_scheduled_jobs` ist die Anzahl der in der App registrierten, aktivierten Cron-Jobs und `rebase_background_workers` ist 1, solange dieser Prozess einen Job-Queue-Worker ausführt; beide stoppen, während ein Deployment auf null herunterskaliert ist, weshalb eine Plattform, die inaktive Projekte in den Ruhezustand versetzt, diese Werte ausliest.

## Umgebungsvariablen und Secrets

Legen Sie diese mit der CLI oder in der Konsole fest. Es gibt dafür kein Feld in `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Eine Änderung wird beim nächsten Deploy wirksam.** Laufende Instanzen behalten die Werte, mit denen sie gestartet wurden. `set` und `unset` weisen Sie darauf hin (`Pending redeploy`).
- **Limits:** bis zu 100 Variablen pro Projekt, 32 KiB pro Wert und 256 KiB insgesamt. Namen folgen `[A-Za-z_][A-Za-z0-9_]*`.
- **Einige Namen sind reserviert.** Die Plattform setzt `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` und `NODE_ENV` selbst und legt fest, wie der Prozess ausgeführt wird (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Das Setzen einer dieser Variablen wird verweigert, und die Fehlermeldung listet sie alle auf.
- **`CORS_ORIGINS` basiert auf Ihren Domains.** Die Plattform setzt dies auf den Host des Projekts und seine verifizierten [benutzerdefinierten Domains](/docs/deployment/cloud/#the-rest-of-the-surface). Ein von Ihnen gesetztes `CORS_ORIGINS` wird dieser Liste hinzugefügt, falls ein Frontend von anderswo bereitgestellt wird: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Die Storage-Variablen sind Standardwerte.** Die Plattform schreibt die `STORAGE_*`- und `S3_*`-Variablen für ihren Bucket, und ein von Ihnen gesetzter Wert hat Vorrang.
- **Namen für die Build-Zeit werden abgelehnt.** Variablen wie `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` und `REACT_APP_` sind für Frontends zur Build-Zeit bestimmt, und das Backend sieht sie niemals rechtzeitig. `--force` speichert sie trotzdem.

Lesen Sie diese in einer Funktion innerhalb des Handlers aus, niemals am Anfang der Datei:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Ein Lesezugriff auf `process.env` im Modul-Scope, der leer bleibt, führt dazu, dass die gesamte Datei nicht geladen werden kann und ihre Routen mit `404` antworten. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Speicher für generierte Dateien

Ein Cloud-Projekt erhält Dateispeicher, sobald Sie ihn anlegen:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Oder verweisen Sie das Projekt mit `rebase cloud storage attach` auf einen Bucket, den Sie bereits besitzen (S3, R2, MinIO, jeder S3-kompatible Bucket). Ohne eines von beiden antworten Uploads mit `501 STORAGE_NOT_CONFIGURED`. Weitere Buckets werden in `backend/resources.ts` deklariert; siehe [Mehrere Buckets](/docs/backend/storage/#several-buckets).

Ein Deploy mit Storage wird verweigert, bis das Projekt festlegt, wer Dateien lesen und schreiben darf. Das Gerüst in `backend/storage.ts` exportiert hierfür einen `storageAuthorize`-Hook. Siehe [Autorisierung pro Objekt](/docs/backend/storage-authorization/).

**Wie Dateien ausgeliefert werden.** Ihr Backend liefert jede Datei unter `GET /api/storage/file/<key>` aus. Es liest das Objekt aus dem Bucket und streamt es mit `Content-Type`, Range-Requests und Caching-Headern. Es gibt keine direkte Bucket-URL zur Weitergabe.

- Ein Schlüssel unter **`public/`** wird jedem ohne Token unter einer URL bereitgestellt, die sich nie ändert. Nutzen Sie dies für Dateien, die jeder Besucher laden darf, wie z. B. generierte Audiodaten für ein öffentliches Spiel.
- Jeder andere Schlüssel ist privat. Ein Client fordert unter `/api/storage/metadata/<key>` eine Download-URL an, die ein Token enthält, das standardmäßig für 300 Sekunden gültig ist (`STORAGE_DOWNLOAD_TOKEN_TTL`, bis zu einer Woche).

Schreiben Sie aus einer Funktion heraus mit `rebase.storage` (der Standard-Bucket) oder `rebase.bucket(…)` (ein benannter Bucket). Ihr `storageAuthorize`-Hook entscheidet weiterhin, ob der Schreibvorgang zulässig ist.

Bildtransformationen (`?width=`, `?format=`) erfordern `sharp`, welches ein natives Modul ist und sich nicht im Managed-Image befindet. Auf der Managed-Runtime erhält eine Transformationsanfrage das Originalbild.

### Beispiel: Generierte Audiodaten cachen

Eine Funktion, die über eine gehostete API Text in Sprache umwandelt, jedes Ergebnis einmal speichert und anschließend aus dem Storage bereitstellt. Die `Map` erspart lediglich einen Storage-Lookup auf einer aufgewärmten Instanz; der Bucket ist der eigentliche Cache, sodass bei einem Deploy nichts verloren geht.

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

Die Route ist öffentlich, wie jede Route in `backend/functions/`, bis Sie sie absichern. Eine produktive Implementierung würde prüfen, wer neue Audiodaten erstellen darf, damit kein Fremder Ihr Budget für die Speech-API aufbrauchen kann.

## Ausgehender Netzwerkverkehr

Funktionen können externe Dienste aufrufen. Ausgehende Verbindungen von Ihren Instanzen sind zu jeder Internetadresse ausschließlich auf diesen TCP-Ports zulässig:

| Port | Zweck |
|---|---|
| 80, 443 | HTTP und HTTPS |
| 465, 587 | Senden von E-Mails über SMTP mit TLS oder STARTTLS |
| 993 | IMAP über TLS |

Alles andere ist blockiert. Dazu gehören Port 25, unverschlüsseltes IMAP sowie Datenbanken oder Caches auf ihren eigenen Ports: Redis auf 6379 oder MongoDB auf 27017 außerhalb von Rebase Cloud können nicht erreicht werden. Die Cloud-Metadaten-Adresse (`169.254.169.254`) ist ebenfalls blockiert.

Die einzige Ausnahme ist Ihre eigene Datenbank. Wenn das Projekt eine eigene PostgreSQL-Datenbank mitbringt (BYODB), erlaubt jeder Deploy auch Verbindungen zum Host dieser Datenbank auf dem Port in dessen Verbindungszeichenfolge und zu nichts anderem auf diesem Port. Der Host wird beim Deploy zu seinen IP-Adressen aufgelöst; falls Ihr Provider die Datenbank also auf eine andere Adresse verschiebt, deployen Sie erneut. Die Datenbank muss Verbindungen aus dem Internet akzeptieren: Die App verbindet sich direkt mit dem Connection String. Die SSH-Bastion-Einstellungen werden nur für den Verbindungstest verwendet, nicht von der deployten App.

Die Plattform fügt keinen Proxy und kein ausgehendes Rate-Limit hinzu; die Dienste, die Sie aufrufen, haben ihre eigenen. Übergeben Sie `getSignal(c)` an `fetch`, damit ein Aufruf stoppt, wenn seine Anfrage ein Timeout erreicht.

Der gesamte ausgehende Datenverkehr stammt von **einer festen IP-Adresse, `207.175.138.15`**. Fügen Sie diese zu einer Drittanbieter-Allowlist hinzu, wenn ein Dienst eine solche verlangt. Die Adresse wird von allen Projekten auf Rebase Cloud geteilt. Eine Allowlist beweist daher nur, dass der Aufrufer auf Rebase Cloud läuft, nicht, dass es sich um Ihr Projekt handelt: Authentifizieren Sie sich beim Dienst weiterhin zusätzlich mit einem Schlüssel.

## Start und Herunterfahren

- **Kaltstart (Cold start).** Eine neue Instanz lädt das Bundle herunter und entpackt es, bevor sie Anfragen bedient; ein großer Abhängigkeitsbaum verlangsamt daher jedes Hochskalieren. Ein Bundle, das ohne seine Abhängigkeiten hochgeladen wurde, installiert diese zusätzlich, was 40 bis 60 Sekunden in Anspruch nimmt. Die Plattform wartet bis zu 300 Sekunden darauf, dass eine Instanz betriebsbereit wird.
- **Health-Checks.** Die Plattform prüft `/livez` (der Prozess läuft) und `/health` (er kann die Datenbank erreichen). Beide werden von der Runtime bereitgestellt, Sie müssen sie also nicht schreiben.
- **Herunterfahren (Shutdown).** Bei einem Deploy oder Neustart nimmt die Instanz keine neuen Anfragen mehr an, wartet 5 Sekunden, bis der Traffic umgeleitet ist, und empfängt dann `SIGTERM`. Laufende Anfragen haben bis zu 15 Sekunden Zeit, um abgeschlossen zu werden. Promises, die an `waitUntil` übergeben wurden, erhalten davon bis zu 5 Sekunden. Ein Promise, das nicht an `waitUntil` übergeben wurde, wird verworfen. Siehe [Hintergrundaufgaben](/docs/backend/custom-functions/#background-work).

## Wann Managed die falsche Wahl ist

Stellen Sie das Backend auf `"runtime": "custom"` um, wenn es Folgendes benötigt:

- ein natives Modul oder ein System-Binary, das kein npm-Paket mitbringt, wie etwa `sharp`, ImageMagick oder eine lokale Speech-Engine;
- Systempakete oder ein anderes Basis-Image;
- eine langlebige Verbindung zu einem Dienst außerhalb der erlaubten Ports.

Eine Custom-Runtime baut Ihr eigenes Dockerfile, und Sie verwalten das Image von da an selbst. `rebase cloud deploy --eject` führt den Wechsel durch. Siehe [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Bislang noch nicht zugesichert

- **Log-Historie.** `rebase cloud logs --runtime` liest aus den aktuell laufenden Instanzen und `rebase cloud debug logs --previous` aus dem letzten Durchlauf einer Instanz, die neu gestartet wurde. Die Ausgaben einer Instanz, die durch ein Deploy ersetzt wurde, sind verloren. Schreiben Sie alles, was Sie behalten müssen, in die Datenbank oder in einen eigenen Logging-Dienst.
- **Scale-to-Zero wird nicht angeboten.** Jedes Backend führt jederzeit mindestens eine Instanz aus.

## Verwandte Seiten

- [Rebase Cloud](/docs/deployment/cloud/): Verknüpfung, Deployment, die Compute-Stellschrauben und was die Beta nicht enthält
- [Custom Functions](/docs/backend/custom-functions/): Schreiben der Routen in `backend/functions/`
- [Runtime und Bundles](/docs/architecture/runtime-and-bundles/): Was ein Bundle ist und wie die Runtime es startet
- [Storage](/docs/backend/storage/): Buckets, Endpunkte, Größenbeschränkungen und Zugriffsregeln
- [Mehrere Instanzen ausführen](/docs/deployment/multiple-instances/): Der Zustand, den Rebase pro Prozess verwaltet
