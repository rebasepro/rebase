---
sourceHash: ec13f8f9c203aae2
slug: es/docs/compatibility
title: Compatibilidad
description: "Lo que Rebase promete entre versiones y lo que no: los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor."
---

Lo que Rebase promete entre versiones y lo que no.

Este es el documento que debe leer antes de cambiar cualquier cosa de la que ya dependa un proyecto desplegado o un tenant activo de Rebase Cloud. También es la respuesta honesta a «si construyo sobre Rebase hoy, ¿qué se romperá bajo mis pies más adelante?».

## Qué significa «beta» aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para decir «cualquier cosa puede romperse», lo cual no le da al lector información útil con la que planificar. Por eso, esta es la línea que este proyecto realmente traza:

> **La API contra la que escribe puede cambiar en una versión menor (minor), con una entrada en el changelog. Sus datos no pueden corromperse en silencio.**

La primera mitad es el comportamiento habitual de `0.x` y se describe a continuación. La segunda mitad es la parte que vale la pena comprobar, porque es una afirmación sobre mecanismos y no sobre intenciones: cada uno de los contratos versionados de la siguiente sección está grabado en un artefacto o en una base de datos, se comprueba en el arranque o en la admisión, y cada uno **falla de forma ruidosa y específica** en lugar de degradarse. Un push de esquema que eliminaría una columna es rechazado por un gate destructivo (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la propia ruta de actualización es una prueba: `upgrade-e2e.test.ts` restaura las bases de datos tal como las dejaron las versiones anteriores, ejecuta la ruta de migración actual sobre cada una y afirma que las filas sobreviven, no simplemente que el arranque lo hizo.

Lo que sí significa beta: todavía faltan funciones, algunos subsistemas son más recientes que otros, y la naturaleza de una aspereza es que algo falta o resulta incómodo, no que corrompa algo en silencio. Cuáles subsistemas son cuáles se publica y fecha en lugar de dejarse para ser descubierto: la tabla a continuación es esa publicación.

## Madurez por subsistema

**Última revisión: 14 de septiembre de 2026, para la versión 0.21.0.** Léalo de nuevo en cada versión menor; una calificación que no ha cambiado en tres lanzamientos está asentada u olvidada, y esta nota está aquí para que se verifique la diferencia.

Las tres calificaciones significan:

- **Stable** (Estable) — la forma está asentada y cubierta por un gate en CI. Todavía puede incorporar funciones; no será rediseñado debajo de usted dentro de 0.x, y un cambio que le rompiera la compatibilidad se anunciará en el changelog.
- **Beta** — funciona y se usa en producción, y se sabe que algo en él es tosco o áspero: un límite que se puede alcanzar, un caso límite incómodo, una decisión de diseño aún no tomada. La parte áspera se especifica en las notas, porque «beta» por sí solo no le dice nada sobre lo que planificar.
- **Experimental** — publicado para que pueda usarse y reportarse. Espere encontrarse con las partes que nadie ha tocado aún.

| Subsistema | Calificación | En qué se basa la calificación |
|---|---|---|
| REST API + SDK generado | Stable | El contrato de transmisión (wire contract) está versionado y protegido por gates; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con alcance RLS → refresco → almacenamiento → tiempo real de extremo a extremo |
| Auth — correo electrónico/contraseña, OAuth, OIDC, magic link, código de un solo uso | Stable | Se incluyen doce proveedores OAuth. El esquema de autenticación es un contrato versionado, grabado y verificado en el arranque |
| Auth — MFA (TOTP) | Beta | El registro, la verificación y la recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no existe una interfaz de administración para restablecer el factor de un usuario bloqueado |
| Row-level security | Stable | La pieza angular del producto. `pnpm rls:check` audita una base de datos en vivo contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Storage | Stable | Local, S3 y GCS. Denegación por defecto (default-deny) en producción desde 0.17.0, y el andamiaje (scaffold) incluye un hook de autorización |
| Realtime | **Beta** | Las suscripciones solo coinciden por ruta de colección, por lo que N suscriptores en una colección cuestan N recuperaciones (refetches) con alcance RLS por escritura. Eso limita un despliegue a unos pocos cientos de suscriptores concurrentes. Correcto a cualquier escala; costoso a partir de esa |
| Búsqueda vectorial (pgvector) | Beta | Cada columna vectorial obtiene un índice HNSW para distancia coseno por defecto, ajustable por propiedad mediante `VectorIndexConfig` (método, distancias, parámetros de construcción) o desactivable, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2.000 dimensiones, por lo que esas se dejan sin indexar y realizan escaneo |
| Sincronización offline | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y los defectos de pérdida de datos encontrados en la auditoría de julio están solucionados. El modelo de resolución de conflictos es el último que escribe gana (last-write-wins) sin fusión por campo |
| Historial de entidades | Stable | Basado en instantáneas (snapshots), protegido por su propia suite de pruebas |
| Funciones y crons | Stable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| Servidor MCP + agent skills | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cuarenta y dos herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan destinos no locales a menos que se habilite explícitamente. Desde 0.21, el servidor también puede montar un endpoint `/mcp` remoto — OAuth 2.1, seis herramientas de datos, cada llamada bajo el propio RLS del usuario autenticado — desactivado a menos que `REBASE_MCP_ENABLED=true`, y solo para Postgres |
| Studio (SQL, esquema, RLS, explorador de API) | Beta | Utilizado a diario en proyectos reales. La creación de ramas (branching) está presente en el paquete OSS y deliberadamente no está expuesta en Rebase Cloud, porque migrar un despliegue en ejecución a una rama aún no tiene un flujo definido |
| CMS + panel de administración | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de cuadrícula (grid)** — sin `role`, sin `aria-rowindex`, con `tabIndex` eliminado —, por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por configuración regional (locale), sin texto enriquecido por bloques |
| Base de datos de desarrollo gestionada PGlite | Beta | `rebase dev` sin configuración y sin Docker. Una sesión a la vez, por lo que las solicitudes se serializan y la concurrencia no se puede reproducir en ella; los comandos respaldados por Atlas (`db push`, `generate`, `migrate`) no funcionan allí y lo advierten |
| Helm chart | Beta | Renderiza la topología de procesos separados y se publica en el registro OCI con cada versión. El valor predeterminado sigue siendo un solo contenedor |
| `@rebasepro/server-mongo` | **Experimental** | Un driver funcional con tiempo real por change streams e historial por snapshots. **Sin seguridad a nivel de fila (RLS)** — todo el modelo de aislamiento anterior no le aplica — y sin relaciones. Los change streams requieren un replica set: en un `mongod` independiente nada los reemplaza, por lo que una suscripción ve las escrituras realizadas a través de ese proceso de Rebase y se pierde todas las demás. Sin MFA: el registro responde 501 y las comprobaciones responden «no factor», por lo que el inicio de sesión nunca solicita uno. La agregación de administración no puede apuntar a una colección (lee el nombre de una etapa `$from` que MongoDB no tiene), por lo que no devuelve nada |
| `@rebasepro/firebase` | Experimental | Ejecuta el panel de administración y el SDK contra Firestore. Sin RLS, sin superficie SQL; el conjunto de características de Postgres no se traslada. El driver de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno lee todas las filas que sus filtros simples permiten |
| Rebase Cloud | **Beta privada** | En producción, ejecutando tenants reales, habilitado por lotes. No es de autoservicio (self-serve) |

Dos entradas anteriores son el coste honesto de publicar esta tabla: las recuperaciones de realtime y la accesibilidad de la tabla de datos son defectos abiertos, no elementos de la hoja de ruta, y ambos están listados en lugar de dejarse para que el lector los descubra.

Esta tabla es lo que existe. Lo que aún no existe está en el [roadmap](https://rebase.pro/roadmap), con una entrada por issue de GitHub, y con el subconjunto requerido para la versión 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está redactada para ser válida para cada lanzamiento 0.x en lugar de solo para uno, de modo que no quede desactualizada con cada versión. **Los cambios que rompen la compatibilidad (breaking changes) en la API de TypeScript creada siguen estando permitidos en una versión menor**, y el changelog es donde se anuncian. Lo que *no* está permitido que se rompa silenciosamente es el conjunto de contratos versionados a continuación: cada uno está grabado en un artefacto o en una base de datos, cada uno se comprueba en el arranque o en la admisión, y cada uno falla **de forma ruidosa y específica** en lugar de degradarse.

Esa distinción es toda la promesa. Una exportación renombrada le cuesta un error de compilación y cinco minutos. Un bundle que arranca contra el runtime incorrecto y sirve datos sutilmente erróneos le cuesta un incidente, y los contratos existen para que la segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Cualquier cosa no listada aquí es un detalle de implementación del que la plataforma no depende.

## Los contratos versionados

Los valores a continuación se leen del código fuente; considere las referencias a archivos como la verdad y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Verificado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | Rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto indica qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatible** — el runtime nuevo lee bundles antiguos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mismo archivo | mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **hacia adelante únicamente** — el runtime nuevo migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | informativo — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores de base de datos derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango semver, leído como `engines` en un `package.json`: qué versiones de runtime acepta este proyecto. Nombrado `rebase` en lugar de `runtime` deliberadamente, porque `runtime` ya significa *quién posee el proceso* (`managed` | `custom`) en una aplicación.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 2)

La distribución en disco de un bundle compilado. Un runtime acepta cualquier bundle cuyo formato sea **menor o igual** al suyo propio, que es lo que permite al nivel administrado (managed) mover un tenant a una nueva imagen sin que nadie tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio, `entry.admin` para un admin integrado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin` eliminado. El formato 1 todavía se lee, a través de `upgradeLegacyManifest`.

**Increméntelo cuando** el diseño cambie de tal manera que un runtime anterior interpretaría erróneamente un bundle más nuevo. El incremento es lo que convierte un «arranca y no sirve nada» en un rechazo a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 1)

La versión mayor del contrato bundle↔runtime. Distinta de la versión del paquete `@rebasepro/server`, que puede lanzar cualquier cantidad de versiones menores y parches mientras esta permanece inmutable.

**Lea esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle orientado al contrato *N* se ejecuta **únicamente** en un runtime que implementa *N*

por lo que incrementarlo invalida **cada bundle jamás compilado**, todos a la vez, hasta que cada uno sea recompilado. Esa es la severidad prevista — es la palanca de «nada antiguo puede ejecutarse aquí» —, pero significa que un incremento es una migración de toda la flota, no una simple nota de lanzamiento. Para el nivel administrado, debe coordinarse con una recompilación del bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos, requiere `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Grabado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se niega a iniciar** contra una base de datos migrada por una versión del framework más reciente, en lugar de operar sobre una estructura que no comprende; durante un despliegue gradual (rolling deploy), esa es la diferencia entre que la mitad de la flota falle con error y que la mitad de la flota corrompa datos.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una base de datos antigua. Tenga en cuenta que este bloque de migración está deliberadamente envuelto en un `try/catch` y registra logs en lugar de lanzar excepciones —un arranque defectuoso es preferible a un bucle de reinicios (crash loop)—, por lo que **«arrancó» no demuestra nada**. Cada aserción en la suite de actualización lee el catálogo o los datos en su lugar.

**Increméntelo cuando** un runtime anterior no deba saltarse una migración. No lo incremente para una columna aditiva y retrocompatible; hay un ejemplo práctico de ese criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de las definiciones de colección compiladas, emitido en el manifiesto del bundle y replicado por un SDK generado en el encabezado `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda decir «esta aplicación se compiló contra un esquema más antiguo» en lugar de fallar misteriosamente en la primera solicitud.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; páselo al cliente para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee ese encabezado en cada solicitud de datos. La desviación (drift) nunca rechaza una llamada: un SDK con una versión de esquema por detrás suele ser compatible, y desplegar el backend antes que el frontend es el orden de despliegue habitual; pero cuando una solicitud falla con un 400 o un 404, el error incluye la desviación como su causa:

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

De este modo, una columna renombrada se interpreta como «su SDK está obsoleto, regenérelo» en lugar de un campo que sus propios tipos insisten en que existe. A una solicitud que tiene éxito nunca se le notifica.

Cubre **únicamente colecciones**. La edición de un hook o una función no modifica el contrato del cliente y no debe invalidar todos los SDK generados.

### Quién está llamando

Dos señales de identificación adicionales, ninguna de las cuales actúa como gate por sí sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con la `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un trabajo de CI que compara su SDK generado contra un proyecto en vivo no necesita credenciales, ni tampoco un cliente que pregunte con qué runtime se está comunicando.
- **`User-Agent: rebase-cli/<version>`** se incluye en cada solicitud de `rebase cloud`. El formato de comunicación (wire format) del plano de control avanza más rápido que lo publicado en npm, por lo que necesita poder responder a un cliente antiguo con `CLI_TOO_OLD` y la versión mínima, algo que solo puede hacer ante una llamada que declare quién es.

### 6 — Identificadores de base de datos derivados

Cada nombre que este framework calcula por sí mismo en lugar de recibirlo explícitamente: una columna de clave foránea, una restricción de clave foránea, una tabla de unión (junction table) y sus dos columnas de clave, un tipo enum, un nombre de política, la columna `snake_case` de una propiedad en `camelCase`.

> **Un identificador derivado queda congelado en el momento en que una versión lo emite.**

No «congelado hasta la próxima versión mayor»: congelado. El razonamiento es diferente al de los otros cinco contratos y más contundente. Aquellos están versionados, por lo que una discrepancia puede ser *detectada* y rechazada. Este no: el nombre se escribe en la base de datos de un cliente el día en que despliega, y no hay ninguna marca de versión en una columna. Cada base de datos aprovisionada por cada versión que se haya lanzado lleva lo que haya derivado, y ningún código en este repositorio puede intervenir y renombrarlos a todos.

La versión 0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a singularizar correctamente (`categorie_id` → `category_id`, `addres_id` → `address_id`), lo cual es sin duda una derivación mejor, y rompió todas las bases de datos antiguas que tenían un plural irregular. La verificación en arranque migró la columna, por lo que los datos sobrevivieron; el archivo `schema.generated.ts` versionado del proyecto no lo hizo, y el arranque falló ante una columna que sí existía. Tres commits, una nueva prueba de límites (seam test) y una entrada permanente en las notas de actualización, a cambio de un nombre de columna más legible que nadie había pedido.

**Si una derivación es genuinamente errónea**, se cambia para las colecciones creadas *posteriormente*, bajo una estrategia de nomenclatura registrada en el proyecto; nunca de forma retroactiva, y nunca como un efecto secundario de mejorar la función subyacente.

**La única excepción legítima** es un cambio que haga que el código coincida con un nombre que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de identificadores: Postgres recorta silenciosamente un identificador a 63 bytes, por lo que un nombre de restricción derivado más largo nunca fue el nombre en el catálogo; la derivación estaba describiendo un objeto que no existía bajo esa grafía, y la verificación en arranque volvía a emitir `ADD CONSTRAINT` en cada arranque porque su comparación nunca coincidía. Truncar en la construcción cambia lo que este repositorio *deriva* y no cambia nada sobre lo que cualquier base de datos desplegada *contiene*. Esa es la prueba a aplicar: no «¿es mejor el nuevo nombre?», sino «¿debe cambiar alguna base de datos existente?».
Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder migrarlo: `legacyForeignKeyName` existe para ser detectado, nunca para ser generado, y la línea base también fija esas detecciones. Eliminar una revierte silenciosamente la migración de cada base de datos que aún conserve esa grafía.

**El gate.** `tooling/scripts/derived-names.mts` ejecuta un fixture de estrés de nombres (plurales irregulares, una terminación en `ss`, un acrónimo, una unión a partir de un slug en plural, anulaciones explícitas, un slug lo suficientemente largo como para truncarse) a través de ambos productores de DDL de esquema, y renderiza cada identificador que cualquiera de los dos genera:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura de contrato, mostrando la grafía antigua y la nueva una al lado de la otra. Un cambio puramente aditivo también falla, pero con la indicación «regenerar», de modo que la línea base no pueda desviarse inadvertidamente.

También asegura que `rebase db push` y la verificación de arranque del runtime administrado deriven los *mismos* nombres, lo cual es un segundo contrato oculto dentro del primero: compilan las mismas colecciones a través de código diferente, y un proyecto subido una vez y arrancado más tarde no debe terminar con dos esquemas.

## Qué *no* está congelado

Dicho claramente, para que nadie deduzca una promesa que nunca se hizo:

- La API de TypeScript creada: configuración de colecciones, opciones de `initializeRebaseBackend`, propiedades de administración, nombres de métodos del SDK. Los breaking changes se incorporan en versiones menores y se anuncian en el changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de consumidores.
- Cualquier elemento bajo el `src/` de un paquete que no esté reexportado desde su archivo raíz (barrel). `packages/client/src/index.ts` incluye una nota que explica que su lista de exportaciones está seleccionada minuciosamente para que una exportación interna no se vuelva pública por accidente.
- El esquema de base de datos de *sus* colecciones. Eso es de su propiedad; Rebase solo es dueño de los esquemas `rebase` y `auth`.

## Los gates que sostienen esto

Nada de lo anterior es una simple convención: cada elemento tiene una prueba que falla cuando se rompe:

| Gate | Lo que asegura |
|---|---|
| `pnpm verify:corpus` | cada formato de bundle jamás lanzado, arrancado en el runtime de hoy. Los fixtures en `tests/fixtures/bundles/` están **creados a mano y congelados**; un fixture que el constructor regenera cambia cada vez que el constructor cambia |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, arrancado y consultado tal como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguas (`schema-snapshots/`) procesados por el runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto generado desde plantilla e instalado a partir de **tarballs reales**, no enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | el flujo del usuario final: registro → inicio de sesión → lecturas con alcance RLS → refresco → almacenamiento → tiempo real |
| `pnpm check:derived-names` | cada nombre de columna, restricción, tabla de unión, enum y política que el framework deriva, y que el arranque y `db push` los deriven de forma idéntica |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación, y sus miembros, de los cinco paquetes que suministra la imagen (`@rebasepro/server`, `types`, `client`, `common`, `utils`), más el punto de entrada `@rebasepro/server/functions`, contra las seis secciones de `contracts/server.api.txt`. Estos son los paquetes que `infra/docker/entrypoint.mjs` enlaza simbólicamente sobre las copias del propio bundle desplegado, por lo que eliminar una exportación de uno no es un error de compilación para nadie: es un fallo de arranque en toda la flota durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las propias pruebas de los gates sobre fixtures (once archivos, entre ellos `check:api-surface` y la comprobación de incremento de versión más abajo), para que un gate que deje de detectar lo que protege falle aquí. `check:api-surface` pasó toda su vida sin poder detectar la desaparición de un miembro de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento con el que se publica una versión coincida con lo que el lanzamiento le hizo a las líneas base anteriores; ejecutado por `publish.yml` antes de estampar el changelog |
| saas CI | el plano de control compilado contra la rama `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registre un fixture de bundle y un snapshot de esquema una vez por versión.** El valor de ambos corpus reside enteramente en cuán atrás en el tiempo llega el más antiguo, y ninguno puede completarse retroactivamente a posteriori.

### Aún no cubierto por gates

La tabla anterior es lo que se garantiza. Estas son las partes de la política que nada garantiza todavía, listadas para que nadie suponga una promesa donde no la hay:

- **Sin período de desuso (deprecation) ni ventana de soporte.** Mientras Rebase esté en `0.x`, no existe una regla escrita sobre cuánto tiempo sobrevive una exportación obsoleta antes de su eliminación, o cuánto tiempo recibe correcciones una versión menor anterior. Las correcciones de seguridad solo se aplican en la versión menor más reciente.
- **El formato de transmisión HTTP no tiene gate.** Ningún script `check:*` compara las formas de petición y respuesta contra una línea base como lo hace `check:api-surface` con las exportaciones; un cambio en la estructura de una respuesta solo es detectado por una suite e2e que por casualidad la lea.
- **Los flags de la CLI no tienen una línea base de compatibilidad.** El verificador de documentación falla cuando un flag utilizado por las skills, los ejemplos o el sitio de marketing desaparece; nada detecta si desaparece cualquier otro flag o si un flag cambia de significado.
- **Un lanzamiento en CI no registra ningún corpus.** El flujo de trabajo de publicación no registra ningún fixture de bundle ni ningún snapshot de esquema; solo el script de lanzamiento local lo intenta, y advierte en lugar de detenerse cuando no puede. De la versión 0.18 a la 0.21 no hay ningún snapshot de proyecto registrado.
- **La superficie de exportación es un gate, no un contrato.** Que las exportaciones públicas de los paquetes proporcionados por el runtime se conviertan en un séptimo contrato numerado —declarado como la línea base de `check:api-surface`, compatible de forma aditiva dentro de una versión mayor de contrato— es una decisión abierta.

## Cómo cambiar un contrato

1. Decida cuál de los seis es. La mayoría de los cambios no son ninguno de ellos, pero «ninguno de los seis» no significa «exento de controversia». Eliminar o renombrar una exportación de `@rebasepro/server`, o un miembro de ella, no pertenece a ninguno de los seis y es el cambio más peligroso de todo el repositorio, porque el código que rompe ya está compilado y no se recompilará. `pnpm check:api-surface` es lo que mantiene esa línea; si esto se convierte en un séptimo contrato numerado es una decisión abierta (consulte *Aún no cubierto por gates*, más arriba).
2. Agregue primero un fixture o snapshot para la forma **antigua** y compruebe que pase la prueba.
3. Realice el cambio e incremente la constante.
4. Confirme que el fixture antiguo siga pasando, o que ahora falle *con el mensaje que un usuario necesitaría*. Ambos son resultados válidos; el silencio no lo es.
5. Para el contrato 3, planifique la recompilación de cada bundle desplegado antes de fusionar (merge).
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay constante que incrementar ni versión ante la cual negarse, porque una columna no lleva una marca de versión. El paso que los reemplaza es decidir no realizar el cambio; consulte la sección anterior para ver cómo es la alternativa.

## Relacionado

- [Actualización](/docs/upgrading/) — qué se rompió realmente, versión por versión
- [Changelog](/docs/changelog/) — cada cambio, incluidos los que no rompieron nada
- [Runtime y bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está compilado un proyecto desplegado
