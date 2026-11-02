---
sourceHash: f0b5790a3df6501a
title: IA y Agentes
sidebar_label: Visión general
description: Lo que Rebase incluye para asistentes de programación con IA y agentes autónomos — un servidor MCP, habilidades de agentes locales del proyecto, archivos de instrucciones estructurados y el modelo de credenciales que decide a qué puede acceder realmente un agente.
---

Rebase incluye cuatro elementos distintos para asistentes de IA, y resuelven
diferentes problemas. Conviene saber a cuál de ellos estás recurriendo:

| | Qué es | Quién lo consume |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Un servidor stdio de Model Context Protocol con 53 herramientas sobre tu esquema, datos, usuarios, almacenamiento, cron, servidor de desarrollo y proyecto de Rebase Cloud | Un asistente, en tiempo de ejecución |
| [**Habilidades de agente**](/docs/ai/skills) | 23 archivos Markdown de habilidades escritos en tu repositorio mediante `rebase skills install` | Un asistente, como material de referencia |
| [**Archivos de instrucciones**](/docs/ai/instruction-files) | `ai-instructions.md` más archivos de referencia por asistente, generados por `rebase init` | Un asistente, como reglas permanentes |
| [**Claves de API**](/docs/backend/api-keys) | Credenciales de máquina que contienen [scopes](/docs/backend/roles-and-scopes), por colección y por operación | Cualquier entidad que llame a la API HTTP |

Los tres primeros se centran en proporcionar al asistente *conocimiento* y *herramientas*. El
cuarto es el único que decide qué puede hacer realmente.

## La parte fundamental: qué puede tocar un agente

Un agente con herramientas sobre tu base de datos es un cliente de API común y corriente
que casualmente decide su propia siguiente petición. Rebase no intenta restringirlo con
instrucciones: un prompt no es un mecanismo de control de acceso, y un agente que
lee tus filas está leyendo texto que otra persona pudo haber escrito. La
restricción debe residir por debajo del agente, en la credencial que porta.

Rebase proporciona a esa credencial dos barreras independientes:

1. **Los scopes de la clave.** Declarados por operación *y*, cuando lo desees, por
   colección: `data:read:articles`, `data:write:articles`. `data:delete` es
   independiente de `data:write`, que suele ser el permiso que querrás withholding
   a un agente al que, por lo demás, se le permite editar.
2. **Row-Level Security (Seguridad a nivel de fila).** Las API keys no eluden RLS. Una clave se conecta como el
   rol de Postgres `rebase_user` al igual que cualquier otro cliente, por lo que tus políticas siguen
   decidiendo qué filas se devuelven.

Ambos deben autorizar la petición. Ninguno sustituye al otro, y la segunda barrera
es la razón por la cual una clave que posea `data:read` en todas las colecciones aún puede
devolver un conjunto de resultados vacío.

Un detalle que suele confundir a la gente: el ajuste `access: "public"` de una colección amplía **qué
filas puede ver quien llama**, no **quién puede llamar**. Es una declaración sobre la
visibilidad de las filas, no sobre la autenticación. Concederlo no otorga un scope a una clave,
y denegarlo no detiene a una que ya lo tenga.

El funcionamiento técnico —creación de claves, selección de scopes, rotación, caducidad,
límites de tasa— se explica en [API keys](/docs/backend/api-keys).
No pases por alto [Security Rules (RLS)](/docs/collections/security-rules);
la segunda barrera es tan buena como las políticas que hayas escrito.

:::caution[El servidor MCP no utiliza por defecto una clave con scopes]
El modelo de dos barreras anterior describe lo que hace una API key. **No** es lo que
`@rebasepro/mcp` utiliza a menos que lo configures explícitamente para ello. Si no se modifica, el servidor MCP
se autentica con la **service key** de tu servidor de desarrollo —una credencial de administrador
sin scopes que satisface las políticas de administrador predeterminadas en cada colección. Consulta
[A qué puede acceder el servidor MCP](/docs/ai/mcp#what-the-server-can-reach)
antes de conectar un asistente a cualquier recurso que te importe.
:::

## Búsqueda vectorial

Rebase cuenta con un tipo de propiedad `vector` nativo en Postgres y un
método de consulta `.vectorSearch()` con distancias `cosine`, `l2` e `inner_product`.
Ya se encuentra documentado en dos lugares distintos:

- [Consulta de datos → Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search) — el método del SDK,
  el campo `_distance` que añade a cada fila y las consideraciones a tener en cuenta
- [API REST → Búsqueda vectorial](/docs/backend/api#vector-search) — los
  parámetros de consulta `vector_search`, `vector`, `vector_distance` y `vector_threshold`

Tres aspectos a considerar antes de diseñar en torno a ella. **Rebase almacena y busca
embeddings; no los calcula** — no hay ningún proveedor de embeddings, configuración
de modelo ni clave de API en Rebase, por lo que generar los vectores es responsabilidad tuya.
**pgvector es un prerrequisito y su instalación es opcional (opt-in).**
Definir `database({ extensions: ["vector"] })` en `config/resources.ts` permite que `rebase db
push` y la comprobación del esquema al iniciar ejecuten `CREATE EXTENSION IF NOT EXISTS vector`
por ti; sin esto, crearán la columna y dejarán la instalación de la extensión de tu parte. En
cualquier caso, el servidor necesita una imagen que contenga la biblioteca y un rol autorizado para
instalarla. Además, **cada columna vectorial obtiene un índice HNSW para
distancia coseno**, ya que el coseno es lo que mide `vectorSearch` a menos que
especifiques `distance` — un índice da servicio exactamente a un operador. Configúralo, o
desactívalo, en la propiedad: consulta [El índice](/docs/sdk/aggregates-and-search#the-index).

Tampoco es posible suscribirse a consultas vectoriales; `.vectorSearch(...).listen()` se
rechaza con `VECTOR_SEARCH_NOT_LIVE`.

Para la búsqueda léxica —búsqueda de texto completo clasificada sobre los campos que elijas,
incluyendo contenido JSONB y arrays— consulta [Búsqueda](/docs/backend/search). Es un
mecanismo diferente y ambos no interactúan entre sí.

## Próximos pasos

- [Servidor MCP](/docs/ai/mcp) — conecta Claude Code, Cursor o cualquier cliente MCP
- [Habilidades de agente](/docs/ai/skills) — `rebase skills install` y las 23 habilidades
- [Archivos de instrucciones de IA](/docs/ai/instruction-files) — el patrón de reglas estructuradas
