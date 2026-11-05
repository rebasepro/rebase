---
sourceHash: 448871502e7447b5
slug: es/docs/compatibility
title: Compatibilidad
description: "Lo que Rebase promete entre versiones y lo que no: los seis contratos versionados, cómo falla cada uno y qué puede cambiar todavía en una versión menor."
---

Lo que Rebase promete entre versiones y lo que no.

Este es el documento que debes leer antes de cambiar cualquier cosa de la que ya dependa un proyecto desplegado o un tenant en ejecución de Rebase Cloud. También es la respuesta honesta a «si desarrollo sobre Rebase hoy, ¿qué dejará de funcionar más adelante?».

## Qué significa "beta" aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para dar a entender que "cualquier cosa puede romperse", lo cual no le dice nada al lector con lo que pueda planificar, así que esta es la línea que este proyecto realmente traza:

> **La API contra la que programas puede cambiar en una versión menor, con una entrada en el registro de cambios. Tus datos no pueden romperse en silencio.**

La primera mitad es el comportamiento habitual de `0.x` y se describe a continuación. La segunda mitad es la parte que vale la pena comprobar, porque es una afirmación sobre mecanismos más que sobre intenciones: los contratos versionados de la siguiente sección están estampados en un artefacto o en una base de datos, cada uno se comprueba al arrancar o en la recepción, y cada uno **falla de forma ruidosa y específica** en lugar de degradarse. Una inserción de esquema (`schema push`) que eliminaría una columna es rechazada por una compuerta destructiva (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la ruta de actualización en sí misma es una prueba: `upgrade-e2e.test.ts` restaura bases de datos tal como las dejaron versiones anteriores, ejecuta la ruta de migración actual sobre cada una y afirma que las filas sobreviven, no simplemente que el arranque lo hizo.

Lo que beta sí significa: todavía faltan características, algunos subsistemas son más nuevos que otros, y la forma de un detalle tosco es que algo esté ausente o sea incómodo, no que corrompa algo en silencio. Cuáles subsistemas son cuáles se publica y fecha en lugar de dejarse para ser descubierto; la tabla a continuación es dicha publicación.

## Nivel de preparación por subsistema

**Última revisión el 14 de septiembre de 2026, correspondiente a 0.21.0.** Vuelve a leerlo en cada versión menor; una calificación que no se haya movido en tres versiones está establecida o se ha olvidado, y esta nota está aquí para que se verifique la diferencia.

Las tres calificaciones significan:

- **Estable** — la forma está consolidada y cubierta por una compuerta en CI. Todavía puede ganar funcionalidades; no se rediseñará a tus espaldas dentro de 0.x, y cualquier cambio que pudiera romper tu código se anunciará en el registro de cambios.
- **Beta** — funciona y se usa en producción, y se sabe que algo en ello es tosco: un límite que puedes alcanzar, un caso límite incómodo, una decisión de diseño aún no tomada. La parte tosca se detalla en las notas, porque "beta" por sí sola no te dice nada sobre lo que puedas planificar.
- **Experimental** — publicado para que pueda usarse y reportarse. Cuenta con encontrarte con las partes por las que nadie ha pasado aún.

| Subsistema | Calificación | En qué se basa la calificación |
|---|---|---|
| REST API + SDK generado | Estable | El contrato de red (wire contract) está versionado y controlado por compuertas; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con alcance RLS → refresco → almacenamiento → tiempo real de extremo a extremo |
| Autenticación — correo/contraseña, OAuth, OIDC, enlace mágico, código de un solo uso | Estable | Se incluyen doce proveedores de OAuth. El esquema de autenticación es un contrato versionado, sellado y verificado en el arranque |
| Autenticación — MFA (TOTP) | Beta | El registro (enrolment), verificación y recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no hay una interfaz administrativa para restablecer el factor de un usuario bloqueado |
| Seguridad a nivel de fila (Row-level security) | Estable | La pieza angular del producto. `pnpm rls:check` audita una base de datos activa contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Almacenamiento | Estable | Local, S3 y GCS. Denegación por defecto (default-deny) en producción desde 0.17.0, y el scaffold incluye un hook de autorización |
| Tiempo real | **Beta** | Las suscripciones solo coinciden por la ruta de la colección, por lo que N suscriptores en una colección cuestan N reconsultas (refetches) con alcance RLS por escritura. Eso limita un despliegue a unos pocos cientos de suscriptores concurrentes. Correcto a cualquier escala; costoso a partir de esa cifra |
| Búsqueda vectorial (pgvector) | Beta | Cada columna de vectores obtiene un índice HNSW para distancia coseno por defecto, ajustable por propiedad mediante `VectorIndexConfig` (método, distancias, parámetros de compilación) o desactivado, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2000 dimensiones, por lo que estas quedan sin indexar y se escanean |
| Sincronización sin conexión | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y se han corregido los defectos de pérdida de datos encontrados en la auditoría de julio. El modelo de resolución de conflictos es el de última escritura gana (last-write-wins) sin fusión por campo |
| Historial de entidades | Estable | Basado en instantáneas (snapshots), verificado por su propia suite |
| Funciones y crons | Estable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| Servidor MCP + agent skills | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cincuenta y tres herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan destinos no locales a menos que se habilite explícitamente. Desde la versión 0.21 el servidor también puede montar un endpoint remoto `/mcp` — OAuth 2.1, nueve herramientas de datos, cada llamada bajo el propio RLS del usuario que inició sesión — desactivado salvo que `REBASE_MCP_ENABLED=true`, y solo en Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizado a diario en proyectos reales. La ramificación (branching) está presente en el paquete de código abierto (OSS) y deliberadamente no está expuesta en Rebase Cloud, porque mover un despliegue en ejecución a una rama aún no tiene un flujo definido |
| CMS + panel de administración | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de cuadrícula (grid)** — sin `role`, sin `aria-rowindex`, con `tabIndex` eliminado —, por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por idioma/región, sin texto enriquecido en bloques |
| Base de datos de desarrollo administrada PGlite | Beta | `rebase dev` con configuración cero y sin Docker. Una sesión a la vez, por lo que las solicitudes se serializan y no se puede reproducir la concurrencia contra ella; los comandos respaldados por Atlas (`db push`, `generate`, `migrate`) planifican contra un segundo PGlite desechable iniciado para el comando (en 0.24 rechazan la base de datos administrada); `db branch` no funciona allí y lo advierte |
| Helm chart | Beta | Renderiza la topología de procesos divididos y se publica en el registro OCI en cada versión. El valor predeterminado sigue siendo un solo contenedor |
| `@rebasepro/server-mongo` | **Experimental** | Un controlador funcional con tiempo real mediante change-stream e historial de instantáneas. **Sin seguridad a nivel de fila (RLS)** — todo el modelo de aislamiento anterior no le aplica — y sin relaciones. Los change streams necesitan un conjunto de réplicas (replica set): en un `mongod` independiente nada los reemplaza, por lo que una suscripción ve las escrituras realizadas a través de ese proceso de Rebase y se pierde todas las demás. Sin MFA: el registro responde 501, y las comprobaciones responden "sin factor", por lo que el inicio de sesión nunca solicita uno. El agregador del admin no puede apuntar a una colección —lee el nombre de una etapa `$from` que MongoDB no tiene—, por lo que no devuelve nada |
| `@rebasepro/firebase` | Experimental | Ejecuta el panel de administración y el SDK contra Firestore. Sin RLS, sin interfaz SQL; el conjunto de funciones de Postgres no se traslada. El controlador de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno lee todas las filas que sus filtros simples permitan |
| Rebase Cloud | **Beta privada** | Activo, ejecutando tenants reales, acceso abierto por lotes. No es autoservicio |

Dos entradas anteriores son el coste honesto de publicar esta tabla: el refetch en tiempo real y la accesibilidad de la tabla de datos son defectos abiertos, no elementos de la hoja de ruta, y ambos están listados en lugar de dejarse para que el lector los descubra.

Esta tabla es lo que existe. Lo que aún no está se encuentra en la [hoja de ruta (roadmap)](https://rebase.pro/roadmap), una entrada por cada issue de GitHub, con el subconjunto requerido para 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está redactada para ser válida en cada versión 0.x y no solo en una de ellas, de modo que no quede desactualizada con cada entrega. **Los cambios importantes (breaking changes) en la API de TypeScript creada todavía están permitidos en una versión menor**, y el registro de cambios es donde se anuncian. Lo que *no* está permitido romper de forma silenciosa es el conjunto de contratos versionados a continuación: cada uno está sellado en un artefacto o base de datos, cada uno se comprueba en el arranque o en la recepción, y cada uno falla **de forma ruidosa y específica** en lugar de degradarse.

Esa distinción es toda la promesa. Una exportación renombrada te cuesta un error de compilación y cinco minutos. Un paquete (bundle) que arranca con el entorno de ejecución incorrecto y sirve datos sutilmente erróneos te cuesta un incidente, y los contratos existen para que la segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Todo lo que no esté listado aquí es un detalle de implementación del que la plataforma no depende.

### Distintivos de versión y compilaciones canary

La documentación se publica desde `main`, por lo que una página puede describir algo que ninguna versión estable tiene todavía. Un distintivo *Since* (Desde) indica la primera versión estable que lo incluye, y el texto a su lado indica lo que hace la versión anterior.

Una versión canary es una compilación de `main` numerada como la versión a la que se dirige: `0.25.0-canary.g<commit>` es `main` en ese commit, después de 0.24.0 y antes de 0.25.0, y `rebase upgrade --to canary` instala la más reciente. Incluye todo lo que había llegado a `main` al momento de compilarse, por lo que un distintivo que mencione su versión (Since 0.25) se aplica a tu caso, y la nota sobre la versión anterior (en 0.24) describe la versión estable de la que provienes. Los canaries anteriores a 0.25.0 se numeraban a partir de la última versión: `0.24.1-canary.g<commit>` también es una vista previa de 0.25.

## Los contratos versionados

Los valores a continuación se leen del código fuente; considera las referencias de archivos como la verdad absoluta y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Comprobado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | Rango `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto declara qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **hacia atrás (backward compatible)** — el nuevo runtime lee bundles antiguos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mismo archivo | mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | al arrancar, contra `rebase.schema_meta` | **solo hacia adelante (forward only)** — el nuevo runtime migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | consultivo — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores derivados de base de datos | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango semver, leído como `engines` en un `package.json`: qué versiones de runtime acepta este proyecto. Se llama deliberadamente `rebase` en lugar de `runtime`, porque `runtime` ya significa *quién es el propietario del proceso* (`managed` | `custom`) en una aplicación.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 2)

La distribución en disco de un bundle compilado. Un runtime acepta cualquier bundle cuyo formato sea **menor o igual que** el suyo, lo que permite al nivel administrado (managed tier) migrar un tenant a una nueva imagen sin que nadie tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio, `entry.admin` para un admin integrado en el bundle.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin` eliminado. El formato 1 todavía se lee, a través de `upgradeLegacyManifest`.

**Incrementa este valor cuando** la disposición cambie de forma que un runtime más antiguo interprete erróneamente un bundle más nuevo. El incremento es lo que convierte un "arranca y no sirve nada" en una negativa a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 1)

La versión mayor del contrato bundle↔runtime. Es distinta de la versión del paquete `@rebasepro/server`, que puede publicar cualquier cantidad de versiones menores y parches mientras esta permanece inalterada.

**Lee esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle destinado al contrato *N* se ejecuta **únicamente** en un runtime que implementa *N*

por lo que incrementarlo invalida **cada bundle jamás compilado**, todos a la vez, hasta que cada uno sea recompilado. Esa es la severidad prevista —es la palanca de "nada antiguo puede ejecutarse aquí"—, pero significa que un incremento es una migración en toda la flota, no una nota de lanzamiento. Para el nivel administrado debe secuenciarse con una recompilación del bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos, lo que se debe modificar es `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Sellado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se niega a iniciar** con una base de datos migrada por una versión del framework más nueva, en lugar de operar sobre una estructura que no comprende; durante un despliegue continuo (rolling deploy), esa es la diferencia entre que la mitad de la flota falle con error y que la mitad de la flota se corrompa.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una base de datos más antigua. Ten en cuenta que este bloque de migración está deliberadamente envuelto en un `try/catch` y registra logs en lugar de lanzar excepciones —un arranque que renguea es mejor que un bucle de reinicios (crash loop)—, por lo que **"ha arrancado" no demuestra nada**. Cada aserción en la suite de actualización lee el catálogo o los datos en su lugar.

**Incrementa este valor cuando** una migración no deba ser omitida por un runtime más antiguo. No lo incrementes para una columna aditiva y retrocompatible; hay un ejemplo práctico de ese criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de las definiciones de colecciones compiladas, emitido en el manifiesto del bundle y devuelto por un SDK generado en la cabecera `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda indicar "esta aplicación se compiló contra un esquema más antiguo" en lugar de fallar de forma misteriosa en la primera solicitud.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; pásalo al cliente para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee esa cabecera en cada solicitud de datos. La desviación (drift) nunca rechaza una llamada —un SDK con una versión de esquema por detrás suele ser compatible, y desplegar el backend antes que el frontend es el orden normal de despliegue—, pero cuando una solicitud falla con un 400 o un 404, el error lleva la desviación como su causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Así, una columna renombrada se interpreta como "tu SDK está desactualizado, regeneralo" en lugar de como un campo que tus propios tipos insisten que existe. A una solicitud que tiene éxito nunca se le notifica.

Cubre **únicamente colecciones**. La edición de un hook o una función no cambia el contrato de un cliente y no debe invalidar todos los SDK generados.

### Quién está llamando

Dos señales de identificación adicionales, ninguna de las cuales condiciona nada por sí sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con el `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un trabajo de CI que compare su SDK generado contra un proyecto activo no necesita credenciales, y tampoco un cliente que pregunte con qué runtime se está comunicando.
- **`User-Agent: rebase-cli/<version>`** se incluye en cada solicitud a `rebase cloud`. El formato de red (wire format) del plano de control va por delante de lo que se publica en npm, por lo que necesita poder responder a un cliente antiguo con `CLI_TOO_OLD` y la versión mínima, lo cual solo puede hacer ante un emisor que declare quién es.

### 6 — Identificadores derivados de base de datos

Cada nombre que este framework calcula por sí mismo en lugar de recibirlo: una columna de clave foránea, una restricción de clave foránea, una tabla de unión (junction table) y sus dos columnas de clave, un tipo enum, el nombre de una directiva de seguridad (policy), la columna `snake_case` de una propiedad en `camelCase`.

> **Un identificador derivado queda congelado en el momento en que una versión lo emite.**

No "congelado hasta la siguiente versión mayor" — congelado. El razonamiento es diferente al de los otros cinco contratos, y más estricto. Aquellos están versionados, por lo que una discrepancia puede ser *detectada* y rechazada. Este no puede: el nombre se escribe en la base de datos de un cliente el día que despliega, y no hay un sello de versión en una columna. Cada base de datos aprovisionada por cada versión que se haya lanzado lleva lo que haya derivado, y ningún código en este repositorio puede acceder y renombrarlos a todos.

0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a singularizar correctamente (`categorie_id` → `category_id`, `addres_id` → `address_id`), lo cual es indudablemente una mejor derivación, y rompió todas las bases de datos antiguas que tenían un plural irregular. La verificación de arranque (boot-ensure) migró la columna, por lo que los datos sobrevivieron; el `schema.generated.ts` versionado en el proyecto no lo hizo, y el arranque falló al buscar una columna que sí existía. Tres commits, una nueva prueba de costura (seam test) y una entrada permanente en las notas de actualización, a cambio de un nombre de columna con mejor aspecto por el que nadie había preguntado.

**Si una derivación es genuinamente errónea**, cambia para las colecciones creadas *posteriormente*, detrás de una estrategia de nomenclatura registrada en el proyecto; nunca de forma retroactiva y nunca como un efecto secundario de mejorar la función subyacente.

**La única anulación legítima** es un cambio que hace que el código concuerde con un nombre que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de identificadores: Postgres recorta silenciosamente un identificador a 63 bytes, por lo que un nombre de restricción derivado más largo nunca fue el nombre en el catálogo; la derivación describía un objeto que no existía bajo esa grafía, y boot-ensure reemitía `ADD CONSTRAINT` en cada arranque porque su comparación nunca coincidía. Truncar al construir cambia lo que este repositorio *deriva* y no cambia nada de lo que *contiene* cualquier base de datos desplegada. Esa es la prueba que se debe aplicar: no "si el nuevo nombre es mejor", sino "si alguna base de datos existente tiene que cambiar".

El otro caso en el que un nombre puede cambiar es un conjunto de nombres que nunca podrían coexistir. Una regla que abarcaba varias operaciones en una tabla de 42 bytes o más derivaba `<table>_default_admin_write_insert`, `_update` y `_delete`, y las tres se recortaban a los mismos 63 bytes. Postgres guardó una sola política, DELETE, y rechazó cada INSERT y UPDATE administrativo. Solo cuando los nombres de una regla colisionan de esta forma se derivan priorizando el sufijo, como `<head>_<hash8>_<op>`. Cada nombre que funciona hoy conserva su grafía. El siguiente arranque o push elimina la única política truncada y crea una política para cada operación.

Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder migrarlo: `legacyForeignKeyName` existe para ser detectado, nunca para ser generado, y la línea base también fija esas detecciones. Eliminar una deshace silenciosamente la migración de cada base de datos que todavía conserve esa grafía.

**La compuerta.** `tooling/scripts/derived-names.mts` ejecuta un fixture de estrés de nomenclatura —plurales irregulares, una terminación en `ss`, un acrónimo, una unión desde un slug en plural, anulaciones explícitas, un slug lo suficientemente largo como para ser truncado— a través de ambos generadores de DDL de esquemas, y muestra cada identificador que cualquiera de los dos nombre:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura del contrato, mostrando la grafía anterior y la nueva una al lado de la otra. Un cambio puramente aditivo también falla, pero con un mensaje de "regenerate", de modo que la línea base no pueda desviarse inadvertidamente.

También fija que `rebase db push` y la verificación de arranque (boot-ensure) del runtime administrado deriven los *mismos* nombres, lo cual es un segundo contrato oculto dentro del primero: compilan las mismas colecciones a través de código diferente, y un proyecto que se envía con push una vez y se arranca después no debe terminar con dos esquemas.

## Qué *no* está congelado

Dicho llanamente, para que nadie deduzca una promesa que nunca se hizo:

- La API de TypeScript creada: configuración de colecciones, opciones de `initializeRebaseBackend`, propiedades de administración, nombres de métodos del SDK. Los cambios importantes (breaking changes) llegan en versiones menores y se anuncian en el registro de cambios.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de consumidores.
- Cualquier elemento bajo el `src/` de un paquete que no se reexporte desde su archivo barrel. `packages/client/src/index.ts` incluye una nota explicando que su lista de exportación se selecciona minuciosamente precisamente para que una exportación interna no se haga pública por accidente.
- El esquema de base de datos de *tus* colecciones. Eso es tuyo; Rebase solo es propietario del esquema `rebase` (y, en una base de datos aprovisionada antes de 0.13, del antiguo esquema `auth` hasta que el arranque lo retire).

## Las compuertas que garantizan esto

Nada de lo anterior es una simple convención: cada punto tiene una prueba que falla cuando se rompe:

| Compuerta | Lo que fija |
|---|---|
| `pnpm verify:corpus` | cada forma de bundle que se haya publicado, arrancada en el runtime de hoy. Los fixtures en `tests/fixtures/bundles/` están **creados a mano y congelados**; un fixture que el constructor regenera se mueve cada vez que el constructor se mueve |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, arrancado y consultado tal como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguos (`schema-snapshots/`) enfrentados al runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto generado (scaffolded) instalado desde **archivos tarball reales**, no enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | la ruta del usuario final: registro → inicio de sesión → lecturas con alcance RLS → refresco → almacenamiento → tiempo real |
| `pnpm check:derived-names` | cada columna, restricción, unión, enum y nombre de directiva que el framework deriva, y que el arranque y `db push` los deriven de forma idéntica |
| `pnpm rls:check` | las directivas (policies) del esquema generado |
| `pnpm check:api-surface` | cada exportación y sus miembros de los cinco paquetes que suministra la imagen —`@rebasepro/server`, `types`, `client`, `common`, `utils`— además del punto de entrada `@rebasepro/server/functions`, contra las seis secciones de `contracts/server.api.txt`. Estos son los paquetes a los que `infra/docker/entrypoint.mjs` crea enlaces simbólicos sobre las copias propias de un bundle desplegado, por lo que eliminar una exportación de uno de ellos no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las pruebas de las propias compuertas, sobre fixtures —cuarenta y siete archivos, entre ellos `check:api-surface` y la comprobación de incremento de versión más abajo—, de modo que una compuerta que deje de detectar lo que protege falle aquí. `check:api-surface` pasó toda su existencia sin poder detectar si un miembro desaparecía de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento con el que se publica una versión coincida con lo que la versión hizo en las líneas base anteriores; ejecutado por `publish.yml` antes de estampar el registro de cambios |
| saas CI | el plano de control compilado contra el `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registra un fixture de bundle y una instantánea de esquema una vez por versión.** El valor de ambos corpus reside enteramente en cuán atrás en el tiempo llega el más antiguo, y ninguno puede completarse retroactivamente después de los hechos.

### Aún sin compuerta de verificación

La tabla anterior es lo que se garantiza. Estas son las partes de la política que todavía nada garantiza, enumeradas para que nadie deduzca una promesa en ellas:

- **Sin periodo de obsolescencia ni soporte.** Mientras Rebase esté en `0.x`, no existe una regla escrita sobre cuánto tiempo sobrevive una exportación obsoleta antes de su eliminación, o durante cuánto tiempo recibe correcciones una versión menor anterior. Las correcciones de seguridad solo se aplican a la versión menor más reciente.
- **El formato de red HTTP no tiene compuerta.** Ningún script `check:*` compara las formas de petición y respuesta contra una línea base como `check:api-surface` compara las exportaciones; un cambio en la estructura de respuesta solo es detectado por una suite e2e que dé la casualidad de que la lea.
- **Los flags de la CLI no tienen línea base de compatibilidad.** El verificador de documentación falla cuando desaparece un flag utilizado por las skills, los ejemplos o el sitio de marketing; nada detecta si desaparece cualquier otro flag o si un flag cambia de significado.
- **Un lanzamiento en CI no registra ningún corpus.** El flujo de trabajo de publicación no registra ningún fixture de bundle ni ninguna instantánea de esquema; solo lo intenta el script de lanzamiento local, y advierte en lugar de detenerse cuando no puede hacerlo. De la 0.18 a la 0.21 no tienen ninguna instantánea de proyecto registrada.
- **La superficie de exportación es una compuerta, no un contrato.** Si las exportaciones públicas de los paquetes provistos por el runtime se convierten en un séptimo contrato numerado —declarado como la línea base de `check:api-surface`, compatible de forma aditiva dentro de una versión mayor del contrato— es una decisión abierta.

## Modificar un contrato

1. Decide cuál de los seis es. La mayoría de los cambios no son ninguno de ellos, pero "ninguno de los seis" no significa "libre de controversia". Eliminar o renombrar una exportación de `@rebasepro/server`, o un miembro de ella, no pertenece a ninguno de los seis y es el cambio individual más peligroso en el repositorio, porque el código que rompe ya está compilado y no se recompilará. `pnpm check:api-surface` es lo que defiende esa línea; si se convierte en un séptimo contrato numerado es una decisión abierta (consulta *Aún sin compuerta de verificación*, más arriba).
2. Añade primero un fixture o una instantánea para la estructura **antigua** y comprueba que pase.
3. Realiza el cambio e incrementa la constante.
4. Confirma que el fixture antiguo todavía pasa, o que ahora falla *con el mensaje que un usuario necesitaría*. Ambos son resultados válidos; el silencio no lo es.
5. Para el contrato 3, planifica la recompilación de cada bundle desplegado antes de fusionar.
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay una constante para incrementar ni una versión sobre la cual rechazar, porque una columna no lleva sello de versión. El paso que los reemplaza es decidir no hacer el cambio; consulta la sección anterior para ver cómo es la alternativa.

## Relacionado

- [Actualizaciones](/docs/upgrading/) — lo que realmente dejó de funcionar, versión por versión
- [Registro de cambios](/docs/changelog/) — cada cambio, incluidos los que no rompieron nada
- [Runtime y Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está compilado un proyecto desplegado
