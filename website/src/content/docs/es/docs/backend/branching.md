---
sourceHash: f9ad18cf03580c13
title: Ramificación de bases de datos
sidebar_label: Branching
description: Cree ramas de bases de datos aisladas para desarrollo, staging y pruebas utilizando CREATE DATABASE ... TEMPLATE de PostgreSQL — copias instantáneas de fidelidad total sin tiempo de inactividad.
---

## Descripción general

La ramificación de bases de datos (database branching) le permite crear **copias instantáneas y aisladas** de toda su base de datos (tanto el esquema como los datos) para realizar de forma segura tareas de desarrollo, pruebas de migración y procedimientos de control de calidad (QA).

Al aprovechar las plantillas nativas de PostgreSQL, Rebase aprovisiona bases de datos clonadas a nivel del sistema de archivos. Esto significa que obtiene una réplica de fidelidad total que contiene todas las tablas, índices, tipos personalizados, restricciones y políticas de seguridad a nivel de fila (RLS, Row-Level Security) sin sobrecarga de transferencia de red ni demoras en la configuración del esquema.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Bajo el capó: Plantillas de PostgreSQL

Cuando se crea una rama de base de datos, el `BranchService` de Rebase ejecuta el siguiente SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL procesa esta operación copiando los directorios subyacentes del sistema de archivos que contienen los archivos de la base de datos de origen. Esto proporciona:
- **Clones en menos de un segundo**: No se realiza generación de SQL ni carga de datos.
- **Esquemas y datos idénticos**: Cada fila, índice y restricción se duplica instantáneamente.
- **Aislamiento completo**: Modificar el esquema o insertar registros en la rama no afecta a la base de datos de origen.

### La protección contra el límite de conexiones

PostgreSQL requiere que **no existan otras conexiones activas** en la base de datos plantilla (de origen) al ejecutar un comando `CREATE DATABASE ... TEMPLATE`.

Para evitar fallos, el `DatabasePoolManager` de Rebase ejecuta un proceso de expulsión activa antes de clonar o eliminar una rama:
1. **Bucle de expulsión**: Cierra y desconecta automáticamente todos los pools inactivos que apuntan a la base de datos de destino dentro del contexto de la aplicación Rebase.
2. **Bloqueo de conexiones externas**: Si clientes externos (como DBeaver, pgAdmin o procesos de backend externos) mantienen transacciones activas en la base de datos de origen, PostgreSQL rechazará la operación de plantilla con un error `"being accessed by other users"`.

El fallo indica qué está conectado en lugar de dejarle adivinando:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` finaliza esas sesiones antes de aplicar la plantilla, tanto en `create` como en `delete`. Nunca finaliza la sesión que ejecuta el comando en sí.

`create --force` también cierra el origen a nuevas conexiones para la copia (`ALTER DATABASE … ALLOW_CONNECTIONS false`, ejecutado desde la base de datos `postgres` del servidor) y vuelve a abrirlo después: en caso de fallo y ante cualquier señal que pueda capturar (cerrar la terminal, Ctrl-C, SIGTERM, SIGQUIT). Si se elimina de forma forzada (SIGKILL), deja el origen cerrado hasta el siguiente comando `rebase db branch`, cualquiera de ellos, el cual lo vuelve a abrir primero y así lo indica; `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, ejecutado desde la base de datos `postgres`, hace lo mismo manualmente. Mientras una creación forzada mantiene cerrado su origen, retiene un bloqueo consultivo (advisory lock) sobre él en la base de datos `postgres`, de modo que la reapertura no interfiere con el origen de una copia en curso, y una segunda creación forzada desde el mismo origen espera a que finalice la primera. Un cliente que se reconecta en cuanto se desconecta, como lo hace una instancia en ejecución de `rebase dev`, no puede volver a colarse antes de que comience la copia. Esto requiere ser el propietario del origen; sin ello, y en `delete`, `--force` desconecta las sesiones hasta tres veces antes de rendirse. Si todavía queda alguna sesión después de eso, el error indica que se reconectaron y que se deben detener, en lugar de volver a pasar `--force`.

`DatabasePoolManager` desconecta sus propios pools inactivos antes de clonar o eliminar, pero solo los pools **dentro del proceso que realiza el trabajo**. `rebase db branch` se ejecuta como su propio proceso, por lo que esto no afecta a nada más en su máquina:

- **Una instancia de `rebase dev` en ejecución bloquea la ramificación.** Este es el caso habitual, no un caso aislado: querer una rama y tener la aplicación en ejecución suelen ocurrir en el mismo momento. Detenga el servidor de desarrollo, cree la rama e inícielo de nuevo.
- **Lo mismo ocurre con cualquier otro cliente.** DBeaver, pgAdmin, una sesión de `psql`, una segunda instancia de la aplicación: PostgreSQL rechaza la operación con `is being accessed by other users` y esas conexiones deben cerrarse manualmente.

No hay forma de evitar esto en PostgreSQL; `CREATE DATABASE ... TEMPLATE` es una copia a nivel del sistema de archivos y la plantilla debe permanecer inactiva durante todo el proceso.

---

## Esquema de metadatos

Las configuraciones de las ramas se almacenan en la base de datos predeterminada en la tabla `rebase.branches`, que se aprovisiona durante la inicialización (bootstrapping):

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Un servidor que se ejecuta en una rama mantiene las ramas en la base de datos desde la que se copió la rama. La propia tabla `rebase.branches` de la rama es solo una instantánea tomada antes de que se escribiera su fila. Por lo tanto, `rebase dev` en un checkout [cambiado](#integración-con-la-cli) establece `REBASE_BRANCH_PARENT_DATABASE` con la base de datos que nombra `.env`, y un servidor con esa variable lee y escribe el registro allí, y copia nuevas ramas desde ella por defecto. El panel Branches de Studio en una rama lista las ramas de la base de datos principal, incluida la actual, y una rama creada allí es una de las que muestra `rebase db branch list`.

---

## API programática

La API de ramificación se expone a través del `BranchService` del backend. A continuación, se presenta una referencia de la interfaz principal:

### Crear una rama de base de datos

Genera una nueva base de datos de rama a partir de la base de datos predeterminada o de una plantilla de origen explícita.

El valor predeterminado es la base de datos en la que se encuentra la propia conexión del servidor, o `REBASE_BRANCH_PARENT_DATABASE` cuando el servidor se ejecuta en una rama. Nunca es la base de datos que nombra `ADMIN_CONNECTION_STRING`, si se trata de otra diferente.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Listar ramas activas

Obtiene la lista de ramas registradas junto con sus tamaños físicos consultados a través de la función del sistema `pg_database_size` de PostgreSQL.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` es la base de datos de PostgreSQL correspondiente a la rama, según indica su registro: a qué conectarse y qué pasar como `source` para copiar la rama. No es el nombre de la rama (`staging` es la base de datos `rb_staging`).

### Obtener información de la rama

Obtiene los metadatos de una sola rama. Si la rama existe, el servicio intenta consultar su uso actual de espacio físico en disco:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Eliminar una rama

Elimina la base de datos de destino del servidor y limpia su registro en la tabla de metadatos `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Medida de seguridad: La base de datos principal (el nombre de la base de datos predeterminada configurado en las cadenas de conexión) está protegida. Esa es la base de datos en la que está la propia conexión del servidor, o `REBASE_BRANCH_PARENT_DATABASE` en una rama. Si intenta eliminar la base de datos principal, el `BranchService` arroja un error `"Cannot delete the main database"` y se cancela.

---

## Integración con la CLI

Las ramas de la base de datos se pueden gestionar directamente mediante la CLI de Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` es lo que hace que una rama sea utilizable. Registra la rama en `.rebase/branch.json` —un nombre, nunca una cadena de conexión, para que sus credenciales permanezcan únicamente en `.env`— y cada comando `rebase` en ese checkout resolverá a partir de entonces la base de datos de la rama: `dev`, `db push`, `db migrate`, `db backup`. Un proceso `rebase dev` que ya esté en ejecución mantiene la base de datos con la que se inició hasta que lo reinicie, y `switch` así lo indica.

`rebase db branch list` marca la rama en la que se encuentra este checkout, y `prune` nunca la elimina, del mismo modo que `delete` se niega a hacerlo: el plan la lista como conservada y sugiere salir de ella con `rebase db branch switch --off` primero.

Se sitúa entre la shell y el archivo del proyecto en el orden de resolución:

1. `--database-url` en la línea de comandos
2. `DATABASE_URL` en el entorno de la shell
3. **la rama a la que está cambiado este checkout**
4. `DATABASE_URL` en el archivo `.env` del proyecto
5. `--docker`, o el último `rebase dev` que se haya ejecutado con él
6. la base de datos de desarrollo administrada

El nivel 5 sigue al último `rebase dev --docker`, por lo que un comando de rama posterior no necesita su propio `--docker`, y un `--docker` superado por un nivel superior no iniciará ningún contenedor e indicará que fue ignorado.

Una rama debe tener mayor prioridad que `.env`, o de lo contrario el cambio no haría nada en ningún proyecto que defina `DATABASE_URL`; no debe superar a los dos anteriores porque un flag en esta línea de comandos es una instrucción más inmediata que un cambio realizado ayer.

`.rebase/` se incluye en `.gitignore`, por lo que la rama en la que se encuentra es un dato exclusivo de su máquina y nunca del proyecto.

En un checkout cambiado, `rebase db branch create`, `list`, `info`, `delete` y `prune` funcionan en la base de datos principal, donde está el registro, y así lo indican. `create` sigue copiando la rama en la que se encuentra a menos que pase `--from`; se registra en la base de datos principal, por lo que `list` la muestra desde cualquier checkout.

Las ramas son bases de datos comunes de PostgreSQL nombradas a partir de la rama con el prefijo `rb_`, por lo que la anterior `dev_sandbox` es la base de datos `rb_dev_sandbox` en el mismo servidor.

Crear una rama **no** cambia la base de datos con la que se comunica su proyecto. `rebase db branch create` hace la copia y se detiene ahí; nada escribe en `.env`, y el siguiente `rebase dev` seguirá utilizando la base de datos que usaba antes. Para trabajar con una rama, cámbiese a ella con `rebase db branch switch <name>`, como se indicó anteriormente. Para acceder a ella desde cualquier herramienta que no sea un comando `rebase`, su cadena de conexión es la que ya tiene sustituyendo el nombre de la base de datos:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Revisar y fusionar una rama

Una rama es el lugar donde un agente, o una migración de la que no esté seguro, puede modificar una base de datos sin tocar la real. Antes de que cualquiera de esos cambios llegue a la base de datos a partir de la cual se creó la rama, puede ver qué cambió y fusionarlo desde [Studio](/docs/studio/): abra **Branches** y elija una.

- **Schema & RLS policies** enumera cada tabla, columna, clave primaria, restricción (unique, foreign key, check, exclusion), índice, disparador (trigger), política, tipo enum (con sus etiquetas), vista y función que la rama agregó, eliminó o modificó, en formato SQL, mostrando la definición del elemento padre junto a la de la rama.
- **Data changes** cuenta, por tabla, las filas que la rama insertó, actualizó y eliminó, cotejadas por clave primaria, y muestra hasta 100 de ellas por tabla (como máximo 1.000 cuando solicita más) con las columnas que cambiaron. Una columna que tenga nombre de credencial —`password_hash`, un `*_token`, cualquier cosa con `secret` en ella, un `*_hash`— muestra `[redacted]` en lugar de su valor.

Revisar una rama requiere el ámbito (scope) `database:write`, el que ejecuta SQL como propietario de la base de datos: las muestras son filas de ambas bases de datos, leídas al margen de la seguridad a nivel de fila. `database:read` lista las ramas pero no lee sus filas.

El mismo diff se obtiene con `rebase db branch diff <name>` en una terminal, `GET /api/admin/branches/<name>/diff` a través de HTTP, la herramienta MCP `rebase_db_branch_diff` y `admin.diffBranch(name)` en código. Las tablas propias de Rebase (sesiones, historial, el registro de ramas) se excluyen.

### Qué lado modificó una fila

La base de datos principal (parent) continúa recibiendo escrituras mientras se trabaja en la rama, por lo que "las dos bases de datos difieren" no es lo mismo que "la rama la modificó": una fila que el elemento principal insertó después de que se creó la rama se ve exactamente como una fila que la rama eliminó. Rebase las distingue según el momento en que se escribió cada fila. Los ID de transacción pertenecen al servidor, no a una única base de datos, y la copia de la plantilla los conserva; por lo tanto, una fila escrita después de crear la rama —en cualquiera de los dos lados— es más reciente que la transacción que creó la base de datos de la rama. Esa transacción se lee cuando se crea la rama y se conserva en su registro, por lo que un `GRANT` o `ALTER DATABASE` posterior en la base de datos de la rama no la altera.

| Fila de la rama | Fila del elemento principal (parent) | Contada como |
| --- | --- | --- |
| escrita desde la bifurcación | ausente | insertada por la rama |
| ausente | anterior a la bifurcación | eliminada por la rama |
| escrita desde la bifurcación | anterior a la bifurcación | actualizada por la rama |
| anterior a la bifurcación o ausente | escrita desde la bifurcación o ausente | cambio del elemento principal: conservada |
| escrita desde la bifurcación | escrita desde la bifurcación | un **conflicto** |

Hay dos casos que se parecen y se interpretan de forma que no se pierda nada: una fila que la rama eliminó y que el elemento principal modificó posteriormente se conserva, y una fila que el elemento principal eliminó y que la rama modificó posteriormente se considera una inserción de la rama. Un `UPDATE` que escribe los mismos valores que una fila ya tenía sigue contando como una escritura.

Una rama creada antes de que Rebase guardara esa transacción la lee de la fila `pg_database` de la base de datos de la rama tal como se encuentra ahora; cualquier cosa que haya reescrito la fila desde entonces la desplaza. Cuando el punto de bifurcación no se puede leer en absoluto —una rama de larga duración cuya fila fue congelada por un vacuum—, el diff lo indica y atribuye todas las diferencias a la rama.

### Qué hace una fusión (merge)

**Merge** escribe las filas que la rama insertó, actualizó y eliminó en el elemento principal. Criterio de resolución:

- **Las filas modificadas solo por la rama** se escriben: insertadas, sobrescritas o eliminadas.
- **Las filas modificadas solo por el elemento principal** desde que se creó la rama se dejan exactamente como están, a menos que alguna haga referencia a una fila eliminada por la rama, lo que constituye un conflicto (ver más abajo).
- **Las filas modificadas por ambos** son conflictos. Por defecto, la fusión no escribe absolutamente nada; elija `onConflict: "branch"` para sobrescribir la fila del principal con la de la rama, o `"target"` para mantener la del principal.
- **Una fila que la rama eliminó y a la que aún hacen referencia filas más recientes del elemento principal** también es un conflicto. Supongamos que la rama eliminó un autor y, desde entonces, el principal ha registrado una publicación de dicho autor: eliminar el autor en el principal provocaría una eliminación en cascada de esa publicación, dejaría su columna en null o fallaría por restricción de clave foránea. El diff contabiliza al autor como un conflicto e indica las filas que hacen referencia a él (`referencedBy`: la tabla, la clave foránea, su regla `ON DELETE` y la cantidad de filas). Por defecto, la fusión se rechaza, indicando la tabla, las filas y la solución; `"target"` conserva al autor y, con él, la publicación; `"branch"` elimina al autor, permite que la clave foránea actúe según lo configurado y lista los elementos afectados en `warnings`.
- **Los cambios de esquema y políticas nunca se fusionan.** Pertenecen a las definiciones de sus tablas y a sus migraciones: aplíquelos con `rebase db push` (o `migrate`) y luego fusione las filas.

Una tabla cuyas filas no se pueden emparejar bloquea la fusión: una que la rama haya agregado o eliminado, una cuyas columnas o clave primaria difieran entre ambas, una sin clave primaria o una con más de 100.000 filas en alguno de los lados. Sus recuentos muestran 0 porque se desconoce qué filas cambiaron; `rowCounts` proporciona el recuento de filas de cada lado. Una tabla de ese tipo en la que solo el elemento principal haya realizado cambios —la rama no escribió ninguna de sus filas y las anteriores a la bifurcación son idénticas— no se bloquea. Pase `skipBlocked` (en Studio, marque **Merge the other tables**) para fusionar el resto e ignorar esas tablas.

Una tabla reescrita desde que se creó la rama también se bloquea (`TABLE_REWRITTEN`). Un cambio de tipo de columna, un `ADD COLUMN` con un valor predeterminado volátil, `VACUUM FULL` o `CLUSTER` reescribe cada fila desde cero, por lo que todas las filas se leen como si se hubieran escrito después y ya no es posible determinar qué lado cambió cada cosa. Cuando la rama haya modificado el tipo de una columna, fusione sus filas antes de aplicar ese cambio al principal, o vuelva a crear la rama después de aplicarlo.

Cada escritura se produce en una sola sentencia en el elemento principal —todo o nada, con las claves foráneas comprobadas al final—. Una fusión lleva el `fingerprint` del diff que revisó y no escribe nada si alguna de las bases de datos ha cambiado desde entonces: vuelva a cargar el diff y revíselo de nuevo. Las secuencias avanzan para superar cualquier ID que la fusión haya insertado.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

La fusión no es, de forma deliberada, una herramienta MCP: un agente propone en su rama y una persona fusiona.

---

## La ramificación requiere un servidor PostgreSQL real

La ramificación **no** funciona con la base de datos de desarrollo administrada: la base de datos PGlite sin configuración que `rebase dev` inicia cuando un proyecto no tiene `DATABASE_URL`.

PGlite sirve exactamente una base de datos. Ejecutar `CREATE DATABASE ... TEMPLATE` sobre ella escribe una entrada de catálogo y no copia nada, por lo que la "rama" se resuelve en la base de datos desde la que se clonó: las escrituras que cree aisladas terminan en su base de datos de desarrollo y no hay una segunda copia a la que volver.

Utilice la ramificación en un servidor real: su propio PostgreSQL a través de `DATABASE_URL`, o `rebase dev --docker`, que luego siguen los comandos de ramas.

---

## Buenas prácticas y limitaciones

### Uso de disco
Debido a que PostgreSQL duplica los archivos en el disco, cada rama consume un espacio equivalente al de la base de datos de origen. Si tiene una base de datos de producción de 100 GB, crear 5 ramas consumirá 500 GB adicionales de almacenamiento. 
* *Recomendación*: Utilice subconjuntos de bases de datos o plantillas de desarrollo ligeras como orígenes de clonación en lugar de clones completos de producción.

`rebase db branch prune` es la forma de recuperar el espacio:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nada expira a menos que lo solicite: una rama puede ser la única copia del trabajo de una tarde, por lo que `--older-than` es opcional (opt-in) y las antigüedades se redondean hacia abajo (floored), y el comando muestra su plan y solicita confirmación antes de eliminar nada, a menos que pase `--yes`.

Prune también detecta las dos formas en que las ramas se desvían de sus metadatos: una entrada cuya base de datos se eliminó con SQL simple (que `list` seguiría reportando para siempre) y una base de datos de rama cuya entrada nunca se escribió (una caída entre las dos sentencias que ejecuta `create`). Las bases de datos temporales `<db>_dev_diff` de Atlas se reportan junto con ellas, pero solo se eliminan con `--include-dev-diff`: no son ramas y una de ellas podría pertenecer a un `db push` que se esté ejecutando en este momento.

### Compatibilidad con pgBouncer
Al implementar detrás de pgBouncer o agrupadores de conexiones (connection poolers), asegúrese de que el pooler admita operaciones administrativas de base de datos. La creación y eliminación de bases de datos elude los pools estándar a nivel de transacción y requiere conexiones directas al servidor Postgres (utilizando privilegios elevados de usuario) mediante la configuración `adminConnectionString`.

### Consultas entre bases de datos (Cross-Database Queries)
Dado que las ramas son bases de datos de PostgreSQL independientes, no es posible realizar sentencias `JOIN` de SQL entre distintas ramas. Todas las relaciones deben estar contenidas dentro del alcance de una única base de datos de rama activa.


## Temas relacionados

- [Comandos de base de datos](/docs/cli/database/#rebase-db-branch) — `rebase db branch` y sus indicadores
- [Generación de esquemas](/docs/cli/schema/) — cómo se genera el esquema que copia una rama
- [Entorno y configuración](/docs/getting-started/configuration/) — `DATABASE_URL` y qué prioridades supera una rama activa
