---
sourceHash: 63d8ba53bb0e0c67
title: Managed Backend-Runtime
sidebar_label: Managed Runtime
description: Was ein Backend mit der Runtime "managed" auf Rebase Cloud tun und lassen kann — Pakete und Binärdateien, Arbeitsspeicher und CPU, Timeouts und Body-Größen, das Dateisystem, In-Memory-State, Secrets, Speicher für generierte Dateien und ausgehender Netzwerkverkehr.
---

Eine Backend-App, die in `rebase.json` wie folgt deklariert ist, läuft auf der **Managed Runtime**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

„Managed“ bedeutet, dass Sie ein Bundle ausliefern, kein Image. `rebase cloud deploy` baut Ihre Collections, `backend/functions/` und Crons in `dist-bundle`, lädt es hoch und Rebase Cloud startet es auf dem veröffentlichten `rebasepro/server`-Image. Sie schreiben niemals ein Dockerfile und können auch nicht ändern, was sich im Image befindet. Diese Seite listet auf, was dadurch möglich ist, damit Sie ein Feature planen können, bevor Sie es implementieren.

Die Zahlen hier stammen von der Runtime und der Plattform im aktuellen Zustand. Einige davon sind Stellschrauben, die Sie anpassen können, und die Seite gibt an, welche das sind. Einige Dinge sind noch nicht final festgelegt; sie sind als **Noch nicht festgelegt** markiert und [am Ende](#noch-nicht-festgelegt) zusammengefasst. Bauen Sie nicht darauf auf, ohne vorher nachzufragen.

## Auf einen Blick

| Frage | Antwort |
|---|---|
| Node-Version | Node 22, auf Debian slim, `linux`/`x64` |
| npm-Pakete | Ja, reine JavaScript-Pakete. Werden installiert, wenn die jeweilige Instanz startet |
| Native Module (`.node`, node-gyp) | Nein. `rebase cloud deploy` lehnt das Bundle ab |
| WebAssembly | Wird weder geprüft noch blockiert. **Noch nicht festgelegt**, ob es unterstützt wird |
| Kindprozess starten (child process) | Nicht blockiert, aber es gibt fast nichts auszuführen. Siehe [Binärdateien](#binärdateien-und-kindprozesse) |
| Arbeitsspeicher und CPU | Wird pro Projekt mit `rebase cloud compute` festgelegt. Siehe [Compute](#compute-und-instanzen) |
| Instanzen | Standardmäßig 1. Sie können bis zu 5 Instanzen festlegen oder den Autoscaler auf bis zu 16 skalieren lassen |
| Funktions-Timeout | 30 Sekunden, dann `504 FUNCTION_TIMEOUT`. Konfigurierbar |
| Request-Body | 10 MiB, dann `413`. Konfigurierbar, bis zu den 64 MiB, die der Edge akzeptiert |
| Beschreibbares Dateisystem | Ja, aber es ist temporär und gehört zu einer einzelnen Instanz |
| Status auf Modulebene (ein `Map`-Cache) | Bleibt zwischen Anfragen auf derselben Instanz erhalten. Geht bei jedem Deployment und Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Umgebungsvariablen und Secrets | `rebase cloud env set`, wird beim nächsten Deployment angewendet |
| Dateispeicher | Ein Bucket pro Projekt, bereitgestellt durch Ihr Backend unter `/api/storage/file/…` |
| Ausgehendes HTTP | Ja, auf den Ports 80 und 443 (sowie 465, 587, 993 für E-Mail). Andere Ports sind blockiert |

## Code und Pakete

**Node und das Image.** Das Runtime-Image basiert auf `node:22-slim` (Debian), und Ihr Bundle läuft auf `linux`/`x64` als Nicht-Root-Benutzer. Ihre `tsconfig` und die Node-Version auf Ihrem Rechner ändern daran nichts.

**Abhängigkeiten.** Das Bundle listet die Abhängigkeiten auf, die Ihre `package.json`-Dateien deklarieren. Der Upload enthält kein `node_modules`. Jede Instanz installiert die Abhängigkeiten aus der öffentlichen npm-Registry beim Starten mittels `npm ci` (oder `npm install` ohne Lockfile). Daraus ergeben sich drei Dinge:

- **Installationsskripte werden niemals ausgeführt.** Die Installation verwendet `--ignore-scripts`. Ein Paket, das eine Binärdatei herunterlädt oder in `postinstall` etwas baut, wird ohne diese installiert.
- **Es werden nur Registry-Versionen installiert.** Eine `file:`, `link:`, `git+…`- oder `github:`-Abhängigkeit lässt den Build fehlschlagen, da die Runtime über nichts verfügt, womit sie aufgelöst werden könnte.
- **Einige Pakete stammen aus dem Image, nicht von Ihnen.** `@rebasepro/*`, `hono`, `zod` und `typescript` werden aus den Abhängigkeiten des Bundles entfernt, und die Versionen des Images selbst werden verwendet, sodass Ihre Version davon keine Anwendung findet.

Der Bundle-Upload ist auf 100 MB komprimiert ohne Abhängigkeiten begrenzt.

**Native Module werden abgelehnt.** Ein Paket, das eine kompilierte `.node`-Binärdatei mitliefert, kann auf der Managed Runtime nicht geladen werden. `rebase build` warnt davor, und `rebase cloud deploy` bricht vor dem Hochladen ab:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Die Prüfung sucht nach bekannten nativen Paketen (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), nach `binding.gyp` oder `gypfile`, nach Installationsskripten, die `node-gyp` oder `prebuild` aufrufen, und nach `.node`-Dateien. Der [Deployment-Leitfaden](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) listet die üblichen Umgehungsmöglichkeiten auf. Die Kurzfassung: Erledigen Sie die Arbeit zur Build-Zeit, rufen Sie einen externen Dienst auf oder deployen Sie mit `runtime: "custom"`.

**WebAssembly.** Nichts im Build oder in der Runtime prüft `.wasm`-Dateien. Ein reines JavaScript-Paket, das eine `.wasm`-Datei lädt, wird nicht abgelehnt, und Node 22 kann es ausführen. Dass dies funktioniert, wurde auf der Managed Runtime bisher nicht getestet; betrachten Sie es daher als **noch nicht festgelegt**. Beachten Sie das [Speicherlimit](#compute-und-instanzen), falls das Modul groß ist, wie etwa ein Sprach- oder ML-Modell.

### Binärdateien und Kindprozesse

Nichts blockiert `child_process`, aber das Image enthält sehr wenig, was ausgeführt werden könnte: `node`, `npm`, `sh`, `tar` und die PostgreSQL-Client-Tools (`pg_dump`, `pg_restore`). Es gibt kein `ffmpeg`, kein ImageMagick, kein Python und keinen Compiler. Sie können keine Systempakete hinzufügen, da es kein Dockerfile gibt und der Prozess nicht als Root läuft.

Eine Binärdatei, die ein npm-Paket in seinem eigenen Tarball mitführt, wird mit dem Paket installiert. Ob die Ausführung einer solchen unterstützt wird, ist **noch nicht festgelegt**. Eine Binärdatei, die ein Paket im `postinstall` herunterlädt, kommt nie an, da Installationsskripte nicht ausgeführt werden.

Wenn ein Feature eine Binärdatei benötigt, nutzen Sie eine gehostete API für diese Aufgabe oder stellen Sie das Backend auf `runtime: "custom"` um, wo Sie Ihr eigenes Image bauen.

## Compute und Instanzen

Jedes Projekt läuft in seinen eigenen Pods. Arbeitsspeicher und CPU gelten pro Instanz und werden über die [Compute-Einstellungen](/docs/deployment/cloud/#compute-and-what-it-costs) konfiguriert:

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Ein Projekt, für das nie eine Einstellung vorgenommen wurde, läuft als Burstable-Pod: Es reserviert eine kleine Menge und kann darüber hinaus kurzzeitig mehr Ressourcen nutzen. Führen Sie `rebase cloud compute` aus, um die Request- und Limit-Werte zu sehen, die Ihr Projekt tatsächlich hat. Der dokumentierte Standard-Request beträgt `250m` CPU und `512Mi` Arbeitsspeicher; der Plattformcode setzt den Standard derzeit niedriger an, mit einem Burst-Limit von 2 CPU und 2 GiB, weshalb dieser Wert **noch nicht festgelegt** ist.

Instanzen:

- **Standardmäßig eine.** `--replicas` legt eine feste Anzahl zwischen 1 und 5 fest.
- **Autoscaling ist Opt-in.** `--autoscale-max` legt eine Obergrenze von bis zu 16 fest, und `--autoscale-cpu-target` (Standard: 70) definiert die CPU-Auslastung, die der Autoscaler anstrebt.
- **Deployments laufen als Rolling Updates.** Eine neue Instanz startet und wird bereit (ready), bevor die alte stoppt, sodass für kurze Zeit zwei Versionen Traffic bedienen.

`--spot` und `--scale-to-zero` sind standardmäßig beide deaktiviert. Spot-Instanzen werden ohne Vorankündigung neu gestartet. Ob `--scale-to-zero` derzeit wirksam ist, ist **noch nicht festgelegt**; planen Sie mit einer Instanz, die immer läuft.

## Speicher und Status auf Modulebene

Ein Wert auf Modulebene, wie `const cache = new Map()` am Anfang einer Funktionsdatei, verbleibt im Node-Prozess. Er bleibt von einer Anfrage zur nächsten auf derselben Instanz erhalten. Er geht verloren, sobald dieser Prozess beendet wird:

- bei **jedem Deployment**, da bei jedem Deployment neue Instanzen gestartet werden;
- wenn eine **Umgebungsvariable** geändert und bereitgestellt wird;
- wenn eine Instanz neu gestartet, neu zugewiesen oder (mit `--spot`) freigegeben wird.

Bei mehr als einer Instanz verfügt jede über ihre eigene Kopie, sodass zwei Anfragen unterschiedliche Caches sehen können.

Verwenden Sie eine `Map` auf Modulebene als Cache, dessen Verlust Sie verschmerzen können: einen, der die nächste Anfrage beschleunigt, aber nicht die einzige Kopie von irgendetwas ist. Bewahren Sie alles, dessen Erstellung Sie etwas gekostet hat – wie generierte Audiodateien oder eine teure API-Antwort –, in der Datenbank oder im [Storage](#storage-für-generierte-dateien) auf. Für Clients, die Sie nur einmal erstellen, wie etwa ein API-SDK, verwenden Sie `lazyResource`, damit der Client bei der ersten Verwendung aus der Umgebung der Anfrage instanziiert wird. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/) listet den Status auf, den Rebase selbst pro Prozess verwaltet, wie Rate-Limit-Zähler und Realtime-Kanäle.

## Das Dateisystem

Das Dateisystem des Containers ist beschreibbar, und `/tmp` funktioniert. Aber alles, was dorthin geschrieben wird:

- gehört zu einer einzelnen Instanz und ist für andere Instanzen nicht sichtbar;
- wird gelöscht, wenn die Instanz stoppt, also spätestens beim nächsten Deployment;
- teilt sich ein Limit von 6 GiB an ephemerem Speicher mit dem Bundle und den installierten `node_modules`. Eine Instanz, die dieses Limit überschreitet, wird beendet (evicted).

Verwenden Sie es für temporäre Arbeitsdateien während einer einzelnen Anfrage. Verwenden Sie es nicht als deployment-übergreifenden Cache oder als Speicher für Uploads. Das ist auch der Grund, warum [`STORAGE_TYPE=local` in der Produktion deaktiviert ist](/docs/backend/storage/#environment-variables).

## Anfragen

| Limit | Standard | Ändern mit |
|---|---|---|
| Funktions-Timeout | 30 s, dann `504` mit Code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` schaltet ihn aus) |
| Request-Body, alle `/api/*`-Routen | 10 MiB, dann `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in Bytes |
| Request-Body am Edge | 64 MiB | Fest |
| Eine Datei über `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonyme Aufrufe an `/api/functions/*` | 3000 pro IP alle 15 Minuten | `rateLimit.anonymousFunctions` |

Einige Details:

- **Der Timeout beendet das Warten des Aufrufers, nicht die Arbeit.** Nach 30 Sekunden erhält der Aufrufer ein `504`, und `getSignal(c)` wird abgebrochen. Übergeben Sie dieses Signal an `fetch` und alles andere, was ein Signal akzeptiert, damit auch die Hintergrundarbeit stoppt. Siehe [Timeouts und Rate Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **Der Edge hat seinen eigenen Timeout.** Anfragen erreichen Ihre Instanzen über einen Nginx-Ingress, der keinen eigenen Read-Timeout festlegt, sodass der Standardwert des Controllers gilt (60 Sekunden in ingress-nginx). Das Erhöhen von `REBASE_FUNCTIONS_TIMEOUT_MS` darüber hinaus ist **noch nicht festgelegt**: Der Edge schließt möglicherweise vorher die Verbindung. Für Arbeiten, die Minuten dauern, antworten Sie sofort und erledigen Sie die Arbeit in einem [Job](/docs/backend/jobs/) oder in `waitUntil`.
- **Uploads größer als 64 MiB** erfordern den fortsetzbaren (TUS) Upload, der die Datei in Chunks sendet. `client.storage.putObject()` wechselt ab 8 MiB automatisch dazu.
- **Antwortgröße.** Weder die Runtime noch der Edge setzen ein Limit für die Antwortgröße. Eine große Antwort wird dennoch im Speicher gehalten, wenn Ihr Handler sie an einem Stück erstellt; streamen Sie sie daher oder liefern Sie sie aus dem Storage aus.

## Umgebungsvariablen und Secrets

Legen Sie sie mit der CLI oder in der Konsole fest. In `rebase.json` gibt es dafür kein Feld.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Eine Änderung wird beim nächsten Deployment wirksam.** Laufende Instanzen behalten die Werte, mit denen sie gestartet wurden. `set` und `unset` erinnern Sie daran (`Pending redeploy`).
- **Limits:** bis zu 100 Variablen pro Projekt, 32 KiB pro Wert und 256 KiB insgesamt. Namen folgen dem Muster `[A-Za-z_][A-Za-z0-9_]*`.
- **Einige Namen sind reserviert.** Die Plattform setzt `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` und `NODE_ENV` selbst und legt fest, wie der Prozess ausgeführt wird (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Das Setzen eines dieser Werte wird verweigert, und der Fehler listet sie alle auf.
- **`CORS_ORIGINS` stammt von Ihren Domains.** Die Plattform setzt dies auf den Host des Projekts und dessen verifizierte [benutzerdefinierte Domains](/docs/deployment/cloud/#the-rest-of-the-surface), und dieser Wert hat Vorrang vor einem von Ihnen gesetzten. Fügen Sie einen Origin mit `rebase cloud domains` hinzu, nicht mit `env set`.
- **Die Storage-Variablen sind Standardwerte.** Die Plattform schreibt die `STORAGE_*`- und `S3_*`-Variablen für ihren Bucket, und ein von Ihnen gesetzter Wert hat Vorrang.
- **Build-Zeit-Namen werden abgelehnt.** `VITE_`-, `NEXT_PUBLIC_`-, `PUBLIC_`- und `REACT_APP_`-Variablen sind für Frontends zur Build-Zeit gedacht, und das Backend sieht sie niemals rechtzeitig. `--force` speichert sie dennoch.

In einer Funktion lesen Sie diese innerhalb des Handlers aus, niemals am Anfang der Datei:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Ein `process.env`-Lesevorgang auf Modulebene, der leer zurückkehrt, führt dazu, dass die gesamte Datei nicht geladen werden kann und ihre Routen mit `404` antworten. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage für generierte Dateien

Ein Cloud-Projekt erhält Dateispeicher, sobald Sie ihn erstellen:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Oder verweisen Sie das Projekt mit `rebase cloud storage attach` auf einen Bucket, den Sie bereits besitzen (S3, R2, MinIO, jeder S3-kompatible Bucket). Ohne eines von beiden antworten Uploads mit `501 STORAGE_NOT_CONFIGURED`. Weitere Buckets werden in `config/resources.ts` deklariert; siehe [Mehrere Buckets](/docs/backend/storage/#several-buckets).

Ein Deployment mit Storage wird abgelehnt, bis das Projekt festlegt, wer Dateien lesen und schreiben darf. Das `config/storage.ts` des Scaffolds exportiert hierfür einen `storageAuthorize`-Hook. Siehe [Autorisierung pro Objekt](/docs/backend/storage/#per-object-authorization).

**Wie Dateien bereitgestellt werden.** Ihr Backend stellt jede Datei unter `GET /api/storage/file/<key>` bereit. Es liest das Objekt aus dem Bucket und streamt es mit `Content-Type`, Range-Requests und Caching-Headern. Es gibt keine direkte Bucket-URL zum Weitergeben.

- Ein Key unter **`public/`** wird ohne Token für jeden unter einer URL bereitgestellt, die sich nie ändert. Verwenden Sie dies für Dateien, die jeder Besucher laden darf, wie etwa generierte Audiodateien für ein öffentliches Spiel.
- Jeder andere Key ist privat. Ein Client fragt `/api/storage/metadata/<key>` nach einer Download-URL ab, die ein Token enthält, das standardmäßig für 300 Sekunden gültig ist (`STORAGE_DOWNLOAD_TOKEN_TTL`, bis zu einer Woche).

Schreiben Sie aus einer Funktion heraus mit `rebase.storage` (der Standard-Bucket) oder `rebase.bucket(…)` (ein benannter Bucket). Ihr `storageAuthorize`-Hook entscheidet weiterhin, ob der Schreibvorgang zulässig ist.

Bildtransformationen (`?width=`, `?format=`) erfordern `sharp`, was ein natives Modul ist und sich nicht im Managed Image befindet. Auf der Managed Runtime liefert eine Transformationsanfrage das Originalbild zurück.

### Beispiel: Generierte Audiodaten cachen

Eine Funktion, die mit einer gehosteten API Text in Sprache umwandelt, jedes Ergebnis einmal speichert und anschließend aus dem Storage bereitstellt. Die `Map` erspart lediglich einen Storage-Lookup auf einer aufgewärmten Instanz; der Bucket ist der eigentliche Cache, sodass bei einem Deployment nichts verloren geht.

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

Die Route ist öffentlich, wie jede Route in `backend/functions/`, bis Sie sie absichern. Eine produktive Route würde prüfen, wer neue Audiodaten erstellen darf, damit keine Fremden Ihr Budget für die Speech-API aufbrauchen können.

## Ausgehendes Netzwerk

Funktionen können externe Dienste aufrufen. Ausgehende Verbindungen von Ihren Instanzen sind zu jeder Internetadresse ausschließlich auf diesen TCP-Ports zulässig:

| Port | Zweck |
|---|---|
| 80, 443 | HTTP und HTTPS |
| 465, 587 | E-Mail-Versand über SMTP mit TLS oder STARTTLS |
| 993 | IMAP über TLS |

Alles andere ist blockiert. Dazu gehören Port 25, unverschlüsseltes IMAP sowie Datenbanken oder Caches auf ihren eigenen Ports: Ein PostgreSQL auf 5432, Redis auf 6379 oder MongoDB auf 27017 außerhalb von Rebase Cloud kann nicht erreicht werden. Die Cloud-Metadatenadresse (`169.254.169.254`) ist ebenfalls blockiert.

Die Plattform fügt keinen Proxy und kein ausgehendes Rate-Limit hinzu; die von Ihnen aufgerufenen Dienste haben ihre eigenen. Übergeben Sie `getSignal(c)` an `fetch`, damit ein Aufruf stoppt, wenn seine Anfrage ein Timeout erreicht.

Ihr Datenverkehr verlässt das System über eine geteilte Adresse, nicht über eine separate Adresse pro Projekt. Ob diese Adresse für Dienste, die eine Allowlist erfordern, fest und veröffentlicht ist, ist **noch nicht festgelegt**.

## Start und Herunterfahren

- **Kaltstart.** Eine neue Instanz lädt das Bundle herunter und installiert ihre Abhängigkeiten, bevor sie Anfragen bedient. Diese Installation macht den Großteil eines Kaltstarts aus, der typischerweise 40 bis 60 Sekunden dauert. Die Plattform wartet bis zu 300 Sekunden darauf, dass eine Instanz hochfährt. Ein großer Abhängigkeitsbaum verlangsamt jedes Deployment und jedes Hochskalieren.
- **Health.** Die Plattform prüft `/livez` (der Prozess läuft) und `/health` (sie kann die Datenbank erreichen). Beide werden von der Runtime bereitgestellt, sodass Sie diese nicht schreiben müssen.
- **Herunterfahren.** Bei einem Deployment oder Neustart nimmt die Instanz keine neuen Anfragen mehr an, wartet 5 Sekunden, bis der Datenverkehr umgeleitet wurde, und erhält dann `SIGTERM`. Laufende Anfragen haben bis zu 15 Sekunden Zeit, um abgeschlossen zu werden. Promises, die an `waitUntil` übergeben wurden, erhalten davon bis zu 5 Sekunden. Ein Promise, das Sie nicht an `waitUntil` übergeben haben, wird verworfen. Siehe [Hintergrundarbeit](/docs/backend/custom-functions/#background-work).

## Wann Managed nicht die richtige Wahl ist

Stellen Sie das Backend auf `"runtime": "custom"` um, wenn es Folgendes benötigt:

- ein natives Modul oder eine System-Binärdatei wie `sharp`, `ffmpeg` oder eine lokale Speech-Engine;
- Systempakete oder ein anderes Basis-Image;
- eine langlebige Verbindung zu Zielen außerhalb der zulässigen Ports.

Eine benutzerdefinierte Runtime baut Ihr eigenes Dockerfile, und Sie verwalten das Image fortan selbst. `rebase cloud deploy --eject` führt den Wechsel durch. Siehe [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Noch nicht festgelegt

Diese Fragen haben im Code der Plattform noch keine endgültige Antwort. Fragen Sie nach, bevor Sie sich auf eine davon verlassen.

- **WebAssembly.** Es ist nicht blockiert, wurde jedoch weder getestet noch zugesichert.
- **Ausführen einer Binärdatei, die in einem npm-Paket mitgeliefert wird.** Es ist nicht blockiert, wird aber auch nicht unterstützt.
- **Standard-CPU und -Arbeitsspeicher.** Der dokumentierte Standard (`250m`, `512Mi`) und der aktuelle Plattformstandard (geringerer Request, Burst auf 2 CPU und 2 GiB) stimmen nicht überein. `rebase cloud compute` zeigt an, was Ihr Projekt hat.
- **Scale to zero.** Die Option `--scale-to-zero` wird akzeptiert. Ob sie derzeit die Ausführung des Projekts tatsächlich beeinflusst, ist nicht bestätigt.
- **Anfragen, die länger als 60 Sekunden dauern.** Der Funktions-Timeout kann erhöht werden, aber der vorgeschaltete Edge schließt die Verbindung möglicherweise gemäß seinem eigenen Standardwert.
- **Eine feste ausgehende IP-Adresse**, die für eine Allowlist von Drittanbietern verwendet werden kann.
- **Ein Browser-Origin, der keine der Projekt-Domains ist**, wie etwa ein anderweitig gehostetes Frontend. Das `CORS_ORIGINS` der Plattform hat Vorrang vor Ihrem.
- **Private npm-Registries.** Die Abhängigkeitsinstallation liest keine `.npmrc` oder Tokens aus, weshalb private Pakete anscheinend nicht installiert werden können.
- **Log-Aufbewahrung.** `rebase cloud logs --runtime` zeigt die letzten Ausgaben; wie lange Logs aufbewahrt werden, ist nicht dokumentiert.

## Verwandte Seiten

- [Rebase Cloud](/docs/deployment/cloud/): Verknüpfung, Deployment, die Compute-Einstellungen und was die Beta nicht enthält
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/): Schreiben der Routen in `backend/functions/`
- [Runtime und Bundles](/docs/architecture/runtime-and-bundles/): Was ein Bundle ist und wie die Runtime es startet
- [Storage](/docs/backend/storage/): Buckets, Endpunkte, Größenbeschränkungen und Zugriffsregeln
- [Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/): Der Status, den Rebase pro Prozess verwaltet
