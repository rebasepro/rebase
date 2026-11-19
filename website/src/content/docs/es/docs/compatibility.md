---
sourceHash: 574dcb0aad3f6719
slug: es/docs/compatibility
title: Compatibilidad
description: Lo que Rebase promete entre versiones y lo que no — los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor.
---

Lo que Rebase promete entre versiones y lo que no.

Este es el documento que se debe leer antes de cambiar cualquier cosa de la que ya
dependa un proyecto desplegado o un tenant activo de Rebase Cloud. También es la
respuesta honesta a "¿si construyo sobre Rebase hoy, qué dejará de funcionar más adelante?".

## Qué significa "beta" aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para dar
a entender que "cualquier cosa puede romperse", lo cual no le dice nada al lector
con lo que pueda planificar; así que esta es la línea que este proyecto realmente traza:

> **La API contra la que escribes puede cambiar en una versión menor, con una entrada en el registro de cambios (changelog).
> Tus datos no pueden romperse en silencio.**

La primera mitad es el comportamiento habitual de `0.x` y se describe más abajo.
La segunda mitad es la parte que vale la pena revisar, porque es una afirmación sobre
mecanismos más que sobre intenciones: los contratos versionados de la siguiente
sección están estampados en un artefacto o en una base de datos, cada uno se comprueba
en el arranque o en la ingesta, y cada uno **falla de forma ruidosa y específica**
en lugar de degradarse. Una aplicación de esquema (push) que eliminaría una columna
es rechazada por una barrera destructiva
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la ruta de actualización
en sí es una prueba: `upgrade-e2e.test.ts` restaura las bases de datos tal como las
dejaron las versiones anteriores, ejecuta la ruta de migración actual sobre cada una
de ellas y valida que las filas sobrevivan, no solo que el arranque haya tenido éxito.

Lo que beta sí significa: aún faltan características, algunos subsistemas son más
recientes que otros, y la forma de una aspereza o limitación es que algo esté ausente
o sea incómodo, no que corrompa algo en silencio. Cuáles subsistemas son cuáles se
publica y fecha en lugar de dejarse para descubrir sobre la marcha; la siguiente
tabla es esa publicación.

## Nivel de preparación por subsistema

**Última revisión: 14 de septiembre de 2026, frente a 0.21.0.** Vuelve a leerlo en
cada versión menor; una clasificación que no se haya movido en tres versiones está
consolidada o se ha olvidado, y esta nota está aquí para que se compruebe la diferencia.

Las tres clasificaciones significan:

- **Estable** — la estructura está consolidada y cubierta por una barrera (gate) en CI.
  Aún puede incorporar funciones; no se rediseñará por debajo de ti dentro de 0.x, y
  cualquier cambio que pudiera romper tu código se anunciará en el registro de cambios.
- **Beta** — funciona y se utiliza en producción, y se sabe que algo en ello es imperfecto
  o áspero: un límite que se puede alcanzar, un caso extremo incómodo, una decisión de diseño
  aún no tomada. La parte áspera se detalla en las notas, porque "beta" por sí solo no te dice
  nada con lo que puedas planificar.
- **Experimental** — se publica para que pueda usarse y reportarse. Es de esperar toparse
  con partes que nadie ha probado todavía.

| Subsistema | Clasificación | En qué se basa la clasificación |
|---|---|---|
| API REST + SDK generado | Estable | El contrato de red (wire contract) está versionado y protegido por barreras; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con alcance de RLS → refresco → almacenamiento → tiempo real de extremo a extremo |
| Autenticación — correo/contraseña, OAuth, OIDC, magic link, código de un solo uso | Estable | Se incluyen doce proveedores de OAuth. El esquema de autenticación es un contrato versionado, estampado y verificado en el arranque |
| Autenticación — MFA (TOTP) | Beta | El registro, la verificación y la recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no hay superficie de administración para restablecer el factor de un usuario bloqueado |
| Seguridad a nivel de fila (RLS) | Estable | La pieza angular del producto. `pnpm rls:check` audita una base de datos activa contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Almacenamiento | Estable | Local, S3 y GCS. Denegación por defecto (default-deny) en producción desde 0.17.0, y el scaffold incluye un hook de autorización |
| Tiempo real | **Beta** | Cada frame es una lectura bajo el propio alcance RLS de su suscriptor. Los sockets de un usuario en una lista comparten esa lectura, y una lista filtrada por una columna de la fila (`where owner == me`) solo se consulta cuando una escritura puede alcanzarla: 5.000 usuarios viendo cada uno sus propias filas cuestan **una** lectura por escritura, ~305 ms en entregarse (medido en `tooling/scripts/bench-realtime-fanout.mts`). El límite es una lista que solo RLS restringe: una lectura por usuario distinto por escritura, por lo que 5.000 usuarios en la misma lista sin filtrar son 5.000 lecturas y ~2,6 s para que termine el fan-out. Correcto a cualquier escala; filtra por la columna que lee la política para mantenerte en una sola lectura |
| Búsqueda vectorial (pgvector) | Beta | Cada columna vectorial obtiene un índice HNSW para distancia de coseno por defecto, configurable por columna mediante `col.vector({ dimensions, index })` (método, distancias, parámetros de compilación) o desactivable, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2.000 dimensiones, por lo que esas quedan sin indexar y realizan escaneo |
| Sincronización offline | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y los defectos de pérdida de datos encontrados en la auditoría de julio están corregidos. El modelo de conflicto es el último en escribir gana (last-write-wins) sin fusión por campo |
| Historial de entidades | Estable | Basado en snapshots, protegido por su propia suite |
| Funciones y tareas cron | Estable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| Servidor MCP + habilidades de agente | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cincuenta y tres herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan destinos no locales salvo activación explícita. Desde la versión 0.21 el servidor también puede montar un endpoint remoto `/mcp` — OAuth 2.1, diecisiete herramientas de datos (las cuatro para aplicaciones guardadas son experimentales), cada llamada bajo el propio RLS del usuario que inició sesión — desactivado a menos que `REBASE_MCP_ENABLED=true`, y solo para Postgres |
| Studio (SQL, esquema, RLS, explorador de API) | Beta | Utilizado a diario contra proyectos reales. La ramificación (branching) está presente en el paquete OSS y deliberadamente no está expuesta en Rebase Cloud, porque mover un despliegue en ejecución a una rama todavía no tiene un flujo definido |
| CMS + panel de administración | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de grid** — sin `role`, sin `aria-rowindex`, `tabIndex` eliminado — por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por configuración regional (per-locale), sin texto enriquecido en bloques |
| Base de datos de desarrollo administrada PGlite | Beta | `rebase dev` sin configuración y sin Docker. Una sesión a la vez, por lo que las solicitudes se serializan y la concurrencia no se puede reproducir contra ella; los comandos `db push` y `db generate` usan Ptah para planificar contra un segundo PGlite desechable; `db migrate` aplica el historial de migraciones; `db branch` no funciona allí y así lo indica |
| Chart de Helm | Beta | Renderiza la topología de procesos divididos y se publica en el registro OCI en cada versión. El valor predeterminado sigue siendo un único contenedor |
| `@rebasepro/firebase` | Experimental | Firestore como fuente que el panel de administración lee directamente, junto a las tablas del backend: `defineFirestoreCollection` en `frontend/src/cms`, pasado como `externalCollections`. Sin RLS, sin superficie SQL; el conjunto de características de Postgres no se traslada. El controlador de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno lee cada fila que sus filtros simples permitan |
| Rebase Cloud | **Beta privada** | En producción, ejecutando tenants reales, acceso habilitado por lotes. No es de autoservicio |

Dos entradas anteriores son el coste honesto de publicar esta tabla: el fan-out en
tiempo real para listas restringidas únicamente por RLS y la accesibilidad de la
tabla de datos son limitaciones abiertas, no elementos de la hoja de ruta, y ambas
se enumeran en lugar de dejarse para que el lector las descubra por su cuenta.

Esta tabla es lo que existe actualmente. Lo que aún no está se encuentra en la
[hoja de ruta (roadmap)](https://rebase.pro/roadmap), una entrada por cada issue de
GitHub, con el subconjunto requerido para la versión 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está escrita para ser válida en cada lanzamiento
de 0.x en lugar de solo en uno de ellos, de modo que no quede desactualizada en cada
corte de versión. **Los cambios que rompen la compatibilidad (breaking changes) en la
API de TypeScript creada por el autor todavía están permitidos en una versión menor**,
y el registro de cambios es donde se anuncian. Lo que
*no* está permitido que falle en silencio es el conjunto de contratos versionados
a continuación: cada uno está estampado en un artefacto o en una base de datos,
cada uno se comprueba en el arranque o en la ingesta, y cada uno falla **de forma
ruidosa y específica** en lugar de degradarse.

Esa distinción es toda la promesa. Una exportación renombrada te cuesta un error
de compilación y cinco minutos. Un bundle que arranca contra el runtime incorrecto
y sirve datos sutilmente erróneos te cuesta un incidente, y los contratos existen
para que esa segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Cualquier cosa que
no esté listada aquí es un detalle de implementación del que la plataforma no depende.

### Badges de versión y versiones canary

La documentación se publica desde `main`, por lo que una página puede describir
algo que ninguna versión estable tiene todavía. Un badge *Since* indica la primera
versión estable que lo incluye, y el texto a su lado describe qué hace la versión anterior.

Una canary es una compilación de `main` numerada según la versión hacia la que se
dirige: `0.25.0-canary.g<commit>` es `main` en ese commit, después de 0.24.0 y antes
de 0.25.0, y `rebase upgrade --to canary` instala la más reciente. Incluye todo lo
que había llegado a `main` cuando se compiló, por lo que un badge que indique su
versión se aplica a ti, y la nota sobre la versión anterior describe la versión
estable de la que provienes.

## Los contratos versionados

Los valores a continuación se leen desde el código fuente; considera las referencias
de archivo como la verdad y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Verificado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | Rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto declara qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatible hacia atrás** donde la estructura lo permite — el formato 3 rechaza los formatos 1 y 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | el mismo archivo | el mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **solo hacia adelante** — un runtime nuevo migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | informativo — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores derivados de base de datos | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango semver, leído como `engines` en un `package.json`: qué versiones del runtime
acepta este proyecto. Llamado `rebase` en lugar de `runtime` deliberadamente, porque
`runtime` ya significa *quién es el dueño del proceso* (`managed` | `custom`) en una aplicación.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 3)

La disposición en disco de un bundle compilado. Un runtime rechaza un bundle cuyo formato
sea más nuevo que el suyo, y lee uno más antiguo donde la estructura lo permita, que es
lo que permite al nivel administrado mover a un tenant a una imagen nueva sin que nadie
tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio,
  `entry.admin` para un panel de administración empaquetado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin`
  eliminado.
- **3** (0.31) — el esquema es `entry.tables`, el `backend/schema` compilado,
  junto a `entry.resources`, `entry.storage` y `entry.hooks`; `entry.config`,
  `entry.collections` y `entry.usersCollection` han desaparecido. **Los formatos 1 y 2
  son rechazados, no actualizados**: contienen `config/collections`, que un runtime
  que lee `backend/schema` no tiene cómo interpretar, y arrancar uno inspeccionaría
  la base de datos y serviría una API diferente. El rechazo indica
  `rebase migrate collections-to-tables`; migra el código fuente y recompila. Esta
  fue la única ruptura de compatibilidad hacia atrás, adoptada junto con el incremento
  del contrato de runtime que se describe a continuación.

**Increméntalo cuando** la disposición cambie de tal manera que un runtime más antiguo
malinterprete un bundle más nuevo. El incremento es lo que convierte un "arranca y no sirve nada"
en una negativa a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 2)

La versión principal (major) del contrato bundle↔runtime. Distinta de la versión del
paquete `@rebasepro/server`, que puede lanzar cualquier cantidad de versiones menores y
parches mientras esta permanece fija.

**Lee esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle dirigido al contrato *N* se ejecuta **únicamente** en un runtime que implementa *N*

por lo que incrementarlo invalida **cada bundle jamás compilado**, todos a la vez,
hasta que cada uno sea recompilado. Esa es la severidad prevista — es la palanca de
"nada antiguo puede ejecutarse aquí" —, pero significa que un incremento es una migración
en toda la flota, no una simple nota de la versión. Para el nivel administrado, debe
secuenciarse con una recompilación del bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos, lo que
requiere es `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto. La versión 0.31 lo
incrementó a 2, con el formato de bundle 3: el modelo de esquema cambió y el bundle
de cada tenant se recompila a partir del código fuente migrado.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Estampado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se niega
a iniciar** contra una base de datos migrada por una versión más nueva del framework,
en lugar de operar sobre una estructura que no comprende; durante un despliegue
progresivo (rolling deploy), esa es la diferencia entre que la mitad de la flota
devuelva errores y que la mitad de la flota se corrompa.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una base
de datos más antigua. Ten en cuenta que este bloque de migración está deliberadamente
envuelto en `try/catch` y registra logs en lugar de lanzar excepciones —un arranque
renqueante es mejor que un bucle de reinicios (crash loop)—, por lo que **"arrancó"
no demuestra nada**. Cada aserción en la suite de actualización lee el catálogo o
los datos en su lugar.

**Increméntalo cuando** una migración no deba ser omitida por un runtime más antiguo.
No lo incrementes para una columna aditiva y retrocompatible; hay un ejemplo práctico
de este criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de los descriptores de tabla compilados (`v2:…` desde 0.31), emitido en el
manifiesto del bundle y reflejado por un SDK generado en la cabecera `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda decir "esta aplicación
se compiló contra un esquema más antiguo" en lugar de fallar misteriosamente en la primera petición.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; pásalo al cliente para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee esa cabecera en cada petición de datos. El desajuste (drift) nunca
rechaza una llamada —un SDK con una versión de esquema por detrás suele ser compatible,
y desplegar el backend antes que el frontend es el orden normal de despliegue—, pero
cuando una petición falla con un error 400 o 404, el error lleva el desajuste como su causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

De este modo, una columna renombrada se interpreta como "tu SDK está desactualizado,
vuelve a generarlo" en lugar de como un campo que tus propios tipos insisten que
existe. A una petición exitosa nunca se le notifica.

Cubre **únicamente tablas** —sus descriptores compilados, en los que un hook es un
indicador de presencia. El código de un hook o la edición de una función no cambia
el contrato del cliente y no debe invalidar cada SDK generado. Debido a que la versión
0.31 trasladó el hash de colecciones a descriptores, cada base de datos estampada
con `v1:` reporta el cambio una vez, con el reestampado (arrancar el propietario
del esquema o `rebase db push`), y cada SDK generado se detecta como desactualizado una vez.

### Quién está llamando

Dos señales de identificación adicionales, ninguna de las cuales bloquea nada por sí sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con el
  `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un trabajo
  de CI que compare su SDK generado contra un proyecto en vivo no necesita
  credenciales, y tampoco las necesita un cliente que pregunte con qué runtime se está comunicando.
- **`User-Agent: rebase-cli/<version>`** se incluye en cada petición a `rebase cloud`.
  El formato de red del plano de control avanza más rápido que lo publicado en npm,
  por lo que necesita ser capaz de responder a un cliente antiguo con `CLI_TOO_OLD`
  y la versión mínima requerida —lo cual solo puede hacer para un cliente que declare quién es.

### 6 — Identificadores derivados de base de datos

Cada nombre que este framework calcula por sí mismo en lugar de recibirlo explícitamente:
una columna de clave foránea, una restricción de clave foránea, una tabla de unión
(junction table) y sus dos columnas clave, un tipo enum, el nombre de una política, la
columna `snake_case` correspondiente a una clave de columna en `camelCase`. Desde 0.31
las tablas se declaran con `defineTable`, que deriva exactamente los mismos nombres que
derivaba una colección para un esquema equivalente; `rebase migrate collections-to-tables`
lo demuestra por proyecto comparando el SQL generado byte por byte.

> **Un identificador derivado queda congelado en el momento en que una versión lo emite.**

No "congelado hasta la próxima versión major" — congelado. El razonamiento es diferente
al de los otros cinco contratos, y más estricto. Aquellos están versionados, por lo que
un desajuste puede ser *detectado* y rechazado. Este no puede: el nombre se escribe en la
base de datos de un cliente el día que despliega, y no hay un sello de versión en una
columna. Cada base de datos aprovisionada por cada versión que se haya publicado lleva
lo que haya derivado, y ningún código en este repositorio puede acceder y renombrarlas todas.

La versión 0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a singularizar
correctamente — `categorie_id` → `category_id`, `addres_id` → `address_id` —, lo cual es
inequívocamente la mejor derivación, y rompió cada base de datos existente que tenía un
plural irregular. Boot-ensure migró la columna, por lo que los datos sobrevivieron; el
archivo `schema.generated.ts` versionado en el proyecto no lo hizo, y el arranque falló
en una columna que existía. Tres commits, una nueva prueba de costura (seam test) y una
entrada permanente en las notas de actualización, a cambio de un nombre de columna con
mejor aspecto que nadie había solicitado.

**Si una derivación es genuinamente errónea**, se modifica para las tablas creadas
*a posteriori*, bajo una estrategia de nomenclatura registrada en el proyecto —nunca
retroactivamente, y nunca como efecto secundario de mejorar la función subyacente.

**La única anulación legítima** es un cambio que hace que el código coincida con un nombre
que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de identificadores:
Postgres recorta silenciosamente un identificador a 63 bytes, por lo que un nombre de
restricción derivado más largo nunca fue el nombre en el catálogo —la derivación describía
un objeto que no existía bajo esa grafía, y boot-ensure volvía a emitir `ADD CONSTRAINT`
en cada arranque porque su comparación nunca coincidía. Truncar en la construcción cambia
lo que este repositorio *deriva* y no cambia nada de lo que cualquier base de datos
desplegada *contiene*. Esa es la prueba que se debe aplicar: no si "es mejor el nuevo nombre",
sino si "alguna base de datos existente tiene que cambiar".

El otro caso donde un nombre puede cambiar es un conjunto de nombres que nunca podrían
coexistir. Una regla que abarcaba varias operaciones en una tabla de 42 bytes o más derivaba
`<table>_default_admin_write_insert`, `_update` y `_delete`, y las tres se recortaban a
los mismos 63 bytes. Postgres guardaba una sola política, DELETE, y rechazaba cada INSERT
y UPDATE de administrador. Solo cuando los nombres de una regla colisionan de esta forma se
derivan priorizando el sufijo, como `<head>_<hash8>_<op>`. Cada nombre que funciona hoy
conserva su grafía. El siguiente arranque o push elimina la única política truncada y crea
una política para cada operación.

Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder migrarlo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser generado, y la línea
base también fija esas detecciones. Eliminar una desharía la migración silenciosamente
en cada base de datos que aún conserve esa grafía.

**La barrera (gate).** `tooling/scripts/derived-names.mts` ejecuta un fixture de prueba
de esfuerzo de nomenclatura —plurales irregulares, una terminación en `ss`, un acrónimo,
una unión a partir de un slug en plural, anulaciones explícitas, un slug lo suficientemente
largo como para truncarse— a través de ambos generadores de DDL de esquema, y genera cada
identificador que cualquiera de los dos nombre:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura de contrato, mostrando la grafía
anterior y la nueva una al lado de la otra. Un cambio puramente aditivo también falla,
pero con la indicación "regenerate", de modo que la línea base no pueda desajustarse
por debajo de nadie.

También garantiza que `rebase db push` y el boot-ensure del runtime administrado deriven
los *mismos* nombres, lo cual es un segundo contrato oculto dentro del primero: compilan
las mismas tablas a través de código diferente, y un proyecto que se haya subido con push
una vez y arrancado después no debe terminar con dos esquemas distintos.

## Lo que *no* está congelado

Dicho con total claridad, para que nadie infiera una promesa que nunca se hizo:

- La API de TypeScript del autor — `defineTable` y `customizeTable`, opciones de
  `initializeRebaseBackend`, propiedades del admin, nombres de métodos del SDK. La versión
  0.31 reemplazó las colecciones por tablas en una versión menor, con un codemod que demuestra
  que el SQL generado no sufre cambios. Los cambios que rompen la compatibilidad se introducen
  en versiones menores y se anuncian en el registro de cambios.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de consumidores.
- Cualquier cosa bajo el `src/` de un paquete que no esté reexportada desde su archivo barrel.
  `packages/client/src/index.ts` incluye una nota que explica que su lista de exportaciones
  está seleccionada cuidadosamente de modo que una exportación interna no pueda volverse
  pública por accidente.
- El esquema de base de datos de *tus* tablas. Eso es tuyo; Rebase solo es propietario del
  esquema `rebase` (y, en una base de datos aprovisionada antes de 0.13, del antiguo esquema
  `auth` hasta que el arranque lo retire).

## Las barreras (gates) que sostienen esto

Nada de lo anterior es una simple convención: cada elemento cuenta con una prueba que
falla cuando se rompe:

| Barrera (Gate) | Qué garantiza |
|---|---|
| `pnpm verify:corpus` | cada estructura de bundle jamás lanzada, arrancada en el runtime actual. Los fixtures en `tests/fixtures/bundles/` están **escritos a mano y congelados**: un fixture que el constructor regenera cambia cada vez que el constructor cambia |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, arrancado y consultado tal como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguos (`schema-snapshots/`) recibidos por el runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto generado a partir de un scaffold instalado desde **tarballs reales**, no desde enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | la ruta del usuario final: registro → inicio de sesión → lecturas con alcance de RLS → refresco → almacenamiento → tiempo real |
| `pnpm check:derived-names` | cada columna, restricción, tabla de unión, enum y nombre de política que el framework deriva, y que el arranque y `db push` los deriven de forma idéntica |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación, y sus miembros, de los cinco paquetes que proporciona la imagen —`@rebasepro/server`, `types`, `client`, `common`, `utils`— más el punto de entrada `@rebasepro/server/functions`, contra las seis secciones de `contracts/server.api.txt`. Estos son los paquetes que `infra/docker/entrypoint.mjs` enlaza simbólicamente sobre las copias propias de un bundle desplegado, por lo que eliminar una exportación de uno de ellos no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las pruebas propias de las barreras, sobre fixtures —cuarenta y siete archivos, entre ellos `check:api-surface` y la verificación de incremento de versión más abajo—, por lo que una barrera que deje de detectar lo que protege falla aquí. `check:api-surface` pasó toda su vida sin poder detectar si un miembro desaparecía de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento bajo el cual se publica una versión coincida con lo que la versión hizo a las líneas base anteriores; ejecutado por `publish.yml` antes de que se estampe el registro de cambios |
| CI de saas | el plano de control compilado contra `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registra un fixture de bundle y un snapshot de esquema una vez por versión.** El valor de
ambos corpus radica enteramente en qué tan atrás llega el más antiguo, y ninguno puede
completarse retroactivamente después de los hechos.

### Aún no protegido por barreras

La tabla anterior es lo que se mantiene garantizado. Estas son las partes de la política
que aún nada garantiza, listadas para que nadie suponga una promesa en ellas:

- **Sin periodo de obsolescencia (deprecation) ni ventana de soporte.** Mientras Rebase
  esté en `0.x`, no existe una regla escrita sobre cuánto tiempo sobrevive una exportación
  obsoleta antes de su eliminación, ni durante cuánto tiempo recibe correcciones una versión
  menor anterior. Las correcciones de seguridad se aplican únicamente a la versión menor más reciente.
- **El formato de red HTTP no tiene barrera.** Ningún script `check:*` compara las formas
  de petición y respuesta contra una línea base de la manera en que `check:api-surface` compara
  las exportaciones; una modificación en la forma de respuesta solo es detectada por una
  suite e2e que casualmente la lea.
- **Los flags de la CLI no tienen una línea base de compatibilidad.** El verificador de
  documentación falla cuando desaparece un flag utilizado por las skills, los ejemplos o el
  sitio web; nada detecta la eliminación de cualquier otro flag o si un flag cambia de significado.
- **Una publicación en CI no registra ninguno de los dos corpus.** El flujo de trabajo de
  publicación no registra ningún fixture de bundle ni snapshot de esquema; solo el script de
  publicación local lo intenta, y emite una advertencia en lugar de detenerse cuando no puede.
  Las versiones 0.18 a 0.21 no tienen ningún snapshot de proyecto registrado.
- **La superficie de exportación es una barrera, no un contrato.** Que las exportaciones
  públicas de los paquetes proporcionados por el runtime se conviertan en un séptimo contrato
  numerado —declarado como la línea base de `check:api-surface`, compatible de forma aditiva
  dentro de una versión principal de contrato— es una decisión abierta.

## Modificar un contrato

1. Decide cuál de los seis es. La mayoría de los cambios no son ninguno de ellos —pero
   que no sea "ninguno de los seis" no significa que no sea "polémico"—. Eliminar o renombrar
   una exportación de `@rebasepro/server`, o un miembro de esta, no pertenece a ninguno de
   los seis y es el cambio individual más peligroso en el repositorio, porque el código que
   rompe ya está compilado y no se recompilará. `pnpm check:api-surface` es lo que mantiene
   esa línea; si se convierte en un séptimo contrato numerado es una decisión abierta
   (consulta *Aún no protegido por barreras*, más arriba).
2. Añade primero un fixture o snapshot para la estructura **antigua** y comprueba que pase.
3. Realiza el cambio e incrementa la constante.
4. Confirma que el fixture antiguo siga pasando, o que ahora falle *con el mensaje que
   un usuario necesitaría*. Ambos son resultados válidos; el silencio no lo es.
5. Para el contrato 3, planifica la recompilación de cada bundle desplegado antes de fusionar (merge).
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay ninguna constante para incrementar
   ni versión para rechazar, porque una columna no lleva ningún sello de versión. El paso que
   los reemplaza es decidir no hacer el cambio —consulta la sección anterior para ver cómo es la alternativa—.

## Relacionado

- [Actualización](/docs/upgrading/) — qué se rompió realmente, versión por versión
- [Registro de cambios](/docs/changelog/) — cada cambio, incluidos aquellos que no rompieron nada
- [Runtime y bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está compilado un proyecto desplegado
