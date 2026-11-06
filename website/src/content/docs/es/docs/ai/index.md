---
sourceHash: ff803e68f256ae11
title: IA y agentes
sidebar_label: Información general
description: Lo que Rebase ofrece para asistentes de programación con IA y agentes autónomos — un servidor MCP, agent skills locales del proyecto, archivos de instrucciones estructurados y el modelo de credenciales que decide a qué puede acceder realmente un agente.
---

**Para usar Claude con tus proyectos de Rebase, añade el [conector de Rebase](/docs/ai/rebase-connector/).**
En Claude, abre **Settings → Connectors → Add custom connector**, introduce
`https://app.rebase.pro/mcp` e inicia sesión con tu cuenta de Rebase. Tus proyectos de
Rebase Cloud estarán allí de inmediato; añade cada servidor autohospedado una sola vez con
`rebase cloud connect https://your-app.com`. Un único conector accede a todos ellos.

Más allá de eso, Rebase ofrece cinco elementos independientes para asistentes de IA, los cuales resuelven
problemas distintos. Vale la pena saber a cuál de ellos estás recurriendo:

| | Qué es | Quién lo consume |
|---|---|---|
| [**Conector de Rebase**](/docs/ai/rebase-connector) | Un conector MCP alojado en `app.rebase.pro/mcp` para cada proyecto que ejecutes, en Rebase Cloud o autohospedado: datos, esquema, cron, y en despliegues en Cloud, variables de entorno y registros | Claude en la web, escritorio y móvil, actuando como tú |
| [**Servidor MCP**](/docs/ai/mcp) | Un servidor Model Context Protocol basado en stdio con 53 herramientas sobre tu esquema, datos, usuarios, almacenamiento, cron, servidor de desarrollo y proyecto de Rebase Cloud | Un asistente, en tiempo de ejecución |
| [**Agent skills**](/docs/ai/skills) | 23 archivos Markdown de habilidades escritos en tu repositorio mediante `rebase skills install` | Un asistente, como material de referencia |
| [**Archivos de instrucciones**](/docs/ai/instruction-files) | `ai-instructions.md` más archivos puntero por asistente, creados por `rebase init` | Un asistente, como reglas permanentes |
| [**Claves de API**](/docs/backend/api-keys) | Credenciales de máquina que contienen [scopes](/docs/backend/roles-and-scopes), por colección y por operación | Cualquier elemento que llame a la API HTTP |

Los primeros cuatro tienen como fin dotar a un asistente de *conocimiento* y *herramientas*. El
quinto es el único que decide qué puede hacer realmente.

## La parte importante: qué puede tocar un agente

Un agente con herramientas sobre tu base de datos es un cliente de API común y corriente que
simplemente decide su propia siguiente petición. Rebase no intenta restringirlo mediante
instrucciones: un prompt no es un mecanismo de control de acceso, y un agente que
lee tus filas está leyendo texto que otra persona pudo haber escrito. La
restricción debe residir por debajo del agente, en la credencial que porta.

Rebase asigna a esa credencial dos barreras independientes:

1. **Los scopes de la clave.** Declarados por operación *y*, cuando lo desees, por
   colección: `data:read:articles`, `data:write:articles`. `data:delete` es
   independiente de `data:write`, que suele ser el que querrás retener
   para un agente al que, por lo demás, se le permite editar.
2. **Row-Level Security (Seguridad a Nivel de Fila).** Las claves de API no eluden RLS. Una clave se conecta con el
   rol de Postgres `rebase_user` como cualquier otro cliente, por lo que tus políticas siguen
   decidiendo qué filas se devuelven.

Ambos deben permitir una petición. Ninguno es sustituto del otro, y la segunda
barrera es la razón por la cual una clave que posea `data:read` en cada colección aún puede devolver
un conjunto de resultados vacío.

Un detalle que suele confundir: el parámetro `access: "public"` de una colección amplía **qué
filas puede ver quien realiza la llamada**, no **quién puede llamar**. Es una declaración sobre la visibilidad
de las filas, no sobre la autenticación. Concederlo no otorga un scope a una clave,
y omitirlo no restringe uno existente.

Los mecanismos —creación de claves, selección de scopes, rotación, caducidad, límites
de peticiones— se detallan en [Claves de API](/docs/backend/api-keys).
No pases por alto las [Reglas de seguridad (RLS)](/docs/collections/security-rules);
la segunda barrera es tan buena como lo sean las políticas que hayas escrito.

:::caution[El servidor MCP no usa una clave con scopes por defecto]
El modelo de dos barreras anterior describe lo que hace una clave de API. **No** es lo que
utiliza `@rebasepro/mcp` a menos que lo configures explícitamente para ello. Por defecto, el servidor MCP
se autentica con la **clave de servicio (service key)** de tu servidor de desarrollo: una credencial de administrador
sin scopes que cumple con las políticas de administrador predeterminadas en cada colección. Consulta
[A qué puede acceder el servidor MCP](/docs/ai/mcp#what-the-server-can-reach)
antes de conectar un asistente a cualquier recurso importante.
:::

## Búsqueda vectorial

Rebase cuenta con un tipo de propiedad nativo `vector` en Postgres y un
método de consulta `.vectorSearch()` con distancias `cosine`, `l2` e `inner_product`.
Ya se encuentra documentado en dos secciones independientes:

- [Consulta de datos → Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search) — el método
  del SDK, el campo `_distance` que añade a cada fila y las consideraciones a tener en cuenta
- [API REST → Búsqueda vectorial](/docs/backend/api#vector-search) — los
  parámetros de consulta `vector_search`, `vector`, `vector_distance` y `vector_threshold`

Tres aspectos a considerar antes de diseñar en torno a esto. **Rebase almacena y busca
embeddings; no los calcula**: no existe ningún proveedor de embeddings,
configuración de modelos ni clave de API en Rebase, por lo que generar los vectores es tu responsabilidad.
**pgvector es un requisito previo, y su instalación es opcional (opt-in).**
`database({ extensions: ["vector"] })` en `config/resources.ts` permite que `rebase db push`
y la verificación del esquema en el arranque ejecuten `CREATE EXTENSION IF NOT EXISTS vector`
automáticamente; sin esto, crearán la columna y dejarán la instalación de la extensión bajo tu control.
En cualquier caso, el servidor requiere una imagen que contenga la biblioteca y un rol con permisos para
instalarla. Y **cada columna vectorial obtiene un índice HNSW para la distancia
coseno**, ya que el coseno es la métrica que utiliza `vectorSearch` a menos que
especifiques `distance`; un índice sirve exactamente para un operador. Puedes ajustarlo o
desactivarlo directamente en la propiedad: consulta [El índice](/docs/sdk/aggregates-and-search#the-index).

Las consultas vectoriales tampoco admiten suscripciones en tiempo real; `.vectorSearch(...).listen()`
se rechaza con el error `VECTOR_SEARCH_NOT_LIVE`.

Para la búsqueda léxica —búsqueda clasificada de texto completo sobre los campos que especifiques,
incluidos contenidos JSONB y de arrays— consulta [Búsqueda](/docs/backend/search). Es un
mecanismo diferente y ambos no interactúan entre sí.

## Próximos pasos

- [Conector de Rebase](/docs/ai/rebase-connector) — Claude, conectado a cada proyecto que ejecutes
- [Servidor MCP](/docs/ai/mcp) — conecta Claude Code, Cursor o cualquier cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` y las 23 habilidades
- [Archivos de instrucciones de IA](/docs/ai/instruction-files) — el patrón estructurado de reglas
