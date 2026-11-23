---
sourceHash: 20aec4c8317aa338
title: Autorización de almacenamiento
sidebar_label: Autorización de almacenamiento
description: Decide quién puede leer, escribir, eliminar o listar cada objeto de almacenamiento con storagePolicies y el hook storageAuthorize, y qué scopes de almacenamiento necesita una clave API.
---

Las tablas están protegidas por seguridad a nivel de fila (row-level security); un bucket no tiene un equivalente por objeto, por lo que el almacenamiento se autoriza aquí. La [Configuración de almacenamiento](/docs/backend/storage/) cubre los backends en sí.

## Políticas

La forma declarativa. Una lista de patrones de ruta, leída sin ejecutar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una clave que no coincide con ninguna política es rechazada**, a menos que un hook `storageAuthorize` la permita: el hook solo se consulta cuando ninguna política coincidió con la clave para esa operación, y ninguno puede restringir al otro. Una política que coincidió y no concedió acceso es definitiva. Cada ampliación es una línea explícita, y un error deniega en lugar de conceder.

Los patrones coinciden **por segmento, nunca por subcadena** — `public/**` no coincide con `publicity/secret.png`:

| Patrón | Coincide con |
|---|---|
| `avatars/logo.png` | esa clave exactamente |
| `users/*/avatar.png` | exactamente un segmento donde está `*` |
| `users/:uid/**` | un segmento capturado, luego el resto — incluyendo nada |

`**` solo es válido como segmento final. `:name` captura un segmento y nunca abarca una `/`; las capturas llegan como `params` en el predicado.

`allow` es `"public"` (cualquiera a quien la ruta dé acceso), `"authenticated"` (cualquier llamador con un uid), o un predicado que recibe los parámetros capturados, el usuario, la operación y el bucket.

Una política se ejecuta después de la autenticación de la ruta, por lo que `"public"` por sí solo no abre una ruta a llamadores anónimos. Con `requireAuth` activado, solo acceden a lecturas de claves `public/`, o a todas las lecturas con `storagePublicRead`; `/upload`, `/list`, las eliminaciones y las subidas reanudables siempre necesitan un llamador. En cualquier otro caso, la respuesta es `401`.

`operations` tiene como valor predeterminado las cuatro: `read`, `write`, `delete`, `list`.

Las políticas satisfacen la protección de arranque en producción por sí solas, y un patrón mal formado hace que falle el arranque en lugar de la primera subida.

### Como datos: `STORAGE_POLICIES`

El entorno de ejecución administrado no puede leer un predicado de tu código, y un proyecto en el backend estándar de Rebase Cloud no tiene código para leer. Por lo tanto, las mismas reglas se pueden configurar como JSON en la variable de entorno `STORAGE_POLICIES`, nombrando en lugar de codificar los dos predicados que casi todas las aplicaciones escriben:

```bash
STORAGE_POLICIES='[
  { "path": "public/**", "operations": ["read"], "allow": "public" },
  { "path": "users/:uid/**", "allow": "owner" },
  { "path": "**", "allow": { "roles": ["admin"] } }
]'
```

| `allow` | Concede |
|---|---|
| `"public"` | cualquiera a quien la ruta dé acceso |
| `"authenticated"` | cualquier llamador que haya iniciado sesión |
| `"owner"` | el llamador que haya iniciado sesión cuyo uid sea el segmento `:uid` de la clave — la `path` debe capturar uno |
| `{ "roles": [...] }` | un llamador que haya iniciado sesión y posea cualquiera de estos roles |

Se compilan a `storagePolicies`, por lo que la coincidencia, el orden y el fallback a `storageAuthorize` son idénticos a la versión en código: una clave que ninguna regla cubre se consulta al hook si el proyecto tiene uno, y se rechaza si no. Un valor que no sea una lista válida impide el arranque, indicando cada problema; Rebase Cloud se niega a guardar uno no válido, y su consola edita la lista en **File storage → Access rules**.

## El hook

`requireAuth` y `publicRead` son interruptores *globales*: deciden si un llamador debe haber iniciado sesión, no qué puede tocar ese llamador. Sin un hook de autorización, **cualquier usuario autenticado puede leer cualquier clave que pueda nombrar** — lo único que separa los archivos de dos inquilinos (tenants) es la imposibilidad de adivinar la clave, lo cual no es un modelo de control de acceso. Peor aún, pueden hacer `GET /storage/list?prefix=` primero, por lo que ni siquiera es necesario adivinar las claves.

:::caution[El almacenamiento no arrancará en producción sin uno]
Las tablas están protegidas por seguridad a nivel de fila (row-level security); el almacenamiento no. No hay un equivalente por objeto en el bucket, por lo que este hook *es* el modelo — y `initializeRebaseBackend` **lanza un error al iniciar** bajo `NODE_ENV=production` cuando el almacenamiento está configurado y no se ha establecido ninguno de estos:

- `storageAuthorize` — un hook, por objeto. Recomendado.
- `storagePolicies` — las reglas declaradas anteriormente.
- `storagePublicRead: true` — el bucket es genuinamente una CDN pública de solo lectura.
- `storageInsecureAllowAnyAuthenticated: true` — una aplicación single-tenant donde se confía cada archivo a cada usuario que haya iniciado sesión. Nombrado a propósito para leerse dos veces.

En desarrollo, en su lugar registra una advertencia en el log, por lo que un proyecto puede equivocarse en esto y funcionar bien localmente hasta el momento en que se despliega. Un proyecto generado con scaffolding ya incluye un hook en `backend/storage.ts` — léelo antes de reemplazarlo, y ten en cuenta que modela una *biblioteca de contenido compartido* de un CMS, lo cual no tiene la misma estructura que los archivos por usuario.
:::

`storageAuthorize` es el análogo en almacenamiento del `rls` de una tabla, y se ejecuta después de la autenticación en cada ruta de almacenamiento:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Campo | Descripción |
|-------|-------------|
| `key` | Clave del objeto, con el prefijo del bucket eliminado y saneada contra directory traversal |
| `bucket` | Bucket resuelto (`"default"` cuando no se especifica) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, o `null` donde la ruta permite acceso anónimo |
| `storageId` | El backend con nombre, cuando la solicitud apuntó a uno — su clave canónica (`storageId=%20media` es `"media"`). Ausente para la fuente por defecto, sin importar cómo la nombró la solicitud (sin parámetro, vacía o `(default)`) |
| `data` | Acceso de lectura confiable que **omite RLS** — `data.table(slug).find(query)` / `.findById(id)`. La propiedad reside en una fila, no en un prefijo de clave, por lo que el hook necesita un lector para responder "¿a quién pertenece este objeto?". Omite deliberadamente la seguridad a nivel de fila: este hook *es* la decisión de autorización, y tomarla a través de un lector ya restringido por los propios permisos del llamador sería circular. Solo lectura por diseño. |

Devuelve `false` para denegar con un **403**. Lanzar una excepción también deniega — una búsqueda de propiedad que falla no queda abierta por defecto.

Conviene saber:

- **La ruta de metadatos es donde realmente se decide el acceso de lectura.** Acuña el token de descarga de corta duración y delimitado a la ruta en el que confía la ruta del archivo, por lo que el hook lo controla allí. Dos lecturas omiten el hook, por diseño. Una que porte dicho token: el hook la aprobó cuando se generó el token, solo para esa ruta y fuente, por lo que un hook que ahora la rechazaría (una membresía revocada desde entonces) no la detiene antes de que el token expire — `storageDownloadTokenTtl`, 300 segundos por defecto. Y una lectura de una clave bajo `public/` por parte de un llamador sin credenciales: el prefijo es la declaración de que cualquiera puede leerlo, incluidos los visitantes anónimos y las CDN. La lectura de la misma por parte de un llamador que ha iniciado sesión aún se consulta, pero la de uno anónimo no, por lo que un hook no puede hacer privada una clave `public/`; en su lugar, almacena el archivo fuera de `public/`. Solo esas dos lecturas lo omiten: un usuario al que tu adaptador de autenticación llame por casualidad `public` se consulta como cualquier otro.
- **Un bucket, un nombre.** En S3 y GCS, el `bucket` del hook siempre es `"default"`, incluso cuando una solicitud nombra el bucket del proveedor, el cual accede a los mismos objetos.
- **Una ruta es pública cuando la clave que nombra lo es.** El prefijo `public/` se evalúa en la clave canónica que sirve la ruta — después de descartar un segmento inicial de bucket `default/` y simplificar `//`, `./` y una `/` inicial — nunca en la URL tal como está escrita. `/api/storage/file/notes://public/x.txt` nombra la clave privada `notes:/public/x.txt`, y la clave `default/public/x.txt` (a la que se accede como `/api/storage/file/default/default/public/x.txt`) se encuentra en una carpeta llamada `default`; ninguna de las dos es pública. En un hook, comprueba la `key` que se te entrega con `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lee una ruta o URL del lado del cliente, y evalúa ambas como públicas.
- **`list` se controla en el prefijo.** Listar es la forma en que descubres claves de las que nadie te habló.
- **Las subidas reanudables (TUS) se controlan al momento de su creación**, por lo que una subida denegada no deja ningún archivo temporal atrás.
- Omitir el hook (y `storagePolicies`, y `STORAGE_POLICIES`) deja el sistema sin comprobación por objeto, por lo que producción se negará a arrancar a menos que se configure `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## Claves API y tokens

Una persona que ha iniciado sesión posee todos los scopes de almacenamiento, por lo que el hook y las políticas anteriores deciden por ella. Una [clave API](/docs/backend/api-keys/) también necesita el scope de almacenamiento para la operación, en la fuente que la solicitud especifica: `storage:read` para descargas, metadatos y listados, `storage:write` para subidas, carpetas y cada paso de una subida reanudable, `storage:delete` para eliminaciones. El destino es el id de la fuente, y el de la fuente por defecto es `(default)`: `storage:read:(default)`, `storage:write:avatars`. Sin él, la respuesta es `403 SCOPE_MISSING`. Con él, el hook aún se ejecuta, actuando como quienquiera que represente la clave.

## Siguientes pasos

- **[Configuración de almacenamiento](/docs/backend/storage/)** — backends, endpoints y límites
- **[Claves API](/docs/backend/api-keys/)** — los scopes que porta una clave
