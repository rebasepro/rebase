---
sourceHash: 4040537e5cc9b4d3
title: KI & Agenten
sidebar_label: Übersicht
description: Was Rebase für KI-Coding-Assistenten und autonome Agenten bereitstellt – ein MCP-Server, projektlokale Agent Skills, vorgefertigte Anweisungsdateien und das Berechtigungsmodell, das bestimmt, worauf ein Agent tatsächlich zugreifen kann.
---

**Um Claude mit deinen Rebase-Projekten zu verwenden, füge den [Rebase connector](/docs/ai/rebase-connector/) hinzu.**
Öffne in Claude **Settings → Connectors → Add custom connector**, gib
`https://app.rebase.pro/mcp` ein und melde dich mit deinem Rebase-Konto an. Deine Rebase
Cloud-Projekte sind sofort verfügbar; füge jeden selbst gehosteten Server einmalig mit
`rebase cloud connect https://your-app.com` hinzu. Ein einziger Connector erreicht sie alle.

Darüber hinaus liefert Rebase fünf separate Komponenten für KI-Assistenten, die
unterschiedliche Probleme lösen. Es lohnt sich zu wissen, nach welcher du gerade greifst:

| | Was es ist | Wer es nutzt |
|---|---|---|
| [**Rebase connector**](/docs/ai/rebase-connector) | Ein gehosteter MCP-Connector unter `app.rebase.pro/mcp` für jedes deiner Projekte, in der Rebase Cloud oder selbst gehostet: Daten, Schema, Cron und bei Cloud-Deployments Umgebungsvariablen und Logs | Claude im Web, auf dem Desktop und mobil, in deinem Namen |
| [**MCP server**](/docs/ai/mcp) | Ein stdio-Model-Context-Protocol-Server mit 53 Tools für dein Schema, Daten, Benutzer, Storage, Cron, Dev-Server und Rebase Cloud-Projekt | Ein Assistent, zur Laufzeit |
| [**Agent skills**](/docs/ai/skills) | 24 Markdown-Skill-Dateien, die durch `rebase skills install` in dein Repository geschrieben werden | Ein Assistent, als Referenzmaterial |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` plus assistentenspezifische Pointer-Dateien, geschrieben von `rebase init` | Ein Assistent, als permanente Regeln |
| [**API keys**](/docs/backend/api-keys) | Maschinelle Zugangsdaten mit [Scopes](/docs/backend/roles-and-scopes), pro Tabelle und pro Operation | Alles, was die HTTP-API aufruft |

Bei den ersten vier geht es darum, einem Assistenten *Wissen* und *Tools* an die Hand zu geben.
Der fünfte Punkt ist der einzige, der entscheidet, was er tatsächlich tun darf.

## Der entscheidende Punkt: Worauf ein Agent zugreifen darf

Ein Agent mit Tools für deine Datenbank ist ein gewöhnlicher API-Aufrufer, der zufällig
seine nächste Anfrage selbst bestimmt. Rebase versucht nicht, ihn durch Anweisungen
einzuschränken – ein Prompt ist kein Zugriffskontrollmechanismus, und ein Agent, der
deine Zeilen liest, liest Text, den jemand anderes geschrieben haben könnte. Die
Beschränkung muss unterhalb des Agenten greifen, in den Zugangsdaten, die er mitführt.

Rebase versieht diese Zugangsdaten mit zwei unabhängigen Schranken:

1. **Die Scopes des Schlüssels.** Deklariert pro Operation *und*, falls gewünscht, pro
   Tabelle: `data:read:articles`, `data:write:articles`. `data:delete` ist
   getrennt von `data:write` – und meist die Berechtigung, die man einem Agenten
   vorenthalten möchte, der ansonsten Einträge bearbeiten darf.
2. **Row-Level Security (RLS).** API-Schlüssel umgehen RLS nicht. Ein Schlüssel verbindet sich
   wie jeder andere Aufrufer über die Postgres-Rolle `rebase_user`, sodass deine
   Richtlinien weiterhin bestimmen, welche Zeilen zurückgegeben werden.

Beide müssen eine Anfrage erlauben. Keines von beiden ersetzt das andere, und die zweite
Schranke ist der Grund, warum ein Schlüssel mit `data:read` für jede Tabelle dennoch ein
leeres Ergebnis zurückliefern kann.

Ein Punkt, der oft übersehen wird: Das `access: "public"` einer Tabelle erweitert, **welche
Zeilen ein Aufrufer sehen darf**, nicht **wer aufrufen darf**. Es ist eine Aussage über die
Sichtbarkeit von Zeilen, nicht über die Authentifizierung. Die Vergabe gewährt einem
Schlüssel keinen Scope, und das Vorenthalten stoppt ihn nicht.

Die Funktionsweise – das Erstellen von Schlüsseln, die Auswahl von Scopes, Rotation,
Ablaufzeiten, Rate-Limits – wird unter [API keys](/docs/backend/api-keys) behandelt.
Überspringe dabei nicht [Security Rules (RLS)](/docs/collections/security-rules);
die zweite Schranke ist nur so gut wie die von dir geschriebenen Richtlinien.

:::caution[Der MCP-Server verwendet standardmäßig keinen berechtigungsbeschränkten Schlüssel]
Das oben beschriebene Zwei-Schranken-Modell beschreibt die Funktionsweise eines API-Schlüssels.
Es ist **nicht** das, was `@rebasepro/mcp` standardmäßig verwendet, es sei denn, du
konfigurierst es entsprechend. Ohne Konfiguration authentifiziert sich der MCP-Server mit
dem **Service Key** deines Dev-Servers – einer uneingeschränkten Admin-Zugangsberechtigung,
die die Standard-Admin-Policies für jede Tabelle erfüllt. Siehe
[What the MCP server can reach](/docs/ai/mcp#what-the-server-can-reach),
bevor du einen Assistenten auf wichtige Daten ansetzt.
:::

## Vektorsuche

Rebase bietet einen nativen `vector`-Eigenschaftstyp auf Postgres und eine
`.vectorSearch()`-Abfragemethode mit den Distanzmetriken `cosine`, `l2` und `inner_product`.
Dies ist bereits dokumentiert, und zwar an zwei Stellen:

- [Querying Data → Vector Search](/docs/sdk/aggregates-and-search#vector-search) – die SDK-Methode,
  das `_distance`-Feld, das jeder Zeile hinzugefügt wird, und die Besonderheiten
- [REST API → Vector Search](/docs/backend/api#vector-search) – die
  Abfrageparameter `vector_search`, `vector`, `vector_distance` und `vector_threshold`

Drei Dinge, die man vor dem Entwurf wissen sollte. **Rebase speichert und durchsucht
Embeddings; es berechnet sie nicht** – es gibt in Rebase weder einen Embedding-Provider
noch Modelleinstellungen oder API-Schlüssel, daher ist die Erstellung der Vektoren deine
Aufgabe. **pgvector ist eine Voraussetzung und die Installation ist optional (Opt-in).**
Durch `database({ extensions: ["vector"] })` in `backend/resources.ts` führen `rebase db
push` und die Schema-Prüfung beim Start `CREATE EXTENSION IF NOT EXISTS vector` für
dich aus; andernfalls erstellen sie die Spalte und überlassen die Extension dir. In jedem
Fall benötigt der Server ein Image, das die Bibliothek enthält, sowie eine Rolle mit den
Rechten, sie zu installieren. Und **jede Vektorspalte erhält einen HNSW-Index für die
Cosine-Distanz**, da Cosine das ist, womit `vectorSearch` standardmäßig misst, sofern du nicht
`distance` übergibst – ein Index bedient genau einen Operator. Du kannst ihn anpassen oder
deaktivieren: siehe [The index](/docs/sdk/aggregates-and-search#the-index).

Vektorabfragen können zudem nicht abonniert werden; `.vectorSearch(...).listen()` wird
mit `VECTOR_SEARCH_NOT_LIVE` abgelehnt.

Für die lexikalische Suche – gerankte Volltextsuche über die von dir angegebenen Felder,
einschließlich JSONB- und Array-Inhalten – siehe [Search](/docs/backend/search). Es ist
ein anderer Mechanismus und die beiden interagieren nicht miteinander.

## Nächste Schritte

- [Rebase connector](/docs/ai/rebase-connector) — Claude, verbunden mit jedem deiner Projekte
- [MCP Server](/docs/ai/mcp) — Claude Code, Cursor oder beliebige MCP-Clients verbinden
- [Agent Skills](/docs/ai/skills) — `rebase skills install` und die 24 Skills
- [Instruction Files](/docs/ai/instruction-files) — das Muster für vorgefertigte Regeldateien
