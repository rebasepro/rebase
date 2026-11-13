---
sourceHash: fbd8c85494a26511
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Speicher, Admin, Meta – inklusive der jeweiligen Zugriffskontrolle (Gate) und der Dokumentationsseite, die sie erklärt.
---

Alle Routen, die der Server bereitstellt, in einer Tabelle – zusammen mit den Voraussetzungen für den Zugriff.

Die Pfade setzen den Standard-`basePath` von `/api` voraus; `REBASE_BASE_PATH` verschiebt
alle Pfade gemeinsam. `/health`, `/livez` und `/metrics` liegen bewusst außerhalb,
da ein Orchestrator `/health` abfragt (Probe) und den Basispfad nicht kennen
müssen sollte. `/health` ist *zusätzlich* darunter eingebunden, sodass `/api/health`
auf dieselbe Weise antwortet, anstatt mit einem 404-Fehler zu reagieren, genau in
dem Moment, in dem jemand prüft, ob der Server erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – gleicht diese
Tabelle mit den im Quellcode registrierten Routen ab, sodass keine neue Schnittstelle
hinzugefügt werden kann, ohne hier aufgeführt zu sein.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Unauthentifiziert. Jeder, der den Host erreichen kann, kann diesen Endpunkt aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein API-Schlüssel mit Gültigkeit für die Operation |
| **`resource:action`** | Ein Aufrufer mit diesem [Scope](/docs/backend/roles-and-scopes/): ein Administrator, ein Benutzer, dessen Rolle diesen deklariert, ein damit erstellter API-Schlüssel oder der Service-Schlüssel |
| **RLS** | Authentifiziert, und die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Wird nur außerhalb von Produktionsumgebungen bereitgestellt |

## Data

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wird pro Tabelle generiert, sodass die Pfade Ihre Slugs statt einer festen
Liste enthalten. `:slug` ist der Slug einer Tabelle (ihr Name, es sei denn, `defineTable` legt `slug` fest).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Anzahl, Abfrageparameter im Body – [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Berechnet eine materialisierte View neu, bei Views, die materialisiert sind – [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias für `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optionales Upsert – [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen nach ID aktualisieren – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen nach ID löschen – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Tabellenübergreifend in einer Transaktion schreiben – [Writing over REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Zählung und Aggregation sind eigene Routen, die vor `/:id` registriert werden,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=`
sind deren Parameter, und `select` ist bei `/aggregate` erforderlich.

Textsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl *sind*
Abfrageparameter bei `GET /api/data/:slug` und keine eigenen Routen – `searchString`,
`vector_search`, `include`, `fields`. Siehe [REST API](/docs/backend/api/).

Ein Projekt, das keine Tabellen deklariert und keine introspektiert, liefert unter diesem
Präfix lediglich ein `404 NO_TABLES` aus. Siehe [Backend only](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Anmeldebildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung eines Administrators aussteht |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft alle anderen Sitzungen |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink per E-Mail an die neue Adresse – [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungstoken und eine Sitzung oder das Passwort, um sie beizubehalten) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmalcodes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmalcodes per E-Mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Seit 0.31</span> [Device sign-in](/docs/backend/device-sign-in/). Deaktiviert, es sei denn, das Backend aktiviert es |
| `POST` | `/api/auth/device/token` | none (ein Gerätecode) | [Device sign-in](/docs/backend/device-sign-in/): Abruf (Polling) durch das Gerät |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): Anzeige auf der Freigabeseite |
| `POST` | `/api/auth/device/approve` | session (`aal2` mit zweitem Faktor) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, außer bei `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer bei `AUTH_ALLOW_USER_LOOKUP` – stellt eine Aufzählungsschnittstelle (Enumeration Surface) dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (ein laufender Anmeldevorgang) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Jeder Scope, den dieses Backend kennt, sowie diejenigen, die der Aufrufer besitzt – [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (ein Konto) | Die eigenen [persönlichen Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartext-Schlüssel wird nur einmal zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Auth-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signaturen](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert sind |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede
Oberfläche benennt ihren eigenen: `users:read` listet Konten auf, `cron:write` stößt
einen Job an. Ein Administrator besitzt alle davon, ebenso wie der Service-Schlüssel.
Ein Benutzer besitzt die Scopes, die seine Rollen deklarieren, und ein API-Schlüssel
diejenigen, mit denen er erstellt wurde. Ein auf eine Tabelle beschränkter Schlüssel
hat hierauf keinen Zugriff. Siehe [Roles and scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Administrator existiert | In Produktionsumgebungen verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen, die über die des Aufrufers hinausgehen, werden verweigert |
| `GET` | `/api/admin/users/pick` | `users:read` oder Schreibzugriff auf eine Tabelle mit einer `.userId()`-Spalte | Lesezugriff für den [Benutzer-Picker](/docs/backend/auth-endpoints/): nur ID, Name, E-Mail und Avatar. Eine Tabelle, deren Schreibregeln aus reinem SQL bestehen, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Verweigert für ein Konto, das über mehr Berechtigungen verfügt als der Aufrufer |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Verweigert für ein Konto, das über mehr Berechtigungen verfügt als der Aufrufer |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Erstellt ein temporäres Passwort |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos und beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | Gäste, sortiert nach dem am längsten zurückliegenden letzten Zugriff. `?lastSeenBefore=` grenzt sie auf das ein, was der nachfolgende Löschvorgang erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` gesehen wurden (Pflichtparameter). Gibt `{ deleted, skipped, remaining }` zurück. Wiederholen, solange `remaining` nicht 0 ist, wobei `?offset=` auf die Anzahl der übersprungenen Gäste gesetzt wird. Reguläre Konten können darüber nicht erreicht werden |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Löscht einen Gast. Bei einem regulären Konto wird dies mit `NOT_ANONYMOUS` verweigert |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die vom Projekt deklarierten Rollen samt ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals ein API-Schlüssel |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartext-Schlüssel wird nur einmal bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Einen Job jetzt ausführen. `?async=1` antwortet mit `202`, sobald er gestartet wurde – [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup-Übersicht |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streamt ein Backup. Mit `?token=` aus einem Download-Link ist kein Header erforderlich – ausschließlich für dieses Backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Ein Link zu einem Backup, `{ key }` → `{ url, token, expiresIn }`, gültig für 60 Sekunden – [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien, auf die keine Zeile verweist, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es sich um einen `storage.orphans`-Job in der Job-Queue handelt, `in-process`, wenn der Server ihn selbst ausführt). Der Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Nach Abschluss (`completed`): `result`, der Bericht, den das frühere `GET /orphans` lieferte. Ein Durchlauf, der 10 Minuten lang keine Rückmeldung gegeben hat, wird als `failed` gemeldet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht die verwaisten Dateien eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird erneut gegen jede Zeile und jeden Verlaufseintrag geprüft und unmittelbar vor dem Löschen nochmals abgefragt. Das Ergebnis ist das `deletion`-Feld des Scan-Datensatzes. `409` bei `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Tabelle nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, seitenweise pro Aufruf – das, was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` bei `deleteSource` zwischen zwei Quellen, die am selben Ort speichern |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einem Verschiebevorgang mit demselben Body erneut seitenweise auf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede Datei, die sich mit `deleteSource` noch in der Quelle befindet; jede Datei, für die das Ziel ohne diese Option keine Kopie besitzt. `rebase storage move` fragt diesen Endpunkt ab, wenn der Vorgang beendet ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der Puffer der aktuellen Logs |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regel-Rollen von Benutzern und aktive Service-Schlüssel, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Tabelle so, wie `{ role?, userId?, apiKeyId? }` darauf zugreift: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scope oder RLS, maskierte Felder. Nur mit Administrator-Sitzung |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streamt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV – [Studio](/docs/studio/)-Funktion „Download full result as CSV“ |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Policies und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branchs in dessen Parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine Seite seit dem Diff geändert hat oder Zeilen im Konflikt stehen |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet niemals eine an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur eine Person, es sei denn, `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plant das Lockern von `NOT NULL` und das Löschen der in `drop` genannten, nicht deklarierten Spalten für [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); wendet niemals Änderungen an |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Wendet einen Reconcile-Plan an, aber nur, wenn dessen `digest` mit dem gesendeten `confirm` übereinstimmt |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Ob der Editor verfügbar ist und der Grund, falls nicht |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Jede Tabelle, die `backend/schema/index.ts` exportiert, so wie der Editor sie liest, einschließlich dessen, was im Code bearbeitet wird (schreibgeschützt) und warum – [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> `{ patches: TablePatch[] }`: die Dateien, die die Bearbeitung schreiben würde, kompiliert; schreibt nichts |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselbe Bearbeitung, geschrieben nach `backend/schema`; die Datenbank bleibt unberührt |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Tabellen, die in der Datenbank vorhanden sind, aber in `backend/schema` nicht deklariert wurden: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Eine davon beschrieben: `{ table: { …, descriptor, rlsRaised?, notes } }`, für „Import an existing table“. `404`, wenn unbekannt oder bereits deklariert, `400 SCHEMA_EDIT_REFUSED` ohne Primärschlüssel |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die `defineFirestoreCollection`-Aufrufe in `frontend/src/cms`, die der Editor umschreiben kann (nur Entwicklungsumgebung) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die Dateien, die eine Bearbeitung eines dieser Aufrufe schreiben würde; schreibt nichts |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselbe Bearbeitung, direkt vor Ort geschrieben. `409 SCHEMA_EDIT_STALE_FILE`, wenn sich die Datei auf der Festplatte geändert hat |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die UI-Einstellungen des Workspace pro Tabelle, die eigenen des Aufrufers und ob der Aufrufer die Einstellungen des Workspace schreiben darf – siehe [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Führt ein `UiTablePreferences`-Delta in die Workspace-Einstellungen einer Tabelle zusammen (`replace` ersetzt). Geschrieben nach `frontend/src/cms/ui-config.json`, wo der Server Schreibrechte auf den Projektquellcode hat, andernfalls nach `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Entfernt die Workspace-Einstellungen einer Tabelle |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (eine Person) | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die eigenen Einstellungen des Aufrufers für eine Tabelle. Ein API-Schlüssel hat keine: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (eine Person) | <span class="since-badge" data-since="0.31">Seit 0.31</span> Entfernt die eigenen Einstellungen des Aufrufers für eine Tabelle |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das Postfach der abgefangenen E-Mails |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden aus Versionen vor 0.17 ohne das Segment `/admin` bereitgestellt. Diese Aliase
sind für Projekte gedacht, die noch nicht umgestellt wurden; schreiben Sie neuen Code gegen den kanonischen Pfad.

## Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session oder Zugangsdaten mit `schema:read` oder einem `data:*`-Scope | Jede Tabelle, die dieses Backend bereitstellt, als JSON-Array von Deskriptoren, bereinigt (redigiert) für den Aufrufer |
| `GET` | `/api/schema/tables/:slug` | wie oben | Ein Deskriptor. `404 TABLE_NOT_FOUND`, wenn diese Tabelle für den Aufrufer nicht bereitgestellt wird |

Aus den Deskriptoren rendert das CMS seine Standardwerte, das Studio
den Schema-Visualizer sowie den RLS-Editor und die MCP-Apps
Tabellen und Formulare. Sie enthalten Spalten mit ihren Postgres-Typen,
Nullability, Validierungs- und Speicherregeln, Relationen nach Slug sowie den
Status der Row-Level Security. Hook-Code verlässt niemals den Server: Ein Deskriptor
gibt lediglich an, welche Hooks eine Tabelle besitzt.

Was für einen Aufrufer bereitgestellt wird, hängt davon ab, wer er ist:

| Aufrufer | Tabellen | Redigiert (Ausgeblendet) |
|---|---|---|
| Ein Administrator, ein Inhaber von `schema:read` oder der Service-Schlüssel | Jede Tabelle, einschließlich einfacher Views | `.private()`-Spalten, für alle |
| Jede andere angemeldete Person, einschließlich Gäste | Nur die Tabellen, die eine zustimmende (permissive) Regel für ihre Rollen erreicht (plus die Auth-Tabelle und materialisierte Views, deren `roles` sie besitzen) | Spalten und Relationen, bei denen ihre Rollen `access.read` nicht erfüllen; `.private()`-Spalten; nur die Regeln, die für ihre Rollen gelten können; Relationen zu Tabellen, die ihnen nicht bereitgestellt werden; Hook-Flags; rohes SQL in Regeln, kompilierte Policies, View-Abfragen und Indizes |
| Zugangsdaten (API-Schlüssel, MCP- oder Plattform-Token) | Die Tabellen, die ihre `data:*`-Scopes benennen, oder alle bei Vorhandensein von `schema:read` | Wie oben, bewertet anhand der vorhandenen Scopes |
| Niemand angemeldet | Keine – `401` –, es sei denn, das Backend setzt `schemaTables: { public: true }` | Dann die Tabellen mit einer öffentlichen `select`-Regel, redigiert wie für den am wenigsten privilegierten Aufrufer: keine Spalte mit einer `access.read`-Liste, kein rohes SQL, keine Policies |

Eine Person behält `metadata`, `softDelete`, `tenant`, `history` und `search` bei
den Tabellen, die für sie bereitgestellt werden. `schemaTables: { persons: "all" }` in den Backend-Optionen
beschreibt jede Tabelle und Regel für jeden angemeldeten Aufrufer; der
Standardwert ist `"granted"`. MCP-Verbindungen werden durch denselben Serialisierer
als Zugangsdaten eingestuft.

Zugangsdaten, die weder `schema:read` noch einen `data:*`-Scope besitzen, erhalten
`403 SCOPE_MISSING`. Ein Backend ohne konfigurierte Authentifizierung beantwortet
jede Anfrage mit `404 SCHEMA_UNAVAILABLE`: Es gibt keinen Aufrufer, für den redigiert werden könnte, und
`auth.requireAuth: false` ändert daran nichts.

Antworten enthalten `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` und den Header `x-rebase-schema`; eine Anfrage, deren `If-None-Match`
den aktuellen Tag nennt, erhält `304`. Der Tag ändert sich, wenn sich das Schema ändert,
auch nach einer Live-Schema-Bearbeitung.

`schemaTables` ist eine Option von `initializeRebaseBackend` ohne eigene
Umgebungsvariable: Ein erstelltes Projekt greift darauf über Eject zu.

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
| `GET` | `/api/storage/sources` | session | Die benannten Speicherquellen, die dieses Backend bereitstellt |
| `OPTIONS` | `/api/storage/tus` | none | Wiederaufnehmbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Wiederaufnehmbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher beantwortet Anfragen unter diesem Präfix mit `501` unter
Angabe der benötigten Variable, anstatt einen 404-Fehler zu werfen, als ob das Feature nicht existierte –
ausgenommen `GET /api/storage/sources`, das mit `200` und einer leeren Liste antwortet.

## Functions

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| any | `/api/functions/<name>` | Was immer die Funktion deklariert. Ein API-Schlüssel benötigt zusätzlich `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, die Pfade stammen also aus Ihrem
Projekt. `GET /api/functions` listet sie nur für angemeldete Aufrufer auf – eine
Sitzung, einen API-Schlüssel oder den Service-Schlüssel – und antwortet allen anderen mit `401`: Ein
Verzeichnis der benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reiner Liveness-Check: Läuft dieser Prozess. Greift nicht auf die Datenbank zu, weshalb dies der Prüfpfad (Probe Path) ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Berichtet über jede konfigurierte Datenquelle, nicht nur über die Standardquelle |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Seit 0.31</span> standardmäßig die Zielgruppe des Schema-Endpunkts (401 für Anonyme, es sei denn `schemaTables.public`, 403 für Zugangsdaten ohne Schema- oder Daten-Scope); none, wenn `enableSwagger` auf `true` steht; das Admin-Gate, wenn `false` | Das OpenAPI 3.0-Dokument der Tabellen, die `GET /api/schema/tables` für den Aufrufer beschreibt (alle Tabellen bei `enableSwagger: true`). `404 DOCS_UNAVAILABLE`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/api/swagger` | none | Swagger UI. Nur wenn `enableSwagger` auf `true` steht, und niemals in Produktion |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version – sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` – jede Tabelle, wie ein Administrator sie sieht, die Eingabe für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur bereitgestellt, wenn `REBASE_MCP_ENABLED=true`, was auch
`REBASE_PUBLIC_URL` erfordert – siehe
[Configuration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig
deaktiviert: Kein `REBASE_ROLE` aktiviert dies automatisch, da dadurch Software von
Drittanbietern Zugriff auf das Projekt gewährt wird, und dies ist eine Entscheidung, die eine Person treffen muss.

Die `.well-known`-Dokumente liegen am **Origin** (der Server-Wurzel), nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC 9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfad-Suffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC 8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Der Endpunkt des MCP-Protokolls. Agiert **als der angemeldete Benutzer** (oder als derjenige, für den der Schlüssel agiert), sodass jeder Lese- und Schreibvorgang demselben RLS unterliegt. Die `data:*`-Scopes bestimmen, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst überprüft, sodass bei einem fehlenden oder abgelaufenen Token stattdessen die `401`-Challenge zurückgegeben wird |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt hält keine Sitzung, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | Ratenbegrenzt | Dynamische Client-Registrierung nach RFC 7591. Abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm (Consent Screen), zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort der Person darauf – genehmigen oder ablehnen |
| `POST` | `/api/oauth/token` | Client-Credentials + PKCE | Tauscht einen Autorisierungscode aus oder aktualisiert (Refresh) |
| `POST` | `/api/oauth/revoke` | Client-Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer genehmigt hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Genehmigung zurück, sodass eine Person eine Zustimmung ohne Administrator rückgängig machen kann |

Der eigene MCP-Endpunkt des Admin-Panels ist nicht Teil dieser Schnittstelle: Er verwendet die
Sitzung des Admin-Panels, niemals ein OAuth-Token, und wird zusammen mit den Admin-Routen
bereitgestellt – unabhängig davon, ob `REBASE_MCP_ENABLED` gesetzt ist –, auf einem
Treiber, der jeden Aufruf auf RLS beschränkt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, niemals anonym | **Experimentell.** Dieselben Tools wie bei `/mcp`, für die angemeldete Person, mit `data:read`, `data:write` und `data:delete`, unter ihrem RLS. Das `savedAppsView` des Admin-Panels öffnet [gespeicherte Apps](/docs/ai/remote-mcp/) darüber |

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth endpoints](/docs/backend/auth-endpoints/) – Anfrage- und Antwortstrukturen für die obige Auth-Tabelle
- [Environment & Configuration](/docs/getting-started/configuration/) – die Variablen, die bestimmen, welche dieser Routen bereitgestellt werden
