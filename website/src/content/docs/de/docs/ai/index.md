---
title: KI & Agenten
sidebar_label: Übersicht
description: Was Rebase für KI-Coding-Assistenten und autonome Agenten bereitstellt – ein MCP-Server, projektlokale Agent Skills, vorbereitete Anweisungsdateien und das Berechtigungsmodell, das bestimmt, worauf ein Agent tatsächlich zugreifen kann.
---

Rebase liefert vier verschiedene Komponenten für KI-Assistenten, die unterschiedliche
Probleme lösen. Es lohnt sich zu wissen, nach welcher davon Sie greifen:

| | Was es ist | Wer es nutzt |
|---|---|---|
| [**MCP server**](/docs/ai/mcp) | Ein stdio-basierter Model Context Protocol-Server mit 40 Tools für Ihr Schema, Daten, Benutzer, Speicher, Cron und Dev-Server | Ein Assistent zur Laufzeit |
| [**Agent skills**](/docs/ai/skills) | 20 Markdown-Skill-Dateien, die durch `rebase skills install` in Ihr Repository geschrieben werden | Ein Assistent als Referenzmaterial |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` plus assistentenspezifische Pointer-Dateien, erstellt durch `rebase init` | Ein Assistent als dauerhaft aktive Regeln |
| [**API keys**](/docs/backend/api#api-keys) | Bereichsbezogene Maschinen-Zugangsdaten, pro Collection und pro Operation | Alles, was die HTTP-API aufruft |

Die ersten drei dienen dazu, einem Assistenten *Wissen* und *Werkzeuge* bereitzustellen. Die
vierte ist die einzige, die bestimmt, was er tatsächlich tun darf.

## Der entscheidende Teil: Was ein Agent anfassen darf

Ein Agent mit Werkzeugen für Ihre Datenbank ist ein gewöhnlicher API-Aufrufer, der
zufällig seine nächste Anfrage selbst bestimmt. Rebase versucht nicht, ihn durch
Anweisungen einzuschränken – ein Prompt ist kein Mechanismus zur Zugriffskontrolle,
und ein Agent, der Ihre Zeilen liest, liest Text, den jemand anderes geschrieben haben könnte.
Die Einschränkung muss unterhalb des Agenten greifen, in den Zugangsdaten, die er mitführt.

Rebase gibt diesen Zugangsdaten zwei unabhängige Kontrollstufen:

1. **Die API-Schlüssel-Berechtigungsliste.** Deklariert pro Collection *und* pro Operation,
   wobei `delete` von `write` getrennt werden kann – was meistens das ist, was Sie
   einem Agenten vorenthalten möchten, der ansonsten bearbeiten darf.
2. **Row-Level Security.** API-Schlüssel umgehen RLS nicht. Ein Schlüssel verbindet sich
   wie jeder andere Aufrufer über die Postgres-Rolle `rebase_user`, sodass Ihre Richtlinien
   weiterhin bestimmen, welche Zeilen zurückgegeben werden.

Beide müssen eine Anfrage erlauben. Keine ersetzt die andere, und die zweite
ist der Grund dafür, dass ein Schlüssel mit `"*"`-Berechtigungen dennoch eine leere Ergebnismenge
zurückgeben kann.

Ein Punkt, der oft übersehen wird: `access: "public"` einer Collection erweitert **welche
Zeilen ein Aufrufer sehen darf**, nicht **wer aufrufen darf**. Es ist eine Aussage über die
Sichtbarkeit von Zeilen, nicht über die Authentifizierung. Das Gewähren fügt einen Aufrufer
nicht zur Berechtigungsliste hinzu, und das Verweigern stoppt ihn nicht.

Die Mechanismen – Erstellen von Schlüsseln, das Berechtigungs-JSON, Rotation, Ablauf,
Ratenbegrenzungen – werden in [REST API → API Keys](/docs/backend/api#api-keys) behandelt.
Überspringen Sie dabei nicht [Security Rules (RLS)](/docs/collections/security-rules);
die zweite Kontrollstufe ist nur so gut wie die Richtlinien, die Sie geschrieben haben.

:::caution[Der MCP-Server verwendet standardmäßig keinen bereichsbezogenen Schlüssel]
Das obige Zwei-Stufen-Modell beschreibt die Funktionsweise eines API-Schlüssels. Dies ist **nicht**
das, was `@rebasepro/mcp` verwendet, es sei denn, Sie konfigurieren es entsprechend. Ohne Konfiguration
authentifiziert sich der MCP-Server mit dem **Service Key** Ihres Dev-Servers – einem uneingeschränkten
Admin-Zugangsdaten-Token, das die Standard-Admin-Richtlinien auf jeder Collection erfüllt. Siehe
[What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach),
bevor Sie einen Assistenten auf wichtige Ressourcen ansetzen.
:::

## Vektorsuche

Rebase bietet einen erstklassigen `vector`-Eigenschaftstyp auf Postgres und eine
`.vectorSearch()`-Abfragemethode mit `cosine`-, `l2`- und `inner_product`-Distanz.
Dies ist bereits an zwei Stellen dokumentiert:

- [Querying Data → Vector Search](/docs/sdk/querying#vector-search) — die SDK-Methode,
  das `_distance`-Feld, das jeder Zeile hinzugefügt wird, und die Besonderheiten
- [REST API → Vector Search](/docs/backend/api#vector-search) — die Abfrageparameter
  `vector_search`, `vector`, `vector_distance` und `vector_threshold`

Drei Dinge, die Sie wissen sollten, bevor Sie darauf aufbauend entwickeln: **Rebase speichert und durchsucht
Embeddings; es berechnet sie nicht** – es gibt in Rebase keinen Embedding-Provider,
keine Modell-Einstellung und keinen API-Schlüssel, die Generierung der Vektoren liegt also bei Ihnen.
**pgvector ist eine Voraussetzung.** Das Datenbank-Image des Scaffolds bringt
die Erweiterung mit, ein per `rebase init` erstelltes Projekt braucht hier also
nichts. Zeigt Rebase auf eine Datenbank, die jemand anderes bereitgestellt hat,
benötigen Sie ein Image mit der Erweiterung und eine Rolle, die einmalig
`CREATE EXTENSION vector;` ausführen darf – Rebase installiert keine
Erweiterungen für Sie. Und **jede Vektorspalte erhält einen HNSW-Index für die
Kosinus-Distanz**, denn mit Kosinus misst `vectorSearch`, sofern Sie nicht
`distance` übergeben – ein Index bedient genau einen Operator. Anpassen oder
abschalten lässt er sich an der Property: siehe
[Der Index](/docs/sdk/querying#the-index).

Vektor-Abfragen können zudem nicht abonniert werden; `.vectorSearch(...).listen()` wird
mit `VECTOR_SEARCH_NOT_LIVE` abgelehnt.

Für die lexikalische Suche – gerankte Volltextsuche über die von Ihnen benannten Felder,
einschließlich JSONB- und Array-Inhalten – siehe [Search](/docs/backend/search). Es ist ein
anderer Mechanismus, und die beiden interagieren nicht miteinander.

## Nächste Schritte

- [MCP Server](/docs/ai/mcp) — verbinden Sie Claude Code, Cursor oder beliebige MCP-Clients
- [Agent Skills](/docs/ai/skills) — `rebase skills install` und die 20 Skills
- [AI Instruction Files](/docs/ai/instruction-files) — das Muster für vorbereitete Regeldateien

---
