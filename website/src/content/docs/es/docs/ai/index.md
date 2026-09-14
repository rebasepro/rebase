---
sourceHash: ec9977f5b00dc133
title: IA y agentes
sidebar_label: Descripción general
description: Lo que Rebase incluye para asistentes de programación con IA y agentes autónomos — un servidor MCP, habilidades de agente locales del proyecto, archivos de instrucciones estructurados y el modelo de credenciales que decide a qué puede acceder realmente un agente.
---

Rebase incluye cuatro cosas independientes para asistentes de IA, y resuelven
diferentes problemas. Vale la pena saber cuál estás buscando:

| | Qué es | Quién lo consume |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Un servidor Model Context Protocol stdio con 42 herramientas sobre tu esquema, datos, usuarios, almacenamiento, cron y servidor de desarrollo | Un asistente, en tiempo de ejecución |
| [**Habilidades de agente**](/docs/ai/skills) | 21 archivos de habilidades en Markdown escritos en tu repositorio mediante `rebase skills install` | Un asistente, como material de referencia |
| [**Archivos de instrucciones**](/docs/ai/instruction-files) | `ai-instructions.md` más archivos de puntero por asistente, escritos mediante `rebase init` | Un asistente, como reglas siempre activas |
| [**Claves de API**](/docs/backend/api-keys) | Credenciales de máquina con alcance delimitado, por colección y por operación | Cualquier cosa que llame a la API HTTP |

Las tres primeras se centran en dar a un asistente *conocimiento* y *herramientas*. La
cuarta es la única que decide lo que realmente puede hacer.

## La parte importante: qué puede tocar un agente

Un agente con herramientas sobre tu base de datos es un llamador de API ordinario que
casualmente decide su propia siguiente petición. Rebase no intenta restringirlo mediante
instrucciones: un prompt no es un mecanismo de control de acceso, y un agente que
lee tus filas está leyendo texto que otra persona pudo haber escrito. La
restricción debe residir por debajo del agente, en la credencial que porta.

Rebase le otorga a esa credencial dos compuertas independientes:

1. **La lista de permisos de la clave de API.** Declarada por colección *y* por
   operación, donde `delete` se puede separar de `write`, que suele ser la que
   deseas retener para un agente al que, por lo demás, se le permite editar.
2. **Seguridad a nivel de fila (RLS).** Las claves de API no eluden RLS. Una clave se
   conecta como el rol de Postgres `rebase_user` al igual que cualquier otro llamador,
   por lo que tus políticas siguen decidiendo qué filas se devuelven.

Ambas deben permitir una petición. Ninguna es sustituto de la otra, y la segunda
es la razón por la cual una clave con permisos `"*"` aún puede devolver un conjunto
de resultados vacío.

Un punto que suele confundir: el `access: "public"` de una colección amplía **qué
filas puede ver un llamador**, no **quién puede llamar**. Es una declaración sobre
la visibilidad de las filas, no sobre la autenticación. Concederlo no añade un llamador
a la lista de permisos, y revocarlo no detiene a uno.

La mecánica (crear claves, el JSON de permisos, rotación, caducidad, límites de
frecuencia) se trata en [API REST → Claves de API](/docs/backend/api-keys).
No pases por alto las [Reglas de seguridad (RLS)](/docs/collections/security-rules);
la segunda compuerta solo es tan buena como las políticas que hayas escrito.

:::caution[El servidor MCP no utiliza por defecto una clave con alcance limitado]
El modelo de dos compuertas anterior describe lo que hace una clave de API. **No** es lo que
usa `@rebasepro/mcp` a menos que lo configures para ello. Si no se modifica, el servidor MCP
se autentica con la **service key** de tu servidor de desarrollo, una credencial de
administrador sin restricciones que satisface las políticas de administración predeterminadas
en cada colección. Consulta [Qué puede alcanzar el servidor MCP](/docs/ai/mcp#what-the-server-can-reach)
antes de apuntar un asistente a cualquier cosa que te importe.
:::

## Búsqueda vectorial

Rebase cuenta con un tipo de propiedad `vector` nativo en Postgres y un
método de consulta `.vectorSearch()` con distancia `cosine`, `l2` e `inner_product`.
Ya está documentado, en dos lugares en vez de uno:

- [Consulta de datos → Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search) — el método
  del SDK, el campo `_distance` que añade a cada fila y las consideraciones
- [API REST → Búsqueda vectorial](/docs/backend/api#vector-search) — los
  parámetros de consulta `vector_search`, `vector`, `vector_distance` y `vector_threshold`

Tres cosas que debes saber antes de diseñar en torno a esto. **Rebase almacena y busca
embeddings; no los calcula**: no hay ningún proveedor de embeddings, configuración
de modelo ni clave de API en ninguna parte de Rebase, por lo que generar los vectores es
tu tarea. **pgvector es un prerrequisito, y su instalación es opcional.**
`database({ extensions: ["vector"] })` en `config/resources.ts` permite que `rebase db
push` y la verificación del esquema al inicio ejecuten `CREATE EXTENSION IF NOT EXISTS vector`
por ti; sin esto, crearán la columna y dejarán la extensión a tu cargo. De
cualquier modo, el servidor necesita una imagen que contenga la biblioteca y un rol con
permisos para instalarla. Y **cada columna vectorial obtiene un índice HNSW para la
distancia coseno**, porque el coseno es lo que mide `vectorSearch` a menos
que pases `distance`; un índice sirve exactamente a un operador. Ajústalo o
desactívalo en la propiedad: consulta [El índice](/docs/sdk/aggregates-and-search#the-index).

Las consultas vectoriales tampoco admiten suscripciones; `.vectorSearch(...).listen()`
se rechaza con `VECTOR_SEARCH_NOT_LIVE`.

Para la búsqueda léxica (búsqueda de texto completo clasificada sobre los campos que
especifiques, incluidos contenidos JSONB y arrays), consulta [Búsqueda](/docs/backend/search).
Es un mecanismo diferente y ambos no interactúan entre sí.

## Siguientes pasos

- [Servidor MCP](/docs/ai/mcp) — conecta Claude Code, Cursor o cualquier cliente MCP
- [Habilidades de agente](/docs/ai/skills) — `rebase skills install` y las 21 habilidades
- [Archivos de instrucciones de IA](/docs/ai/instruction-files) — el patrón de reglas estructuradas
