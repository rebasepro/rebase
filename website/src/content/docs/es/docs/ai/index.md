---
title: IA y agentes
sidebar_label: Información general
description: "Lo que Rebase incluye para asistentes de programación con IA y agentes autónomos: un servidor MCP, skills de agentes locales del proyecto, archivos de instrucciones estructurados y el modelo de credenciales que decide a qué puede acceder realmente un agente."
---

Rebase incluye cuatro elementos distintos para asistentes de IA, y cada uno resuelve
un problema diferente. Vale la pena saber a cuál de ellos estás recurriendo:

| | Qué es | Quién lo consume |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Un servidor Model Context Protocol basado en stdio con 41 herramientas sobre tu esquema, datos, usuarios, almacenamiento, cron y servidor de desarrollo | Un asistente, en tiempo de ejecución |
| [**Skills de agentes**](/docs/ai/skills) | 20 archivos de skills en Markdown escritos en tu repositorio mediante `rebase skills install` | Un asistente, como material de referencia |
| [**Archivos de instrucciones**](/docs/ai/instruction-files) | `ai-instructions.md` además de archivos de puntero por asistente, generados por `rebase init` | Un asistente, como reglas siempre activas |
| [**Claves de API**](/docs/backend/api#api-keys) | Credenciales de máquina con alcance limitado, por colección y por operación | Cualquier elemento que llame a la API HTTP |

Los tres primeros tratan de dotar al asistente de *conocimiento* y *herramientas*. El
cuarto es el único que decide lo que realmente puede hacer.

## La parte que importa: a qué puede acceder un agente

Un agente con herramientas sobre tu base de datos es un llamador de API ordinario que
simplemente decide su propia siguiente solicitud. Rebase no intenta restringirlo mediante
instrucciones: un prompt no es un mecanismo de control de acceso, y un agente que
lee tus filas está leyendo texto que otra persona podría haber escrito. La
restricción debe residir por debajo del agente, en la credencial que porta.

Rebase le otorga a esa credencial dos compuertas independientes:

1. **La lista de permisos de la clave de API.** Declarada por colección *y* por operación,
   donde `delete` se puede separar de `write`, que suele ser el permiso que deseas
   denegar a un agente al que, por lo demás, se le permite editar.
2. **Seguridad a nivel de fila (RLS).** Las claves de API no eluden RLS. Una clave se conecta como el
   rol de Postgres `rebase_user` como cualquier otro llamador, por lo que tus políticas siguen
   decidiendo qué filas se devuelven.

Ambas deben permitir una solicitud. Ninguna sustituye a la otra, y la segunda
es la razón por la cual una clave con permisos `"*"` aún puede devolver un conjunto
de resultados vacío.

Un detalle que suele confundir: el ajuste `access: "public"` de una colección amplía **qué
filas puede ver un llamador**, no **quién puede llamar**. Es una declaración sobre la
visibilidad de las filas, no sobre la autenticación. Concederlo no añade a un llamador a la
lista de permisos, y denegarlo no detiene a ninguno.

La mecánica (creación de claves, el JSON de permisos, rotación, caducidad,
límites de velocidad) se detalla en [API REST → Claves de API](/docs/backend/api#api-keys).
No pases por alto [Reglas de seguridad (RLS)](/docs/collections/security-rules);
la segunda compuerta solo es tan buena como las políticas que hayas escrito.

:::caution[El servidor MCP no utiliza por defecto una clave con alcance limitado]
El modelo de dos compuertas anterior describe el funcionamiento de una clave de API. **No** es lo que
`@rebasepro/mcp` utiliza a menos que lo configures para ello. Por defecto, el servidor MCP
se autentica con la **service key** de tu servidor de desarrollo: una credencial de administrador
sin restricciones de alcance que satisface las políticas de administración predeterminadas en cada colección. Consulta
[A qué puede acceder el servidor MCP](/docs/ai/mcp#what-the-server-can-reach)
antes de apuntar un asistente a cualquier cosa que te importe.
:::

## Búsqueda vectorial

Rebase cuenta con un tipo de propiedad `vector` nativo en Postgres y un
método de consulta `.vectorSearch()` con distancias `cosine`, `l2` e `inner_product`.
Ya está documentado, en dos lugares en vez de uno:

- [Consulta de datos → Búsqueda vectorial](/docs/sdk/querying#vector-search) — el método del SDK,
  el campo `_distance` que añade a cada fila y las consideraciones
- [API REST → Búsqueda vectorial](/docs/backend/api#vector-search) — los
  parámetros de consulta `vector_search`, `vector`, `vector_distance` y `vector_threshold`

Tres aspectos que debes saber antes de diseñar en torno a esto. **Rebase almacena y busca
embeddings; no los calcula**: no hay ningún proveedor de embeddings, configuración
de modelo ni clave de API en ningún lugar de Rebase, por lo que generar los vectores es tu responsabilidad.
**pgvector es un requisito previo, y su instalación es opcional (opt-in).**
`database({ extensions: ["vector"] })` en `config/resources.ts` permite que
`rebase db push` y la verificación de esquema del arranque ejecuten
`CREATE EXTENSION IF NOT EXISTS vector`; sin esa línea crean la columna y dejan
la extensión en tus manos. En cualquier caso el servidor necesita una imagen que
lleve la biblioteca y un rol con permiso para instalarla. Y
**cada columna vectorial obtiene un índice HNSW para la distancia coseno**,
porque coseno es lo que mide `vectorSearch` salvo que pases `distance`: un
índice sirve exactamente a un operador. Ajústalo, o desactívalo, en la
propiedad: consulta [El índice](/docs/sdk/querying#the-index).

Tampoco es posible suscribirse a consultas vectoriales; `.vectorSearch(...).listen()` es
rechazado con `VECTOR_SEARCH_NOT_LIVE`.

Para la búsqueda léxica (texto completo clasificado sobre los campos que especifiques,
incluyendo contenido JSONB y arrays), consulta [Búsqueda](/docs/backend/search). Es un
mecanismo diferente y ambos no interactúan entre sí.

## Próximos pasos

- [Servidor MCP](/docs/ai/mcp) — conecta Claude Code, Cursor o cualquier cliente MCP
- [Skills de agentes](/docs/ai/skills) — `rebase skills install` y las 21 skills
- [Archivos de instrucciones de IA](/docs/ai/instruction-files) — el patrón de reglas estructuradas

---
