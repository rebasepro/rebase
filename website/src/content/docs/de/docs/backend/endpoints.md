---
sourceHash: 169899c54121eb6e
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Authentifizierung, Speicher, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede vom Server bereitgestellte Route in einer Tabelle, zusammen mit den Voraussetzungen für den Zugriff.

Die Pfade gehen vom standardmäßigen `basePath` von `/api` aus; `REBASE_BASE_PATH` verschiebt alle gemeinsam. `/health`, `/livez` und `/metrics` liegen absichtlich außerhalb, da ein Orchestrator `/health` abfragt und den Basispfad nicht kennen muss. `/health` ist *auch* darunter eingebunden, sodass `/api/health` auf dieselbe Weise antwortet, anstatt genau in dem Moment einen 404-Fehler zu liefern, in dem geprüft wird, ob der Server erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – vergleicht diese Tabelle mit den im Quellcode registrierten Routen, sodass keine neue Schnittstelle hinzugefügt werden kann, ohne hier aufgeführt zu werden.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann dies aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Zugriffstoken oder ein für die Operation berechtigter API-Schlüssel |
| **`resource:action`** | Ein Aufrufer, der diesen [Scope](/docs/backend/roles-and-scopes/) besitzt: ein Administrator, eine Person, deren Rolle ihn deklariert, ein damit erstellter API-Schlüssel oder der Service-Schlüssel |
| **RLS** | Authentifiziert, und die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung bereitgestellt |

## Daten

Wird pro Collection generiert, sodass die Pfade Ihre Slugs statt einer festen Liste enthalten. `:slug` ist der `slug` einer Collection.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Anzahl, Abfrageparameter im Body – [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias von `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optionales Upsert – [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen anhand der ID aktualisieren – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen anhand der ID löschen – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Schreibvorgänge über mehrere Collections hinweg in einer einzigen Transaktion – [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Zählung und Aggregation sind eigene Routen, die vor `/:id` registriert werden, damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind deren Parameter, und `select` ist für `/aggregate` erforderlich.

Textsuche, Vektorsuche, Einbeziehung von Relationen und Feldauswahl *sind* Abfrageparameter für `GET /api/data/:slug` und keine separaten Routen – `searchString`, `vector_search`, `include`, `fields`. Siehe [REST API](/docs/backend/api/).

Ein Projekt, das keine Collections deklariert und keine introspeziert, liefert für dieses Präfix lediglich ein `404 NO_COLLECTIONS`. Siehe [Backend only](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Anmeldebildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung des Administrators ausstehend ist |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink an die neue Adresse – [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungstoken und eine Sitzung oder das Passwort, um sie beizubehalten) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmalcodes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmalcodes per E-Mail |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, sofern nicht `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, sofern nicht `AUTH_ALLOW_USER_LOOKUP` – stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (ein laufender Anmeldevorgang) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Jeder Scope, den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt – [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (ein Konto) | Die eigenen [persönlichen Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartext-Schlüssel wird nur einmal zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, sofern die Users-Collection nicht `auth.personalKeys` festlegt |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signierung](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede Oberfläche benennt ihren eigenen: `users:read` listet Konten auf, `cron:write` löst einen Job aus. Ein Administrator besitzt alle davon, ebenso wie der Service-Schlüssel. Eine Person besitzt diejenigen, die ihre Rollen deklarieren, und ein API-Schlüssel diejenigen, mit denen er erstellt wurde. Ein auf eine Collection beschränkter Schlüssel hat hierauf keinen Zugriff. Siehe [Roles and scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Administrator existiert | In Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen, die über die des Aufrufers hinausgehen, werden verweigert |
| `GET` | `/api/admin/users/pick` | `users:read`, oder Schreibzugriff auf eine Collection mit einem `userSelect`-Feld | Der [Lesezugriff der Benutzerauswahl](/docs/backend/auth-endpoints/): nur id, name, email und avatar. Eine Collection, deren Schreibregeln reines SQL sind, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Wird für ein Konto verweigert, das mehr Berechtigungen besitzt als der Aufrufer |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Wird für ein Konto verweigert, das mehr Berechtigungen besitzt als der Aufrufer |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Gibt ein temporäres Passwort aus |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos, beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | <span class="since-badge" data-since="0.27">Seit 0.27</span> Gäste, sortiert nach der am längsten zurückliegenden Aktivität. `?lastSeenBefore=` grenzt sie auf das ein, was der nachfolgende Löschvorgang erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | <span class="since-badge" data-since="0.27">Seit 0.27</span> Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` aktiv waren (dieser Parameter ist erforderlich). Antwortet mit `{ deleted, skipped, remaining }`. Wiederholen, solange `remaining` nicht 0 ist, wobei `?offset=` auf die Anzahl der übersprungenen Gäste gesetzt wird. Reguläre Konten können nicht erreicht werden |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | <span class="since-badge" data-since="0.27">Seit 0.27</span> Löscht einen Gast. Ein reguläres Konto wird mit `NOT_ANONYMOUS` abgelehnt |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die vom Projekt deklarierten Rollen mit ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals ein API-Schlüssel |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartext-Schlüssel wird nur einmalig bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Einen Job jetzt ausführen. `?async=1` antwortet mit `202`, sobald er gestartet wurde – [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup-Übersicht |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streamt ein Backup. Mit `?token=` aus einem Download-Link ist kein Header erforderlich, ausschließlich für dieses Backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Ein Link zu einem Backup, `{ key }` → `{ url, token, expiresIn }`, gültig für 60 Sekunden – [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien, die von keiner Zeile referenziert werden, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es sich um einen `storage.orphans`-Job in der Job-Queue handelt, `in-process`, wenn der Server ihn selbst ausführt). Dessen Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Sobald `completed`: `result`, der Bericht, den das alte `GET /orphans` zurückgab. Ein Durchlauf, der 10 Minuten lang keine Rückmeldung mehr liefert, wird als `failed` beantwortet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht die verwaisten Dateien eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird erneut gegen jede Zeile und jeden Verlaufseintrag geprüft und unmittelbar vor dem Löschen nochmals abgefragt. Das Ergebnis ist das `deletion`-Feld des Scan-Datensatzes. `409` mit `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Collection nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, eine Seite pro Aufruf – was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` für `deleteSource` zwischen zwei Quellen, die am selben Ort speichern |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einer Verschiebung mit demselben Body erneut auf, eine Seite pro Aufruf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede Datei, die mit `deleteSource` immer noch in der Quelle verbleibt, bzw. jede Datei, von der das Ziel ohne diese Option keine Kopie besitzt. `rebase storage move` fragt dies ab, wenn die Verschiebung abgeschlossen ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der Puffer der jüngsten Logs |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regelrollen von Benutzern und aktive Service-Schlüssel, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Collection, wie sie von `{ role?, userId?, apiKeyId? }` erreicht wird: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scope oder RLS, maskierte Felder. Nur für Administratorsitzungen |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streamt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV – [Studio](/docs/studio/)s „Download full result as CSV“ |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Richtlinien und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branches in dessen übergeordneten Branch (Parent), `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine der beiden Seiten seit dem Diff geändert hat oder Zeilen im Konflikt stehen |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet sie niemals an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur eine Person, sofern nicht `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) – schreibt den Collection-Quellcode neu |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport erfasst hat, statt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das erfasste Postfach |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch unter ihren Pfaden aus Versionen vor 0.17 ohne das Segment `/admin` bereitgestellt. Diese Aliase sind für Projekte gedacht, die noch nicht umgestellt wurden; schreiben Sie neuen Code stets gegen den kanonischen Pfad.

## Storage

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, pro Schlüssel | [Storage](/docs/backend/storage/#storage-endpoints): Metadaten für bis zu 100 Objekte |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Speicherquellen, die dieses Backend bedient |
| `OPTIONS` | `/api/storage/tus` | none | Fortsetzbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Fortsetzbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Fortsetzbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Fortsetzbare Uploads: Anfügen |
| `DELETE` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Fortsetzbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher liefert für dieses Präfix einen `501`-Fehler mit Nennung der benötigten Variable, anstatt mit 404 so zu antworten, als gäbe es das Feature nicht – mit Ausnahme von `GET /api/storage/sources`, das mit `200` und einer leeren Liste antwortet.

## Functions

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| any | `/api/functions/<name>` | was immer die Funktion deklariert. Ein API-Schlüssel benötigt außerdem `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, die Pfade stammen also aus Ihrem Projekt. `GET /api/functions` listet sie nur für einen angemeldeten Aufrufer auf – eine Sitzung, einen API-Schlüssel oder den Service-Schlüssel – und antwortet allen anderen mit `401`: Eine Übersicht der benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reine Liveness: Läuft dieser Prozess. Greift nicht auf die Datenbank zu, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Berichtet über jede konfigurierte Datenquelle, nicht nur über die standardmäßige |
| `GET` | `/api/docs` | none (`schema:read`, wenn `enableSwagger` auf `false` steht, dem Standardwert der Runtime in der Produktion) | Das OpenAPI-3.0-Dokument |
| `GET` | `/api/swagger` | none | Swagger UI. Nur außerhalb der Produktionsumgebung; `REBASE_ENABLE_SWAGGER` kann dies in der Produktion nicht aktivieren. Wird auch in der Entwicklung nicht bereitgestellt, wenn `enableSwagger` auf `false` steht |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version, sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | Der vollständige Collection-Contract für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, falls gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server statt über einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Nur bereitgestellt, wenn `REBASE_MCP_ENABLED=true`, was auch `REBASE_PUBLIC_URL` erfordert – siehe [Configuration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig deaktiviert: keine `REBASE_ROLE` aktiviert dies, da dadurch Software von Drittanbietern Zugriff auf das Projekt erhält und dies eine Entscheidung ist, die eine Person treffen muss.

Die `.well-known`-Dokumente befinden sich am **Origin**, nicht unter `basePath`: RFC 8414 und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab, bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC-9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfad-Suffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC-8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer** (oder als derjenige, für den der Schlüssel agiert), sodass jeder Lese- und Schreibvorgang demselben RLS unterliegt. Die `data:*`-Scopes entscheiden darüber, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst geprüft, sodass ein fehlendes oder veraltetes Token stattdessen den `401`-Challenge erhält |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt verwaltet keine Sitzung, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | rate-limited | Dynamische Client-Registrierung nach RFC 7591. Wird abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Einwilligungsbildschirm (Consent Screen), zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort der Person darauf – zustimmen oder ablehnen |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Tauscht einen Authorization-Code aus oder aktualisiert ein Token |
| `POST` | `/api/oauth/revoke` | client credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Widerruft eine Autorisierung, sodass eine Person eine Einwilligung ohne Administrator rückgängig machen kann |

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth endpoints](/docs/backend/auth-endpoints/) – Anfrage- und Antwortstrukturen für die obige Auth-Tabelle
- [Environment & Configuration](/docs/getting-started/configuration/) – die Umgebungsvariablen, die bestimmen, welche davon bereitgestellt werden
