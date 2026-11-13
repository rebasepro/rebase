---
sourceHash: 4040537e5cc9b4d3
title: IA y agentes
sidebar_label: Descripción general
description: Lo que Rebase ofrece para asistentes de programación con IA y agentes autónomos — un servidor MCP, agent skills a nivel de proyecto, archivos de instrucciones estructurados y el modelo de credenciales que decide a qué puede acceder realmente un agente.
---

**Para usar Claude con tus proyectos de Rebase, añade el [conector de Rebase](/docs/ai/rebase-connector/).**
En Claude, abre **Settings → Connectors → Add custom connector**, introduce
`https://app.rebase.pro/mcp` e inicia sesión con tu cuenta de Rebase. Tus proyectos de Rebase
Cloud estarán disponibles de inmediato; añade cada servidor autohospedado una sola vez con
`rebase cloud connect https://your-app.com`. Un único conector accede a todos ellos.

Más allá de eso, Rebase ofrece cinco elementos independientes para asistentes de IA, y resuelven
problemas diferentes. Vale la pena saber a cuál estás recurriendo:

| | Qué es | Quién lo consume |
|---|---|---|
| [**Rebase connector**](/docs/ai/rebase-connector) | Un conector MCP alojado en `app.rebase.pro/mcp` para cada proyecto que ejecutes, en Rebase Cloud o autohospedado: datos, esquema, cron, y en despliegues de Cloud, variables de entorno y logs | Claude en la web, escritorio y móvil, actuando como tú |
| [**MCP server**](/docs/ai/mcp) | Un servidor Model Context Protocol basado en stdio con 53 herramientas sobre tu esquema, datos, usuarios, almacenamiento, cron, servidor de desarrollo y proyecto de Rebase Cloud | Un asistente, en tiempo de ejecución |
| [**Agent skills**](/docs/ai/skills) | 24 archivos Markdown de habilidades escritos en tu repositorio mediante `rebase skills install` | Un asistente, como material de referencia |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` más archivos de referencia por asistente, generados por `rebase init` | Un asistente, como reglas siempre activas |
| [**API keys**](/docs/backend/api-keys) | Credenciales de máquina que contienen [scopes](/docs/backend/roles-and-scopes), por tabla y por operación | Cualquier elemento que llame a la API HTTP |

Los primeros cuatro sirven para dar a un asistente *conocimiento* y *herramientas*. El
quinto es el único que decide qué puede hacer en realidad.

## La parte que importa: qué puede tocar un agente

Un agente con herramientas sobre tu base de datos es un cliente de API ordinario que simplemente
decide su propia siguiente petición. Rebase no intenta restringirlo mediante
instrucciones: un prompt no es un mecanismo de control de acceso, y un agente que
lee tus filas está leyendo texto que otra persona pudo haber escrito. La
restricción debe residir por debajo del agente, en la credencial que porta.

Rebase dota a esa credencial de dos barreras independientes:

1. **Los scopes de la clave.** Declarados por operación *y*, cuando lo desees, por
   tabla: `data:read:articles`, `data:write:articles`. `data:delete` es
   independiente de `data:write`, que suele ser el permiso que querrás retener
   frente a un agente al que, por lo demás, se le permite editar.
2. **Row-Level Security.** Las API keys no omiten RLS. Una clave se conecta con el
   rol de Postgres `rebase_user` como cualquier otro cliente, por lo que tus políticas siguen
   decidiendo qué filas se devuelven.

Ambas deben permitir una petición. Ninguna sustituye a la otra, y la segunda
es la razón por la que una clave que contiene `data:read` en todas las tablas aún puede devolver
un conjunto de resultados vacío.

Un detalle que suele causar confusión: el `access: "public"` de una tabla amplía **qué
filas puede ver un cliente**, no **quién puede llamar**. Es una declaración sobre la
visibilidad de las filas, no sobre la autenticación. Concederlo no otorga un scope a una clave,
y no incluirlo no detiene a una clave que ya disponga de él.

El funcionamiento detallado —creación de claves, selección de scopes, rotación, caducidad,
límites de peticiones— se cubre en [API keys](/docs/backend/api-keys).
No pases por alto [Security Rules (RLS)](/docs/collections/security-rules);
la segunda barrera es tan buena como las políticas que hayas escrito.

:::caution[El servidor MCP no utiliza por defecto una clave con scopes]
El modelo de dos barreras anterior describe lo que hace una API key. **No** es lo que
`@rebasepro/mcp` utiliza a menos que lo configures para ello. Si no se modifica, el servidor MCP
se autentica con la **service key** de tu servidor de desarrollo: una credencial de
administrador sin scopes que satisface las políticas de administración predeterminadas en cada tabla. Consulta
[A qué puede acceder el servidor MCP](/docs/ai/mcp#what-the-server-can-reach)
antes de conectar un asistente a cualquier recurso importante.
:::

## Búsqueda vectorial

Rebase cuenta con un tipo de propiedad nativo `vector` en Postgres y un
método de consulta `.vectorSearch()` con distancias `cosine`, `l2` e `inner_product`.
Ya se encuentra documentado en dos lugares distintos:

- [Consulta de datos → Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search): el método
  del SDK, el campo `_distance` que añade a cada fila y las advertencias pertinentes
- [API REST → Búsqueda vectorial](/docs/backend/api#vector-search): los parámetros
  de consulta `vector_search`, `vector`, `vector_distance` y `vector_threshold`

Tres aspectos que debes conocer antes de diseñar en torno a ella: **Rebase almacena y busca
embeddings; no los calcula**: no hay ningún proveedor de embeddings, configuración
de modelo ni clave de API en Rebase, por lo que generar los vectores es tu responsabilidad.
**pgvector es un prerrequisito y su instalación es opcional (opt-in).**
`database({ extensions: ["vector"] })` en `backend/resources.ts` permite que `rebase db
push` y la verificación de esquema durante el arranque ejecuten `CREATE EXTENSION IF NOT EXISTS vector`
por ti; sin esto, crearán la columna y dejarán la instalación de la extensión bajo tu cuenta. En cualquier
caso, el servidor necesita una imagen que contenga la biblioteca y un rol con permisos para
instalarla. Además, **cada columna vectorial obtiene un índice HNSW para
distancia de coseno**, porque el coseno es la métrica de medición por defecto en `vectorSearch` a menos
que especifiques `distance` (un índice sirve exactamente a un solo operador). Puedes calibrarlo o
desactivarlo directamente en la propiedad: consulta [El índice](/docs/sdk/aggregates-and-search#the-index).

Tampoco es posible suscribirse a consultas vectoriales; `.vectorSearch(...).listen()` se
rechaza con `VECTOR_SEARCH_NOT_LIVE`.

Para búsquedas léxicas —texto completo clasificado sobre los campos que elijas, incluyendo contenido
JSONB y arrays— consulta [Búsqueda](/docs/backend/search). Es un mecanismo
diferente y ambos no interactúan entre sí.

## Pasos siguientes

- [Rebase connector](/docs/ai/rebase-connector) — Claude, conectado a cada proyecto que ejecutes
- [Servidor MCP](/docs/ai/mcp) — conecta Claude Code, Cursor o cualquier cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` y las 24 habilidades
- [Archivos de instrucciones para IA](/docs/ai/instruction-files) — el patrón de reglas predefinidas
