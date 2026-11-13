---
sourceHash: 313f8530404811bc
slug: es/docs/rls-check
title: rls-check
description: Audite la seguridad a nivel de fila en cualquier base de datos PostgreSQL — Supabase, Neon, RDS o su propio servidor. De solo lectura, sin registro y sin necesidad de Rebase.
---

# rls-check

`rls-check` lee el catálogo de una base de datos PostgreSQL e informa de lo que realmente está expuesto:
tablas servidas con la seguridad a nivel de fila desactivada, políticas que se evalúan como verdaderas para
todos, vistas que leen directamente saltándose el RLS de sus tablas base y tablas de unión (join tables)
que se olvidaron mientras ambos extremos estaban protegidos.

Funciona en **cualquier** Postgres: Supabase, Neon, RDS, Cloud SQL o un servidor gestionado por usted mismo. No requiere Rebase y es útil tanto si decide adoptarlo como si no.

```bash
npx @rebasepro/rls-check
```

Ejecútelo en el directorio de su proyecto y encontrará la base de datos por sí mismo: `DATABASE_URL`,
luego `POSTGRES_URL`, y después un archivo `.env` en la misma ubicación. Pase la cadena de conexión como
argumento solo cuando no pueda hacer lo anterior: npm muestra en pantalla la línea de comandos antes de que
el programa se inicie y su shell la registra, por lo que una contraseña en un argumento termina en
dos lugares que `rls-check` no puede censurar. `$DATABASE_URL` no es más seguro allí: el shell
lo expande antes de que npm llegue a verlo.

Es de solo lectura por diseño: abre una transacción de solo lectura y realiza consultas al catálogo.
No escribe nada ni envía datos a ninguna parte: no hay telemetría ni llamadas de
red más allá de la conexión con su base de datos.

## Running it

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si su contraseña contiene `/`, `?` o `#`, codifíquela con percent-encoding. Esos tres caracteres finalizan la
sección de autoridad de la URL, por lo que la división se produce dentro de la credencial; en lugar de imprimir fragmentos de
una contraseña, `rls-check` rechaza la cadena y lo notifica.

`@` y `:` no necesitan codificación: la información de usuario se divide en el **último** `@` y el usuario en el
**primer** `:`, que es también lo que hace `pg`, por lo que `postgres://user:pa@ss@host:5432/db` se conecta
a `host` con la contraseña `pa@ss`. Codificarlos de todas formas nunca es incorrecto.

### Opciones

| Opción | Significado |
| --- | --- |
| `--json` | Salida legible por máquina en stdout, y nada más en stdout |
| `--format <name>` | `text` (predeterminado), `json` (igual que `--json`) o `agent`: un documento JSON para un agente de programación, donde cada hallazgo incluye la tabla y política afectadas, el SQL que lo corrige y el `securityRules` de Rebase equivalente |
| `--html <path>` | También escribe allí un informe HTML autocontenido. Un solo archivo, sin solicitudes de red |
| `--schema <name>` | Restringe el escaneo a un esquema. Repetible o separado por comas |
| `--role <name>` | Trata este rol como uno con el que llega un llamador no confiable, además de `anon`, `authenticated`, `web_anon` y `rebase_user`. Repetible o separado por comas |
| `--request-role <name>` | El rol con el que una aplicación Rebase en esta base de datos ejecuta solicitudes, en lugar de `rebase_user` (la configuración `rls.requestRole`). Sin esto, se usan los roles que la base de datos registró en `rebase.schema_meta`, y luego `rebase_user`. Repetible o separado por comas |
| `--fail-on <severity>` | Termina con código 1 en o por encima de esta gravedad. Predeterminado: `high`; `none` nunca falla |
| `--only <id>` | Ejecuta solo estas comprobaciones. Repetible o separado por comas |
| `--skip <id>` | Omite estas comprobaciones. Repetible o separado por comas |
| `--list-checks` | Imprime el catálogo y sale |
| `--timeout <ms>` | Tiempo de espera de sentencias, predeterminado 15000 |
| `--quiet` | Solo hallazgos: sin encabezado, sin resumen |
| `--no-color` | Desactiva el color ANSI (también respeta `NO_COLOR` y un stdout que no sea TTY) |

Un identificador desconocido pasado a `--only` o `--skip` genera un error en lugar de ignorarse silenciosamente,
ya que un error tipográfico debilitaría el escaneo sin previo aviso. Un `--role` o `--request-role` que no esté en `pg_roles`
es un error por la misma razón: cada comprobación depende de una concesión a un rol expuesto, por lo que un nombre que no
coincida con nada elimina cobertura sin avisar. Lo mismo ocurre con un `--schema` que no apunte a ningún esquema,
lo que de otro modo no escanearía nada e informaría que está limpio. Los nombres de esquemas distinguen entre mayúsculas y minúsculas.

El encabezado del informe indica los roles que la ejecución consideró expuestos, para que pueda ver de un vistazo
si `No findings` cubrió el rol con el que se conecta su aplicación:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Cuando el escaneo se conecta con un rol que la seguridad a nivel de fila *puede* restringir (ni un superusuario, ni
un propietario, sin `BYPASSRLS`), ese rol se añade al conjunto y el informe lo indica. Escanear con
el propio rol de su aplicación es lo más cercano a preguntarle a la base de datos qué es lo que ve su API.

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Ningún hallazgo en o por encima del umbral de `--fail-on` |
| `1` | Al menos un hallazgo en o por encima del umbral |
| `2` | El escaneo no se pudo ejecutar (argumentos inválidos, conexión rechazada, error de autenticación, tiempo de espera agotado) o quedó incompleto: falló una lectura del catálogo o una comprobación falló (`diagnostics.degraded`). Esto aplica incluso con `--fail-on none` |

`1` y `2` son deliberadamente distintos: una conexión rota nunca debe parecer una base de
datos limpia.

### En CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nuevo proyecto de Rebase no pasa esto desde el primer día, y no está previsto que lo haga.** El
`defaultRls` del scaffold abre las lecturas a todo el mundo: `{ operation: "select", access:
"public" }` en `backend/schema/index.ts`, el cual `authors` y `tags` toman con
`rls: "inherit"`, por lo que cada uno reporta un hallazgo crítico `policy-always-true`. (`posts` declara sus propias reglas y lee solo filas publicadas). `access: "public"` se refiere a las *filas*, no a quién puede llamar a la
API: una solicitud sin token sigue recibiendo un 401 mientras `AUTH_REQUIRE` esté activado. El hallazgo es
correcto de todos modos, porque eso es lo único que se interpone frente a los datos.

Decida cuál de las dos opciones corresponde antes de integrar esto en CI:

- **las reglas son provisionales**: reemplácelas con las que sus datos realmente necesitan
  ([seguridad a nivel de fila](/docs/collections/security-rules)), y los hallazgos desaparecerán;
- **las filas son realmente legibles por todo el mundo**: indíquelo una vez con
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, y sea consciente de lo que sacrifica:
  `--skip` desactiva la comprobación en todas partes, incluida la tabla que añada el próximo mes.

### Salida JSON

`--json` genera un objeto estable: `scannedAt`, `database` (solo host y nombre, nunca
credenciales), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` y `diagnostics`. Cada hallazgo incluye `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` y `confidence`.

`exposedRoles` y `diagnostics` forman parte del contrato, no son extras: cada comprobación se basa en
el conjunto expuesto, y `diagnostics.degraded` es la forma en que un consumidor distingue entre "no había nada incorrecto"
y "el escaneo no pudo inspeccionar". Leer `findings: []` sin ambos es leer la mitad de la respuesta.

### Salida para agentes

`--format agent` imprime un documento JSON para un agente de programación que solucione lo que encuentre. Cada
hallazgo indica su id de comprobación y el objeto con fallos (`target.table`, `target.policy`, …) e incluye
una remediación (`remediation`): `apply` (`sql`; `rebase-config` cuando Rebase vuelve a generar la política a partir del
`rls` de una tabla en cada arranque; o `manual`), código `sql` ejecutable escrito por comprobación, los
`placeholders` que se deben rellenar primero, y `rebase` —la misma solución que el `rls` de la tabla, con un
extracto de `defineTable(…, { rls })` para `backend/schema/`, o el motivo por el cual las reglas no pueden expresarlo. Desde
la versión 0.31 esa clave es `rebase.rls` (antes era `rebase.securityRules`) y la versión de formato del documento es 2. La clave `key`
de cada hallazgo es estable entre ejecuciones, por lo que una nueva ejecución muestra lo que se ha resuelto. `--json` no cambia.

## Ejecución programada

Una comprobación que hay que acordarse de ejecutar es una comprobación que reporta una base de datos limpia
justo hasta el día en que ocurre un problema. El backend puede ejecutarla por usted y
mostrar el resultado en el panel de administración:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Pase eso como `rlsAudit` en el objeto que entregue a `initializeRebaseBackend`.

En el runtime (`rebase dev`, `rebase start` y la imagen de servidor publicada)
no existe tal objeto que entregar, por lo que debe establecer `REBASE_RLS_AUDIT=true` en su lugar,
con el intervalo y umbral predeterminados. El escáner todavía debe provenir de su
proyecto: añada `@rebasepro/rls-check` a sus dependencias para que el bundle lo incluya.
El runtime no incluye una copia propia, y un arranque que solicite la auditoría sin
el paquete se rechazará antes de abrir una conexión, indicando el paquete que debe añadir.

El resultado se sirve en `GET /api/admin/rls-audit`, restringido al alcance
`schema:read`, y cada ejecución registra una línea: con nivel `warn` cuando un hallazgo alcanza
`warnAtSeverity`, y con nivel `info` en caso contrario:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit, or run
    `npx @rebasepro/rls-check` for the full report.
```

### Por qué se pasa `scan`

`@rebasepro/server` no tiene un controlador de base de datos propio; `@rebasepro/rls-check`
incluye `pg`, porque se conecta a Postgres. Importarlo dentro del paquete
del servidor añadiría un segundo controlador de Postgres en cada instalación, para una funcionalidad que solo
algunos utilizan, por lo que se proporciona la función externamente.

### En un despliegue dividido

La auditoría es un singleton con propietario (*owned singleton*), al igual que el programador de cron. Cada proceso que
lo posee ejecuta su propio escaneo, que es de solo lectura e inofensivo pero redundante; asígnelo
a un solo proceso:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

o, para un runtime configurado mediante variables de entorno:

```bash
REBASE_RLS_AUDIT=false
```

El rol `functions` ya lo tiene asignado como `false`: ese proceso no ejecuta temporizadores
en absoluto. Indicar una anulación de propiedad nunca altera otra: desactivar el cron deja
la auditoría intacta, y viceversa.

Un proceso que atienda la superficie de administración sin poseer el escaneo responderá
al endpoint honestamente, indicando que el escaneo no se ejecuta allí.

### Es una red de seguridad, no un monitor

El intervalo predeterminado es de un día, porque lo que se vigila es un esquema:
cambia con los despliegues, no con el tráfico. Un escaneo fallido se registra en los registros y en
el estado, nunca lanza una excepción. Convertir una comprobación de seguridad en una nueva forma de hacer
que el servidor falle sería un mal negocio en ambos sentidos.

## Cómo leer el informe

**Los hallazgos confirmados aparecen primero; los heurísticos están en una sección separada denominada "vale la pena revisar".** Una comprobación heurística no puede conocer la intención —una tabla de unión que dejó abierta a propósito no es un error—, por lo que se formulan como preguntas y nunca se mezclan con las certezas.

**Preste atención a la nota sobre privilegios.** Si el escaneo se conecta como superusuario, propietario de una tabla o un
rol con `BYPASSRLS`, el informe lo indicará. Ese rol ve el catálogo real, que es lo que hace posible
la auditoría, pero también significa que nada en el informe describe lo que experimenta *esa*
conexión en particular. Los hallazgos tratan sobre lo que obtienen los demás roles.

### En una base de datos Rebase, cambie la regla, no la política

Cada política en un despliegue de Rebase se compila a partir del `rls` de una tabla, y el
runtime **las comprueba en cada arranque**: cada política generada lleva una marca (un
comentario `rebase:<hash>`) de lo que se compiló y lo que Postgres almacenó, y una tabla cuyas
políticas ya no coinciden se vuelve a aplicar desde la configuración. Un `ALTER POLICY` ejecutado contra una
de ellas, por lo tanto, sobrevive exactamente hasta el siguiente reinicio, y el hallazgo reaparece con
él, después de haber visto cómo desaparecía.

`rls-check` reconoce esas políticas (un nombre `<table>_<operation>_<hash>`, o una llamada a
`rebase.uid()` / `rebase.roles()` en la expresión) y prescribe la regla en lugar de SQL.
Cuando vea una corrección que lo indique:

1. busque la tabla mencionada, bajo `backend/schema/`;
2. modifique su `rls` —consulte [seguridad a nivel de fila](/docs/collections/security-rules);
3. si la tabla indica `rls: "inherit"`, toma `defaultRls` de
   `backend/schema/index.ts`, y ese es el archivo a editar;
4. vuelva a desplegar (el arranque vuelve a aplicar las políticas) o ejecute `rebase db push`.

Una política escrita a mano, en una migración, no se ve afectada por nada de esto, y su corrección
sigue siendo el SQL a ejecutar.

## Las comprobaciones

Las gravedades a continuación son las predeterminadas; varias comprobaciones ajustan su propia gravedad según lo que
encuentran, y el informe siempre especifica el motivo.

### rls-disabled

**Tabla expuesta sin seguridad a nivel de fila.** Crítica.

La tabla tiene RLS desactivado *y* otorga `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un rol al que
un llamador no confiable puede acceder (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres no aplica
ningún filtro por fila en absoluto, por lo que las políticas —si existe alguna— nunca se consultan.

También se informa de una tabla externa (foreign table) con dicha concesión. Postgres no puede habilitar RLS en una de ellas,
por lo que el permiso entrega todo lo que el servidor remoto devuelva, y la solución sugerida revoca la
concesión en su lugar.

Una tabla con RLS desactivado pero sin permisos otorgados a un rol expuesto *no* se reporta, y tampoco una en
un esquema sobre el cual ese rol no tenga permiso `USAGE`: Postgres responde "permission denied for schema" antes
de consultar la tabla. No es accesible, y señalarla sería generar ruido innecesario.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Habilitar RLS sin políticas deniega cada fila a todos excepto al propietario, por lo que debe añadir la política
que desea en la misma migración; de lo contrario, habrá cambiado una vulnerabilidad por una interrupción
silenciosa del servicio. Consulte [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La política otorga acceso incondicional.** Crítica.

Una política permisiva cuya expresión `USING` o `WITH CHECK` es una verdad constante: `true`,
`(true)`, `1 = 1`, `1 > 0`, `NOT false`, `true OR <anything>`, o una constante comparada con
ella misma mediante un cast. Las políticas permisivas se combinan mediante OR, por lo que una sola de estas satisface
el filtro de filas de la tabla sin importar cuán estricta sea cualquier otra política.

Como ocurre con cada comprobación, solo reporta una exposición cuando un rol al que aplica puede alcanzar la tabla:
cuenta con el privilegio que su comando necesita y con `USAGE` en el esquema. `USING (true) TO anon` en una
tabla sobre la que `anon` no tiene privilegios recibe como respuesta "permission denied" antes de consultar la política.
Esa política se reporta como **info**, denominada *latente*: nada llega a la tabla a través de ella
hoy en día, y un solo `GRANT` la convertiría en una exposición crítica sin cambiar la política. El nivel Info está
por debajo de cualquier `--fail-on` excepto `info`, por lo que nunca hace fallar una ejecución por defecto.

Cuando solo el `WITH CHECK` de una política de `UPDATE` es constante —`USING (user_id = rebase.uid())
WITH CHECK (true)`—, la gravedad es **high**: `USING` sigue decidiendo qué filas se pueden modificar, y la
comprobación permite que una fila modificada se convierta en cualquier cosa, como en la de otro usuario. En una política `FOR ALL`,
la misma comprobación también admite cualquier `INSERT`, por lo que se mantiene en crítica.

Si las políticas de tipo `RESTRICTIVE` en el mismo comando (`ALL` para un `ALL` permisivo) se aplican a todos los
roles expuestos que alcanza la política permisiva, esta se degrada a media y se informa como
algo a verificar en lugar de una certeza, porque las políticas restrictivas se aplican con AND después de que las
permisivas se evalúen con OR. Una política restrictiva que condicione a otros roles u otro comando no
cuenta: deja la permisiva abierta para todos los que no contemple.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

En una base de datos Rebase, la corrección es la regla de la tabla en lugar de esa sentencia; consulte
[change the rule, not the policy](#en-una-base-de-datos-rebase-cambie-la-regla-no-la-política). Un
scaffold estándar reporta esta comprobación en `posts`, `authors` y `tags` por diseño.

### policy-anonymous-tautology

**La política solo comprueba que exista un id de llamador.** La gravedad depende de la plataforma.

La expresión tiene la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` en Supabase, y en una
base de datos Rebase aprovisionada antes de la 1.0): separa llamadores autenticados de los no autenticados,
pero no delimita filas. Todo usuario autenticado accede a cada fila cubierta por la política.

La gravedad depende de la plataforma, y esta distinción es importante:

- **En Supabase**, `auth.uid()` devuelve `NULL` para llamadores anónimos, por lo que es una comprobación válida
  de solo autenticados. Se reporta como **low**: una brecha de delimitación de datos entre usuarios
  autenticados, no un fallo de acceso anónimo. Esto aplica únicamente para `auth.uid()` (y el reclamo `sub`
  que lee): una solicitud sin autenticar aún lleva la anon key del proyecto, por lo que `auth.role()`
  es `'anon'` y `auth.jwt()` son los reclamos de esa clave. La misma forma construida sobre cualquiera de ellos
  es *verdadera para llamadores no autenticados* y se reporta como **critical**.
- **En Rebase o PostgREST**, donde un id de llamador en blanco se convierte en el valor
  centinela `'anonymous'`, la expresión es *verdadera también para llamadores no autenticados*. Se reporta como **critical**.
- **En una plataforma no reconocida**, se reporta como **medium**, ya que determinar si es una brecha
  depende de si su stack utiliza dicho centinela.

Una base de datos se considera Rebase cuando contiene el esquema `rebase`. El rol `rebase_user`
no lo determina, porque los roles pertenecen a todo el servidor, y un servidor que aloja una
aplicación Rebase puede contener otras bases de datos.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

El SQL sugerido se imprime con la función de id de llamador que su base de datos realmente tiene:
`rebase.uid()` en una base de datos Rebase, `auth.uid()` en Supabase y PostgREST. Ambas
variantes se reconocen al leer políticas, por lo que una base de datos Rebase en proceso de migración desde
el esquema `auth` previo a la 1.0 se sigue comprobando.

### policy-authenticated-tautology

**La política admite a cualquier llamador autenticado en todas las filas.** Alta; crítica para la variante de comprobación de rol que se detalla a continuación.

La forma corregida de la comprobación anterior —`rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'`— y el punto en el que la gente se detiene. Sí excluye a los llamadores no autenticados. Lo que no
hace es acotar filas: lo que queda es *cada cuenta registrada puede leer cada fila de
esta tabla*, lo cual es una afirmación diferente a la que normalmente se pretende. En un
proyecto Rebase esto es una regla cuya `condition` es `policy.authenticated()` y nada
más, lo que la base de datos almacena como `rebase.uid() <> ALL (ARRAY['anonymous', 'anon'])`.
Una regla cuya condición sea únicamente `policy.registered()` también se reporta: su condición adicional
`NOT rebase.is_anonymous()` mantiene fuera a los invitados y tampoco acota filas, por lo que cada cuenta que no sea
invitada lee cada fila. Con el valor predeterminado `--fail-on high`, una ejecución de CI que escanee dicha política fallará.

Una política cuya expresión solo comprueba el rol del llamador —`auth.role() = 'authenticated'`,
`(auth.jwt() ->> 'role') = 'authenticated'`, en cualquier orden— también se reporta bajo este identificador.
Es `TO authenticated USING (true)` expresado como condición, por lo que recibe la gravedad
que otorga [`policy-always-true`](#policy-always-true): crítica, o alta cuando solo el
`WITH CHECK` de una política de `UPDATE` es la comprobación de rol.

Ese es el patrón que convierte una tabla de `users` en un directorio de todas las direcciones de la
plataforma, legible por cualquiera que se haya registrado; y cuando el registro está abierto, "cualquiera que se haya
registrado" es cualquier persona del mundo. Se reporta por separado de la variante anónima porque la
solución es diferente y también lo es la gravedad, y porque es posible que legítimamente desee silenciar
una y no la otra.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Si la tabla es genuinamente legible por cualquier cuenta (una lista de precios compartida, una lista de
países), mantenga la política y silencie el hallazgo con
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vista omite el RLS de su tabla base al leer.** Crítica.

Una vista con permisos otorgados a un rol no confiable que realiza un `SELECT` desde una tabla protegida por RLS sin
`security_invoker = true`. La vista se ejecuta con los privilegios de su **propietario**, por lo que lee la
tabla base como dicho propietario y las políticas del llamador nunca se aplican. Esta es la forma más común en que
una tabla cuidadosamente protegida sufre filtraciones.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

En PostgreSQL versiones anteriores a la 15 la opción no existe en absoluto, por lo que cada vista de este tipo se comporta de
esta manera. En ese caso, el hallazgo se reporta como heurístico y la solución consiste en mover la lógica a una
función o actualizar PostgreSQL.

El propietario normalmente está exento de las políticas de la tabla base, pero no siempre. Cuando el propietario de la
vista no es superusuario, no tiene `BYPASSRLS` y no es dueño de la tabla base (o es su dueño
con `FORCE ROW LEVEL SECURITY`), las políticas se aplican al propietario. La vista entonces devuelve las
filas que esas políticas otorgan al propietario a todos los llamadores por igual. Eso puede resultar en menos filas de las
que un llamador debería ver, o en más. El hallazgo se sigue reportando, porque las filas no dependen de
quién las solicite, pero como heurístico en lugar de seguro. La solución es la misma.

### matview-bypasses-rls

**La vista materializada expone datos protegidos por RLS.** Alta.

Las vistas materializadas no pueden tener seguridad a nivel de fila, y los datos en ellas corresponden a una instantánea
almacenada por quien la haya actualizado. Si se conceden permisos a un rol no confiable y su consulta de
definición lee una tabla protegida por RLS, ninguna política servirá de ayuda: revoque el permiso o traslade
la vista materializada a un esquema al que los roles no confiables no puedan acceder. La solución sugerida revoca cada
concesión que llegue a un rol no confiable, desde el rol que cada concesión nombra: un permiso otorgado a un rol que
`anon` hereda no se elimina con `REVOKE … FROM anon`.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Llamadores no autenticados pueden escribir.** Alta.

Una política permisiva `INSERT`/`UPDATE`/`DELETE`/`ALL` accesible sin autenticación cuya
expresión de comprobación acepta cualquier fila, respaldada por una concesión correspondiente.

La condición de "acepta cualquier fila" es esencial y deliberadamente estricta. Supabase otorga a `anon`
y a `authenticated` permisos completos de DML por defecto, por lo que una política dirigida a esos roles no es en sí
misma un problema: un típico `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` es correcto
y no se reporta.

Una política llega a un llamador no autenticado mediante `TO public`, a través de un rol llamado
`anon` o `web_anon`, o mediante un rol del cual uno de ellos sea miembro: `TO app_writer`
se toma en cuenta cuando `anon` hereda `app_writer`.

En Rebase no existe el rol `anon`. Cada solicitud se ejecuta como `rebase_user`, incluida una
sin autenticar cuando la API lo permite (`AUTH_REQUIRE=false`, o `auth.requireAuth: false`)
y cada cuenta de invitado procedente de un inicio de sesión anónimo. La base de datos no puede ver esa configuración, por lo que en
Rebase una escritura a la que solo llega `rebase_user` se reporta como heurística. Con la restricción de API activada
y el inicio de sesión de invitados desactivado, solo los usuarios autenticados alcanzan la política, y aún así pueden escribir cualquier
fila. Delimite la regla de escritura de la tabla al llamador (un `ownerField`) o a `roles`.

### unqualified-column-in-subquery

**Columna no cualificada dentro de una subconsulta de directiva.** Alta, heurística.

Un nombre de columna simple dentro de una subconsulta `EXISTS`/`IN` que existe *tanto* en la relación interna
como en la propia tabla de la directiva. Postgres lo vincula a la tabla **interna**, por lo que la correlación con
la fila externa que pretendía escribir desaparece silenciosamente y el predicado pasa a ser trivialmente
satisfacible —o trivialmente insatisfacible, denegando cada fila a todos.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Lo que muestra el catálogo no es lo que usted escribió.** `pg_policies.qual` es la propia representación
de Postgres del árbol sintáctico y, dentro de una subconsulta, siempre cualifica las referencias
a columnas, por lo que el nombre sin cualificar nunca es visible para el momento en que se lee el catálogo. Lo que
perdura es su efecto: el `org_id` simple vinculado a la tabla interna, y el predicado almacenado
compara la columna de esa tabla consigo misma:
`m.org_id = m.org_id`. Esa autocomparación es lo que esta comprobación detecta en una base de datos en ejecución.

**La ausencia de este hallazgo no es prueba de seguridad.** Un nombre sin cualificar comparado con una
columna interna *diferente* (`organization_id = id`) se almacena como `m.organization_id = m.id`,
lo cual se lee exactamente como una comparación intencionada. Cuando esta comprobación se activa, es una evidencia
sólida; cuando no lo hace, no demuestra nada.

### junction-table-unprotected

**Tabla de unión muchos a muchos sin RLS.** Alta, heurística.

Una tabla que consiste esencialmente solo en los dos extremos de dos claves foráneas, ambas apuntando a
tablas que *sí* tienen RLS, sin seguridad a nivel de fila propia —y legible o modificable
por un rol con el que llega un llamador no confiable. Ambos lados de la relación
están protegidos y la conexión entre ellos está abierta, lo cual es suficiente para enumerar la relación
incluso cuando ninguno de los dos extremos se puede leer.

Es heurística porque una tabla de unión se infiere a partir de su estructura. Si la suya es deliberadamente
pública, use `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS habilitado pero no forzado para el propietario de la tabla.** Media, alta o crítica.

Sin `FORCE`, el propietario de la tabla está exento de sus propias políticas, al igual que cualquier miembro
del rol propietario. Esto es inofensivo cuando el propietario es un rol de aprovisionamiento con el que nada se conecta,
y grave cuando su aplicación se conecta como dicho propietario; por lo tanto, esto es **crítico** cuando un
rol con el que llega un llamador no confiable es dueño de la tabla o es miembro del rol propietario,
**alto** cuando el rol propietario puede iniciar sesión o un rol que puede hacerlo es miembro de él, y
**medio** en los demás casos.

Si el propietario es superusuario o tiene `BYPASSRLS`, se mantiene en media y se indica explícitamente: `FORCE` no puede
restringir a tal rol, e insinuar lo contrario sería engañoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS habilitado sin políticas.** Media.

No es una brecha de seguridad; al contrario. RLS activado con cero políticas deniega cada fila a todos
excepto al propietario. Se reporta porque es un fallo *invisible*: la API devuelve `[]`, y
una tabla vacía es indistinguible de una filtrada. Esta configuración ha servido silenciosamente
tablas vacías en producción durante semanas seguidas.

### policy-role-unreachable

**Las políticas apuntan a roles con los que nada se conecta.** Media.

Cada política en la tabla apunta a roles que no existen, no pueden iniciar sesión y que ningún rol
con permisos de inicio de sesión hereda de forma transitiva. Las políticas parecen correctas pero no aplican a nadie,
por lo que la tabla se lee como vacía.

El caso clásico son políticas escritas con `TO authenticated` (un nombre de rol de Supabase) en una base de datos
cuyas solicitudes realmente llegan como algún otro rol.

### grant-to-public

**Privilegios de tabla otorgados a PUBLIC.** Media.

Un privilegio DML otorgado a `PUBLIC`, en una tabla o tabla externa. Incluso con RLS habilitado, esto
amplía *para quién* se evalúan las políticas, y casi nunca es deliberado.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rutina SECURITY DEFINER con un search_path mutable.** Media.

La rutina se ejecuta con los privilegios de su propietario (a menudo un superusuario) mientras que el llamador controla cómo se
resuelven sus identificadores. Es el patrón estándar de escalada de privilegios, y cualquier cosa que la
rutina toque se lee con los permisos del propietario, evadiendo el RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La directiva llama a `current_setting()` sin `missing_ok`.** Baja, heurística.

`current_setting('app.tenant_id')` con un solo argumento *genera un error* cuando el parámetro no está establecido,
en lugar de devolver `NULL`. Por lo tanto, en lugar de denegar la fila, la solicitud falla: el llamador
recibe un 500 en lugar de un resultado vacío, y cualquier middleware que reintente errores 5xx reintentará una solicitud
que nunca podrá tener éxito.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Lo que esta herramienta no hace

Ser transparente sobre los límites es el objetivo: una herramienta de seguridad que exagera su cobertura es
peor que no tener ninguna.

- **Es una auditoría estática del catálogo.** Lee `pg_class`, `pg_policies`, `pg_depend` y
  tablas afines. No se conecta como su rol `anon` para intentar leer sus datos, por lo que no puede
  confirmar que una exposición sea accesible a través de su API.
- **No puede demostrar que una política sea correcta.** Detecta patrones que se sabe que son incorrectos. Una
  política que supera todas las comprobaciones descritas aquí aún puede expresar una regla de negocio errónea.
- **Un informe limpio no es una certificación de seguridad.** En particular, consulte la nota sobre
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres reescribe las expresiones
  de las directivas, por lo que algunos errores ya no son visibles en el catálogo en absoluto.
- **No comprueba la autorización a nivel de aplicación**, claves de API, exposición de red,
  gestión de secretos ni nada fuera de la base de datos.

## Relacionado

- [Row-level security](/docs/collections/security-rules) — el `rls` de una tabla de Rebase, el cual
  se compila en las políticas que esta herramienta audita.
- [Backend only](/docs/getting-started/headless/) — por qué una tabla sin políticas no se
  sirve en absoluto en un proyecto headless.
- [REST API](/docs/backend/api/) — la superficie que expone una directiva permisiva.
