---
sourceHash: f0b5790a3df6501a
title: KI & Agenten
sidebar_label: Übersicht
description: Was Rebase für KI-Coding-Assistenten und autonome Agenten bereitstellt – ein MCP-Server, projektlokale Agent-Skills, vorgefertigte Anweisungsdateien und das Berechtigungsmodell, das bestimmt, worauf ein Agent tatsächlich zugreifen kann.
---

Rebase liefert vier separate Komponenten für KI-Assistenten, die jeweils unterschiedliche
Probleme lösen. Es lohnt sich zu wissen, nach welcher Sie greifen:

| | Was es ist | Wer es konsumiert |
|---|---|---|
| [**MCP-Server**](/docs/ai/mcp) | Ein stdio Model Context Protocol-Server mit 53 Tools für Ihr Schema, Ihre Daten, Benutzer, Speicher, Cron, Dev-Server und Ihr Rebase Cloud-Projekt | Ein Assistent, zur Laufzeit |
| [**Agent-Skills**](/docs/ai/skills) | 23 Markdown-Skill-Dateien, die durch `rebase skills install` in Ihr Repository geschrieben werden | Ein Assistent, als Referenzmaterial |
| [**Anweisungsdateien**](/docs/ai/instruction-files) | `ai-instructions.md` plus assistentenspezifische Pointer-Dateien, geschrieben von `rebase init` | Ein Assistent, als permanente Regeln |
| [**API-Schlüssel**](/docs/backend/api-keys) | Maschinen-Credentials mit [Scopes](/docs/backend/roles-and-scopes), pro Collection und pro Operation | Alles, was die HTTP-API aufruft |

Bei den ersten drei geht es darum, einem Assistenten *Wissen* und *Tools* an die Hand zu geben.
Die vierte ist die einzige Komponente, die darüber entscheidet, was er tatsächlich tun darf.

## Der entscheidende Teil: Worauf ein Agent zugreifen darf

Ein Agent mit Tools für Ihre Datenbank ist ein gewöhnlicher API-Aufrufer, der zufällig
seine nächste Anfrage selbst bestimmt. Rebase versucht nicht, ihn durch
Anweisungen einzuschränken – ein Prompt ist kein Zugriffskontrollmechanismus, und ein Agent,
der Ihre Zeilen liest, liest Text, den möglicherweise jemand anderes geschrieben hat. Die
Einschränkung muss unterhalb des Agenten ansetzen, im Credential, das er verwendet.

Rebase stattet dieses Credential mit zwei unabhängigen Schutzmechanismen (Gates) aus:

1. **Die Scopes des Schlüssels.** Deklariert pro Operation *und*, falls gewünscht, pro
   Collection: `data:read:articles`, `data:write:articles`. `data:delete` ist
   von `data:write` getrennt – meist die Berechtigung, die man einem Agenten vorenthalten
   möchte, der ansonsten bearbeiten darf.
2. **Row-Level Security.** API-Schlüssel umgehen RLS nicht. Ein Schlüssel verbindet sich wie
   jeder andere Aufrufer über die Postgres-Rolle `rebase_user`, sodass Ihre Policies weiterhin
   darüber entscheiden, welche Zeilen zurückgegeben werden.

Beide müssen eine Anfrage erlauben. Keiner ersetzt den anderen, und die zweite
Kontrollstufe ist der Grund, warum ein Schlüssel mit `data:read` für jede Collection dennoch
ein leeres Ergebnis zurückliefern kann.

Ein Punkt, der oft übersehen wird: Das `access: "public"` einer Collection erweitert, **welche
Zeilen ein Aufrufer sehen darf**, nicht **wer aufrufen darf**. Es ist eine Aussage über die
Sichtbarkeit von Zeilen, nicht über Authentifizierung. Die Vergabe gewährt einem Schlüssel keinen Scope,
und das Vorenthalten stoppt ihn nicht.

Die Mechanismen – Erstellen von Schlüsseln, Auswählen von Scopes, Rotation, Ablauf,
Rate Limits – werden unter [API-Schlüssel](/docs/backend/api-keys) behandelt.
Überspringen Sie dabei keinesfalls [Sicherheitsregeln (RLS)](/docs/collections/security-rules);
die zweite Kontrollstufe ist nur so gut wie die Policies, die Sie definiert haben.

:::caution[Der MCP-Server verwendet standardmäßig keinen berechtigungsbeschränkten Schlüssel]
Das obige Zwei-Stufen-Modell beschreibt, was ein API-Schlüssel tut. Es ist **nicht** das, was
`@rebasepro/mcp` verwendet, es sei denn, Sie konfigurieren es entsprechend. Ohne Anpassung
authentifiziert sich der MCP-Server mit dem **Service-Key** Ihres Dev-Servers – einem uneingeschränkten
Admin-Credential, das die standardmäßigen Admin-Policies für jede Collection erfüllt. Lesen Sie
[Worauf der MCP-Server zugreifen kann](/docs/ai/mcp#what-the-server-can-reach),
bevor Sie einen Assistenten auf produktive oder wichtige Daten ansetzen.
:::

## Vektorsuche

Rebase bietet einen erstklassigen `vector`-Property-Typen auf Postgres und eine
`.vectorSearch()`-Abfragemethode mit den Distanzmetriken `cosine`, `l2` und `inner_product`.
Dies ist bereits dokumentiert, an zwei Stellen:

- [Daten abfragen → Vektorsuche](/docs/sdk/aggregates-and-search#vector-search) – die SDK-Methode,
  das `_distance`-Feld, das sie jeder Zeile hinzufügt, und wichtige Hinweise
- [REST-API → Vektorsuche](/docs/backend/api#vector-search) – die
  Abfrageparameter `vector_search`, `vector`, `vector_distance` und `vector_threshold`

Drei Dinge, die Sie vor dem Design wissen sollten: **Rebase speichert und durchsucht
Embeddings; es berechnet sie nicht** – es gibt keinen Embedding-Provider, keine
Modell-Einstellung und keinen API-Schlüssel in Rebase; das Erzeugen der Vektoren liegt also bei Ihnen.
**pgvector ist eine Voraussetzung, und die Installation ist opt-in.**
`database({ extensions: ["vector"] })` in `config/resources.ts` sorgt dafür, dass `rebase db
push` und das Boot-Schema-Ensure `CREATE EXTENSION IF NOT EXISTS vector` für
Sie ausführen; ohne dies erstellen sie die Spalte und überlassen die Extension Ihnen. In
beiden Fällen benötigt der Server ein Image, das die Bibliothek enthält, sowie eine Rolle, die berechtigt ist,
sie zu installieren. Und **jede Vektorspalte erhält einen HNSW-Index für
Kosinusdistanz**, da Kosinus die Metrik ist, mit der `vectorSearch` standardmäßig misst, sofern
kein anderes `distance` übergeben wird – ein Index bedient genau einen Operator. Sie können ihn anpassen
oder deaktivieren: siehe [Der Index](/docs/sdk/aggregates-and-search#the-index).

Vektorabfragen können zudem nicht abonniert werden; `.vectorSearch(...).listen()`
wird mit `VECTOR_SEARCH_NOT_LIVE` abgelehnt.

Für die lexikalische Suche – gerankte Volltextsuche über die von Ihnen angegebenen Felder, einschließlich
JSONB- und Array-Inhalten – siehe [Suche](/docs/backend/search). Dies ist ein anderer
Mechanismus, und beide interagieren nicht miteinander.

## Nächste Schritte

- [MCP-Server](/docs/ai/mcp) – Verbinden Sie Claude Code, Cursor oder einen beliebigen MCP-Client
- [Agent-Skills](/docs/ai/skills) – `rebase skills install` und die 23 Skills
- [KI-Anweisungsdateien](/docs/ai/instruction-files) – das Muster für vorgefertigte Regeln (Scaffolded Rules)
