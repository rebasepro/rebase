---
sourceHash: 724a8d58e7df46ee
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Storage, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede Route, die der Server bereitstellt, in einer Tabelle zusammengefasst, inklusive der Voraussetzungen, um sie zu erreichen.

Die Pfade gehen vom Standard-`basePath` `/api` aus; `REBASE_BASE_PATH` verschiebt alle
gemeinsam. `/health`, `/livez` und `/metrics` liegen absichtlich außerhalb,
da ein Orchestrator `/health` abfragt und den Basispfad nicht kennen
müssen sollte. `/health` ist *auch* darunter eingebunden, sodass `/api/health` genauso
antwortet, anstatt genau in dem Moment einen 404-Fehler auszugeben, in dem jemand prüft, ob der Server
erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – vergleicht diese
Tabelle mit den im Quellcode registrierten Routen, sodass keine neue Schnittstelle hinzugefügt
werden kann, ohne hier zu erscheinen.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann dies aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein API-Schlüssel, der für die Operation berechtigt ist |
| **`resource:action`** | Ein Aufrufer, der diesen [Scope](/docs/backend/roles-and-scopes/) besitzt: ein Admin, eine Person, deren Rolle dies deklariert, ein damit erstellter API-Schlüssel oder der Service-Schlüssel |
| **RLS** | Authentifiziert, und danach entscheidet die Datenbank Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung bereitgestellt |

## Daten

Wird pro Tabelle generiert, daher enthalten die Pfade Ihre Slugs anstelle einer festen
Liste. `:slug` ist der Slug einer Tabelle (ihr Name, es sei denn, `defineTable` setzt `slug`).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Anzahl, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST-API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Berechnet eine materialisierte View neu, bei Views, die materialisiert sind – [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias für `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional per Upsert – [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen nach ID aktualisieren – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen nach ID löschen – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Tabellenübergreifend in einer einzigen Transaktion schreiben – [Schreiben über REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity-Historie](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity-Historie](/docs/backend/history/) |

`:id` ist der Schlüssel der Zeile. Bei einer Tabelle mit zusammengesetztem Primärschlüssel ist es der Wert jeder Schlüsselspalte
in der Reihenfolge des Schlüssels, verbunden durch `:::` (jeder Teil URL-codiert):
Eine Tabelle mit dem Schlüssel `(agency_id, id)` adressiert eine Zeile als
`/api/data/proposals/<agency_id>:::<id>`. Eine Adresse mit der falschen Anzahl von
Teilen wird mit `400 COMPOSITE_KEY_ADDRESS` abgelehnt, wobei die Schlüsselspalten benannt werden.

Zählen und Aggregation sind eigene Routen, die vor `/:id` registriert sind,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind
deren Parameter, und `select` ist für `/aggregate` erforderlich.

Textsuche, Vektorsuche, das Einbinden von Relationen und die Feldauswahl *sind* Abfrageparameter
auf `GET /api/data/:slug` anstatt eigener Routen – `searchString`,
`vector_search`, `include`, `fields`. Siehe [REST-API](/docs/backend/api/).

Ein Projekt, das keine Tabellen deklariert und keine introspektiert, liefert für dieses Präfix
einheitlich `404 NO_TABLES` aus. Siehe [Nur Backend](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Anmeldebildschirm anbieten kann: Registrierung, Passwort-Reset, Magic-Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung des Admins noch aussteht |
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink an die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungs-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungs-Token und eine Session oder das Passwort, um sie beizubehalten) | [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/device` | none | [Geräte-Anmeldung](/docs/backend/device-sign-in/). Deaktiviert, sofern vom Backend nicht aktiviert |
| `POST` | `/api/auth/device/token` | none (ein Geräte-Code) | [Geräte-Anmeldung](/docs/backend/device-sign-in/): Polling des Geräts |
| `GET` | `/api/auth/device/:userCode` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/): was die Genehmigungsseite anzeigt |
| `POST` | `/api/auth/device/approve` | session (`aal2` mit einem zweiten Faktor) | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, außer `ALLOW_ANONYMOUS` ist gesetzt |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer `AUTH_ALLOW_USER_LOOKUP` ist gesetzt – stellt eine Angriffsfläche für Benutzerzählung (Enumeration) dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (eine laufende Anmeldung) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Jeder Scope, den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt – [Rollen und Scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (ein Konto) | Die eigenen [persönlichen Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartextschlüssel wird nur einmal zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Auth-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signierung](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede
Schnittstelle definiert ihren eigenen: `users:read` listet Konten auf, `cron:write` löst einen Job aus.
Ein Administrator besitzt alle davon, ebenso wie der Service-Schlüssel. Eine Person besitzt diejenigen,
die ihre Rollen deklarieren, und ein API-Schlüssel diejenigen, mit denen er erstellt wurde. Ein auf
eine Tabelle beschränkter Schlüssel hat auf nichts davon Zugriff. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Administrator existiert | In der Produktionsumgebung verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen, die über die des Aufrufers hinausgehen, werden abgelehnt |
| `POST` | `/api/admin/users/import` | `users:write` | [Importiert Konten](/docs/backend/auth-endpoints/#importing-accounts) unter Beibehaltung ihrer IDs: keine E-Mail, kein Passwort (außer dessen bcrypt-Hash wird mitgeliefert), vergebene IDs oder E-Mails werden übersprungen. Maximal 100 pro Anfrage. Rollen, die über die des Aufrufers hinausgehen, werden abgelehnt |
| `GET` | `/api/admin/users/pick` | `users:read` oder Schreibzugriff auf eine Tabelle mit einer `.userId()`-Spalte | Das [Auslesen für die Benutzerauswahl](/docs/backend/auth-endpoints/): nur ID, Name, E-Mail und Avatar. Eine Tabelle, deren Schreibregeln reines SQL sind, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das über mehr Berechtigungen als der Aufrufer verfügt |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das über mehr Berechtigungen als der Aufrufer verfügt |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Erstellt ein temporäres Passwort |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos, beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | Gäste, sortiert nach am längsten nicht mehr gesehen. `?lastSeenBefore=` grenzt sie auf das ein, was das Löschen darunter erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` gesehen wurden (Pflichtparameter). Antwortet mit `{ deleted, skipped, remaining }`. Wiederholen, solange `remaining` nicht 0 ist, wobei `?offset=` auf die Anzahl der übersprungenen Gäste gesetzt wird. Reguläre Konten sind nicht betroffen |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Löscht einen Gast. Ein reguläres Konto wird mit `NOT_ANONYMOUS` abgelehnt |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die vom Projekt deklarierten Rollen mit ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals ein API-Schlüssel |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartextschlüssel wird nur einmal bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Einen Job jetzt ausführen. `?async=1` antwortet mit `202`, sobald er gestartet wurde – [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup-Bestand |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streamt ein Backup. Mit `?token=` aus einem Download-Link ist kein Header erforderlich, ausschließlich für dieses Backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Ein Link zu einem Backup, `{ key }` → `{ url, token, expiresIn }`, gültig für 60 Sekunden – [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien ohne Zeilenreferenz, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es ein `storage.orphans`-Job in der Job-Queue ist, `in-process`, wenn der Server ihn selbst ausführt). Der Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Sobald `completed`: `result`, der Bericht, den das frühere `GET /orphans` lieferte. Ein Lauf, der seit 10 Minuten keine Meldungen mehr gesendet hat, wird als `failed` beantwortet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht verwaiste Dateien (Orphans) eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird erneut gegen jede Zeile und jeden Verlaufseintrag geprüft und unmittelbar vor dem Löschen nochmals abgefragt. Das Ergebnis ist `deletion` im Scan-Datensatz. `409` bei `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Tabelle nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, eine Seite pro Aufruf – was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` bei `deleteSource` zwischen zwei Quellen, die am selben Ort speichern |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einem Verschiebevorgang erneut auf, mit demselben Body, eine Seite pro Aufruf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede Datei, die sich mit `deleteSource` noch in der Quelle befindet, bzw. jede Datei, für die das Ziel ohne diese Option keine Kopie hat. `rebase storage move` fragt dies ab, wenn der Verschiebevorgang abgeschlossen ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der Puffer der letzten Logs |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regel-Rollen von Benutzern und aktive Service-Schlüssel, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Tabelle so, wie `{ role?, userId?, apiKeyId? }` darauf zugreift: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scope oder RLS, maskierte Felder. Nur mit Administratorsitzung |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streamt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV – die Funktion „Vollständiges Ergebnis als CSV herunterladen“ in [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Policies und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branches in dessen übergeordneten Branch, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine Seite seit dem Diff geändert hat oder Zeilen in Konflikt stehen |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet niemals eine an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur durch eine Person, außer `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plant die Lockerung von `NOT NULL` und das Löschen der in `drop` genannten, nicht deklarierten Spalten für [Schema Reconcile](/docs/cli/schema/#rebase-schema-reconcile); wendet niemals Änderungen an |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Wendet einen Reconcile-Plan an, aber nur, wenn dessen `digest` mit dem gesendeten `confirm` übereinstimmt |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Führt eine erneute PostgreSQL-Introspektion durch und lädt REST, Realtime, OpenAPI, Storage-Policies, Webhooks, Rollen und geplante Jobs direkt ohne Neustart neu |
| `GET` | `/api/admin/db/tables` | `database:read` | Listet PostgreSQL-Benutzertabellen mit Spalten, Indizes, RLS-Policies und `rebase.table_meta`-Overlays auf |
| `POST` | `/api/admin/db/tables` | `database:write` | Erstellt eine PostgreSQL-Tabelle mit optionalen anfänglichen RLS-Policies und Metadaten (`dryRun: true` liefert eine SQL-Vorschau) und lädt anschließend live neu |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Benennt eine Tabelle um, schaltet Row Level Security (`rlsEnabled`) um oder aktualisiert `rebase.table_meta`-API-Overlay-Einstellungen (`meta`) und lädt anschließend live neu |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Löscht eine PostgreSQL-Tabelle (erfordert `{ confirm: "<table>" }`, sofern nicht `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Fügt einer PostgreSQL-Tabelle eine Spalte hinzu und lädt live neu |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Ändert eine Spalte (Umbenennung, Typ, Nullability, Standardwert) und lädt live neu |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Löscht eine Spalte (erfordert `{ confirm: "<column>" }`, sofern nicht `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Erstellt einen Index auf einer PostgreSQL-Tabelle |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Löscht einen Index auf einer PostgreSQL-Tabelle |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Erstellt eine PostgreSQL-RLS-Policy auf einer Tabelle und lädt live neu |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Löscht eine PostgreSQL-RLS-Policy auf einer Tabelle und lädt live neu |
| `GET` | `/api/admin/storage/policies` | `database:read` | Listet deklarative Zero-Code-Storage-Policies aus `rebase.storage_policies` auf |
| `POST` | `/api/admin/storage/policies` | `database:write` | Erstellt eine deklarative Storage-Zugriffsrichtlinie |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Aktualisiert eine deklarative Storage-Zugriffsrichtlinie |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Löscht eine deklarative Storage-Zugriffsrichtlinie |
| `GET` | `/api/admin/webhooks` | `database:read` | Listet Zero-Code-Datenbank-Webhooks aus `rebase.webhooks` auf |
| `POST` | `/api/admin/webhooks` | `database:write` | Erstellt einen Datenbank-Webhook |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Aktualisiert einen Datenbank-Webhook |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Löscht einen Datenbank-Webhook |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Sendet eine Live-Testzustellung an einen konfigurierten Webhook-Endpunkt |
| `GET` | `/api/admin/roles` | `users:read` | Listet Zero-Code-RBAC-Rollen und -Scopes aus `rebase.roles` auf |
| `POST` | `/api/admin/roles` | `users:write` | Erstellt oder aktualisiert eine Zero-Code-RBAC-Rolle |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Aktualisiert eine Zero-Code-RBAC-Rolle |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Löscht eine Zero-Code-RBAC-Rolle |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Listet geplante Zero-Code-SQL/HTTP-Jobs aus `rebase.cron_jobs` auf |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Erstellt einen geplanten Zero-Code-SQL- oder -HTTP-Cron-Job. Ein SQL-Job führt seine Anweisung über die servereigene Verbindung aus, weshalb zusätzlich `database:write` erforderlich ist |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Aktualisiert einen geplanten Zero-Code-Cron-Job; ein SQL-Job (oder ein Job, der zu einem wird) erfordert zusätzlich `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Löscht einen geplanten Zero-Code-Cron-Job |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Jede von `backend/schema/index.ts` exportierte Tabelle so, wie der Editor sie liest, einschließlich der im Code bearbeiteten Elemente (schreibgeschützt) und warum – [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: die Dateien, die die Bearbeitung schreiben würde, kompiliert; schreibt nichts |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | Dieselbe Bearbeitung, geschrieben nach `backend/schema`; die Datenbank wird nicht verändert |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabellen, die die Datenbank besitzt und die `backend/schema` nicht deklariert: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Eine davon beschrieben: `{ table: { …, descriptor, rlsRaised?, notes } }`, für „Bestehende Tabelle importieren“. `404`, wenn unbekannt oder bereits deklariert, `400 SCHEMA_EDIT_REFUSED` ohne Primärschlüssel |
| `GET` | `/api/admin/ui-config` | session | Die UI-Einstellungen des Workspace pro Tabelle, die eigenen des Aufrufers und ob der Aufrufer die des Workspace schreiben darf – siehe [Tabelle anpassen](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Führt ein `UiTablePreferences`-Delta in die Workspace-Einstellungen einer Tabelle zusammen (`replace` ersetzt). Wird in `frontend/src/cms/ui-config.json` geschrieben, wenn der Server den Quellcode des Projekts beschreiben darf, andernfalls in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Entfernt die Workspace-Einstellungen einer Tabelle |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (eine Person) | Die eigenen Einstellungen des Aufrufers für eine Tabelle. Ein API-Schlüssel hat keine: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (eine Person) | Entfernt die eigenen Einstellungen des Aufrufers für eine Tabelle |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das Postfach mit den abgefangenen E-Mails |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden aus Versionen vor 0.17 ohne das `/admin`-Segment bereitgestellt. Diese Aliase sind
für Projekte gedacht, die noch nicht umgestellt wurden; schreiben Sie neuen Code gegen den kanonischen Pfad.

## Schema

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session oder Anmeldedaten mit `schema:read` oder einem `data:*`-Scope | Jede Tabelle, die dieses Backend bereitstellt, als JSON-Array von Deskriptoren, die für den Aufrufer gefiltert sind |
| `GET` | `/api/schema/tables/:slug` | wie oben | Ein Deskriptor. `404 TABLE_NOT_FOUND`, wenn diesem Aufrufer diese Tabelle nicht bereitgestellt wird |

Die Deskriptoren sind das, woraus das CMS seine Standardwerte rendert, woraus das
Studio den Schema-Visualisierer und den RLS-Editor erzeugt und woraus die MCP-Apps
Tabellen und Formulare rendern. Sie enthalten Spalten mit ihren Postgres-Typen,
Nullability, Validierungs- und Storage-Regeln, Relationen nach Slug und die
Row-Level-Security-Konfiguration. Hook-Code verlässt niemals den Server: Ein Deskriptor
gibt lediglich an, welche Hooks eine Tabelle besitzt.

Was einem Aufrufer ausgeliefert wird, hängt davon ab, wer er ist:

| Aufrufer | Tabellen | Gefiltert |
|---|---|---|
| Ein Administrator, Inhaber von `schema:read` oder der Service-Schlüssel | Jede Tabelle, inklusive einfacher Views | `.private()`-Spalten, für jeden |
| Jede andere angemeldete Person, einschließlich Gäste | Nur die Tabellen, die eine erlaubende Regel für ihre Rollen erreicht (plus die Auth-Tabelle und materialisierte Views, deren `roles` sie besitzen) | Spalten und Relationen, bei denen ihre Rollen `access.read` verfehlen; `.private()`-Spalten; nur die Regeln, die für ihre Rollen gelten können; Relationen zu Tabellen, die ihnen nicht bereitgestellt werden; Hook-Flags; reines SQL in Regeln, kompilierte Policies, View-Abfragen und Indizes |
| Anmeldedaten (API-Schlüssel, MCP- oder Plattform-Token) | Die Tabellen, die die `data:*`-Scopes benennen, oder alle mit `schema:read` | Wie oben, bewertet anhand der enthaltenen Scopes |
| Niemand angemeldet | Keine – `401` – es sei denn, das Backend setzt `schemaTables: { public: true }` | Dann die Tabellen mit einer öffentlichen `select`-Regel, gefiltert wie für den Aufrufer mit den geringsten Rechten: keine Spalte mit einer `access.read`-Liste, kein reines SQL, keine Policies |

Eine Person behält `metadata`, `softDelete`, `tenant`, `history` und `search` auf
den Tabellen, die ihr bereitgestellt werden. `schemaTables: { persons: "all" }` in den
Backend-Optionen beschreibt jedem angemeldeten Aufrufer jede Tabelle und Regel; der
Standardwert ist `"granted"`. MCP-Verbindungen werden vom selben
Serialisierer wie Anmeldedaten bewertet.

Wer der Aufrufer ist, bestimmt der Auth-Adapter des Backends – derselbe, den auch die Datenrouten
abfragen. Ein Backend mit einem [benutzerdefinierten Adapter](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
wird hier (sowie unter `/api/docs` und allen Admin-Oberflächen) mit den Rollen bedient, die sein
Adapter zurückgibt; nicht erkannte Anmeldedaten führen zu `401`.

Anmeldedaten, die weder `schema:read` noch einen `data:*`-Scope besitzen, erhalten
`403 SCOPE_MISSING`. Ein Backend ohne konfigurierte Authentifizierung beantwortet
jede Anfrage mit `404 SCHEMA_UNAVAILABLE`: Es gibt keinen Aufrufer, für den gefiltert werden könnte, und
`auth.requireAuth: false` ändert daran nichts.

Antworten enthalten `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` und den Header `x-rebase-schema`; eine Anfrage, deren `If-None-Match`
das aktuelle Tag nennt, erhält `304`. Das Tag ändert sich, wenn sich das Schema ändert,
auch nach einer Live-Schema-Bearbeitung.

`schemaTables` ist eine Option von `initializeRebaseBackend` ohne Umgebungsvariable:
Ein über Scaffolding erstelltes Projekt erreicht sie durch Ejecting.

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
| `GET` | `/api/storage/sources` | session | Die benannten Storage-Quellen, die dieses Backend bereitstellt |
| `OPTIONS` | `/api/storage/tus` | none | Fortsetzbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Fortsetzbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Storage liefert für dieses Präfix ein `501` zurück, das die
benötigte Variable benennt, anstatt mit 404 zu antworten, als ob das Feature nicht existierte –
mit Ausnahme von `GET /api/storage/sources`, das mit `200` und einer leeren Liste antwortet.

## Push

Wird nur mit `push: true` (`REBASE_PUSH=true`) bereitgestellt. Wenn Push aktiviert ist, aber keine Schlüssel vorhanden sind,
antwortet jede Route mit `503 PUSH_NOT_CONFIGURED`. API-Schlüssel und der Service-Schlüssel werden
abgelehnt: Ein Abonnement gehört zum Browser einer Person.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/push/key` | session | Der öffentliche VAPID-Schlüssel – [Push-Benachrichtigungen](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Dieser Browser empfängt Benachrichtigungen für den Aufrufer – [Push-Benachrichtigungen](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Benachrichtigungen im Browser des Aufrufers stoppen – [Push-Benachrichtigungen](/docs/backend/push-notifications/#routes) |

## Functions

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| any | `/api/functions/<name>` | Was auch immer die Funktion deklariert. Ein API-Schlüssel benötigt zusätzlich `functions:invoke` | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, die Pfade stammen also aus Ihrem
Projekt. `GET /api/functions` listet sie nur für einen angemeldeten Aufrufer auf – eine
Session, ein API-Schlüssel oder der Service-Schlüssel – und antwortet allen anderen mit `401`: Eine
Bestandsaufnahme der benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## RPC

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | Der `access`-Wert des RPCs: none für `"public"` (ratenbegrenzt), session für `"authenticated"`; danach RLS innerhalb der Funktion. Ein API-Schlüssel benötigt zusätzlich `data:read` (`data:write` für einen `write: true`-RPC) | [SQL-Funktionen als RPC](/docs/backend/rpc/) |

Eine Route pro `defineRpc`, das aus `backend/schema/index.ts` exportiert wird; die
Pfade stammen also aus Ihrem Projekt. Ein Name, den niemand deklariert hat, antwortet mit `404
RPC_NOT_FOUND`, selbst wenn die Datenbank eine Funktion dieses Namens besitzt.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Nur Liveness: Läuft dieser Prozess. Greift nicht auf die Datenbank zu, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | Standardmäßig die Zielgruppe des Schema-Endpunkts (401 für Anonyme, außer bei `schemaTables.public`, 403 für Anmeldedaten ohne Schema- oder Data-Scope); none, wenn `enableSwagger` auf `true` steht; das Admin-Gate, wenn `false` | Das OpenAPI 3.0-Dokument der Tabellen, die `GET /api/schema/tables` dem Aufrufer beschreibt (alle bei `enableSwagger: true`). `404 DOCS_UNAVAILABLE`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/api/swagger` | none | Swagger UI. Nur wenn `enableSwagger` auf `true` steht, und niemals in der Produktionsumgebung |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version, sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` – jede Tabelle, wie ein Administrator sie sieht, die Eingabe für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, falls gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN`, falls gesetzt | Bis zu 16 aufgezeichnete Zeitreihen gleichzeitig, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, in Buckets unterteilt. Beinhaltet Anfragen pro Minute und Fehler pro Schnittstelle. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server anstatt über
einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur bereitgestellt, wenn `REBASE_MCP_ENABLED=true` ist, was auch
`REBASE_PUBLIC_URL` erfordert – siehe
[Konfiguration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig
deaktiviert: Keine `REBASE_ROLE` aktiviert dies, da dadurch Drittanbieter-Software Projektzugriff
gewährt wird und dies eine Entscheidung ist, die eine Person treffen sollte.

Die `.well-known`-Dokumente befinden sich am **Origin**, nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC-9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Werden auch in der Form mit Pfadsuffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC-8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer** (oder als derjenige, für den der Schlüssel agiert), sodass jeder Lese- und Schreibvorgang demselben RLS unterliegt. Die `data:*`-Scopes entscheiden darüber, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst geprüft, sodass bei einem fehlenden oder abgelaufenen Token stattdessen die `401`-Aufforderung zurückgegeben wird |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt hält keine Sitzung, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | ratenbegrenzt | Dynamische Client-Registrierung nach RFC 7591. Abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` ist |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm, zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort der Person darauf – zustimmen oder ablehnen |
| `POST` | `/api/oauth/token` | Client-Credentials + PKCE | Tauscht einen Autorisierungscode aus oder erneuert ihn |
| `POST` | `/api/oauth/revoke` | Client-Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer genehmigt hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Genehmigung zurück, sodass eine Person eine Zustimmung ohne Admin rückgängig machen kann |

Der eigene MCP-Endpunkt des Admin-Panels ist nicht Teil dieser Schnittstelle: Er erfordert die
Session des Admin-Panels, niemals ein OAuth-Token, und wird unabhängig davon bereitgestellt,
ob `REBASE_MCP_ENABLED` gesetzt ist, auf einem Treiber, der jeden Aufruf auf RLS beschränkt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, niemals anonym | **Experimentell.** Dieselben Tools wie `/mcp`, für die angemeldete Person, mit `data:read`, `data:write` und `data:delete`, unter deren RLS. Die `savedAppsView` des Admin-Panels öffnet [gespeicherte Apps](/docs/ai/remote-mcp/) darüber |

## Verwandte Themen

- [REST-API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Anfrage- und Antwortstrukturen für die obige Auth-Tabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die Variablen, die bestimmen, welche dieser Endpunkte bereitgestellt werden
