---
sourceHash: c7cd1dd8eea181bf
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Authentifizierung, Speicher, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede Route, die der Server bereitstellt, in einer Tabelle zusammengefasst, samt den Voraussetzungen für den Zugriff.

Die Pfade gehen vom Standard-`basePath` `/api` aus; `REBASE_BASE_PATH` verschiebt alle
gemeinsam. `/health`, `/livez` und `/metrics` befinden sich absichtlich außerhalb davon,
da ein Orchestrator `/health` abfragt und den Basispfad nicht kennen muss.
`/health` ist *zusätzlich* darunter eingebunden, sodass `/api/health` auf dieselbe Weise
antwortet, anstatt einen 404-Fehler auszugeben, gerade wenn jemand überprüft, ob der Server
erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – gleicht diese
Tabelle mit den im Quellcode registrierten Routen ab, sodass keine neue Schnittstelle
hinzugefügt werden kann, ohne hier aufgeführt zu werden.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann den Endpunkt aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein API-Schlüssel mit Gültigkeit für die Operation |
| **admin** | Eine Admin-Sitzung, ein Service-Schlüssel oder ein API-Schlüssel mit Admin-Berechtigung |
| **RLS** | Authentifiziert; die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung bereitgestellt |

## Daten

Wird pro Collection generiert, daher enthalten die Pfade Ihre Slugs anstelle einer festen
Liste. `:slug` ist der `slug` einer Collection.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias von `PATCH` – gleicher partieller Schreibzugriff, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional mit Upsert – [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen anhand der ID aktualisieren – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen anhand der ID löschen – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Collection-übergreifend in einer Transaktion schreiben – [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Zählen und Aggregation sind eigene Routen, die vor `/:id` registriert sind,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind
deren Parameter, und `select` ist bei `/aggregate` erforderlich.

Textsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl *sind* Query-Parameter
auf `GET /api/data/:slug` und keine Routen – `search`,
`vector_search`, `include`, `fields`. Siehe [REST API](/docs/backend/api/).

Ein Projekt, das keine Collections deklariert und keine introspeziert, liefert für dieses Präfix
ein einzelnes `404 NO_COLLECTIONS` aus. Siehe [Backend only](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
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
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/anonymous` | none | Gast-Sitzungen. Deaktiviert, außer `ALLOW_ANONYMOUS` ist gesetzt |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer `AUTH_ALLOW_USER_LOOKUP` ist gesetzt – dient als Enumeration-Oberfläche |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (eine laufende Anmeldung) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signierung](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert eine Admin-Sitzung, einen Service-Schlüssel oder einen
API-Schlüssel mit Admin-Berechtigung. Kein einzelnes Sonderrecht: Ein auf eine Collection beschränkter
Schlüssel hat hierauf keinen Zugriff.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Admin existiert | In Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users` | admin | Benutzerverwaltung |
| `GET` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `DELETE` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Erstellt ein temporäres Passwort |
| `GET` | `/api/admin/roles` | admin | Die im Projekt deklarierten Rollen |
| `GET` | `/api/admin/api-keys` | admin | [API keys](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | Der Klartext-Schlüssel wird nur einmalig bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Job sofort ausführen |
| `GET` | `/api/admin/backups` | admin | Backup-Übersicht |
| `GET` | `/api/admin/backups/download` | admin | Streamt ein Backup |
| `GET` | `/api/admin/logs` | admin | Der aktuelle Log-Puffer |
| `GET` | `/api/admin/logs/latest` | admin | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | admin | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | admin | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/schema/status` | admin | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Plant eine Änderung; wendet sie niemals an |
| `POST` | `/api/admin/schema/apply` | admin | Deaktiviert, außer `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `GET` | `/api/admin/schema-editor/status` | admin | Ob der Editor verfügbar ist und der Grund, falls nicht |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) – schreibt den Collection-Quellcode neu |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-Mails, die der Development-Transport erfasst hat, anstatt sie zu senden |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden aus Versionen vor 0.17 ohne das Segment `/admin` bereitgestellt. Diese
Aliase dienen Projekten, die noch nicht umgestellt wurden; schreiben Sie neuen Code stets gegen den kanonischen Pfad.

## Storage

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Storage-Quellen, die dieses Backend bereitstellt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Fortsetzbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Besitzer des Uploads | Fortsetzbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Besitzer des Uploads | Fortsetzbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Besitzer des Uploads | Fortsetzbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher beantwortet dieses Präfix mit einem `501`-Fehler,
der die benötigte Variable benennt, anstatt einen 404-Fehler zu liefern, als ob das Feature gar nicht existieren würde.

## Functions

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| alle | `/api/functions/<name>` | was die Funktion deklariert | [Custom Functions](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, die Pfade stammen also aus Ihrem
Projekt. `GET /api/functions` listet diese **nicht** auf: Eine Übersicht der
benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Nur Liveness: Läuft dieser Prozess. Greift nicht auf die Datenbank zu, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Berichtet über jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | none (admin in Produktion) | Das OpenAPI 3.0-Dokument |
| `GET` | `/api/swagger` | none | Swagger UI. Nur in der Entwicklung, außer `REBASE_ENABLE_SWAGGER` ist gesetzt |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und sonst nichts |
| `GET` | `/api/meta/contract` | admin | Der vollständige Collection-Vertrag für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur bereitgestellt, wenn `REBASE_MCP_ENABLED=true`, was auch
`REBASE_PUBLIC_URL` voraussetzt – siehe
[Configuration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig deaktiviert:
Keine `REBASE_ROLE` aktiviert dies, da es Drittanbieter-Software Zugriff auf das Projekt gewährt
und dies eine bewusste Entscheidung einer Person sein sollte.

Die `.well-known`-Dokumente liegen am **Origin**, nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC 9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfadsuffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC 8414-Metadaten: Die Endpunkte, Grant Types und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer | Der MCP-Protokollendpunkt. Agiert **als der angemeldete Benutzer**, sodass jeder Lese- und Schreibzugriff demselben RLS unterliegt |
| `GET` | `/mcp` | OAuth-Bearer | Der Server-Sent-Events-Stream für eine Sitzung |
| `DELETE` | `/mcp` | OAuth-Bearer | Beendet eine Sitzung |
| `POST` | `/api/oauth/register` | rate-limited | RFC 7591 Dynamic Client Registration. Verweigert, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm, zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort der Person darauf – genehmigen oder ablehnen |
| `POST` | `/api/oauth/token` | Client-Credentials + PKCE | Tauscht einen Autorisierungscode ein oder aktualisiert ihn |
| `POST` | `/api/oauth/revoke` | Client-Credentials | RFC 7009 Token-Widerruf |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Autorisierung zurück, sodass eine Person eine Zustimmung ohne Admin rückgängig machen kann |

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth endpoints](/docs/backend/auth-endpoints/) – Request- und Response-Formate für die obige Auth-Tabelle
- [Environment & Configuration](/docs/getting-started/configuration/) – die Umgebungsvariablen, die bestimmen, welche dieser Endpunkte bereitgestellt werden

---
