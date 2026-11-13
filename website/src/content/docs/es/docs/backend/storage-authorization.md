---
sourceHash: 1e1ed4905f58d5fd
title: Autorización de almacenamiento
sidebar_label: Autorización de almacenamiento
description: Decide quién puede leer, escribir, eliminar o listar cada objeto de almacenamiento con storagePolicies y el hook storageAuthorize, y qué scopes de almacenamiento necesita una API key.
---

Las tablas están protegidas por seguridad a nivel de fila (row-level security); un bucket no tiene un equivalente por objeto, por lo que el almacenamiento se autoriza aquí. [Configuración de almacenamiento](/docs/backend/storage/) cubre los backends en sí.

## Políticas

La forma declarativa. Una lista de patrones de ruta, leída sin ejecutar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una clave que no coincida con ninguna política es rechazada**, a menos que un hook `storageAuthorize` lo permita: solo se consulta al hook cuando ninguna política coincide con la clave para esa operación, y ninguno puede restringir al otro. Una política que coincidió y no concedió acceso es definitiva. Cada ampliación es una línea explícita, y un error deniega en lugar de conceder.

Los patrones coinciden **por segmento, nunca por subcadena** — `public/**` no coincide con `publicity/secret.png`:

| Patrón | Coincide con |
|---|---|
| `avatars/logo.png` | exactamente esa clave |
| `users/*/avatar.png` | exactamente un segmento donde está `*` |
| `users/:uid/**` | un segmento capturado, luego el resto — incluyendo nada |

`**` solo es válido como segmento final. `:name` captura un segmento y nunca abarca una `/`; las capturas llegan como `params` al predicado.

`allow` es `"public"` (cualquiera que la ruta permita entrar), `"authenticated"` (cualquier llamador con un uid), o un predicado que recibe los params capturados, el usuario, la operación y el bucket.

Una política se ejecuta después de la autenticación de la ruta, por lo que `"public"` por sí solo no abre una ruta a llamadores anónimos. Con `requireAuth` activado, solo acceden a lecturas de claves `public/`, o a cada lectura con `storagePublicRead`; `/upload`, `/list`, las eliminaciones y las subidas reanudables siempre necesitan un llamador. En cualquier otro caso, la respuesta es `401`.

`operations` tiene como valor predeterminado las cuatro: `read`, `write`, `delete`, `list`.

Las políticas satisfacen la protección de arranque en producción por sí solas, y un patrón mal formado hace fallar el arranque en lugar de la primera subida.

## El hook

`requireAuth` y `publicRead` son interruptores *globales*: deciden si un llamador debe haber iniciado sesión, no qué puede tocar dicho llamador. Sin un hook de autorización, **cualquier usuario autenticado puede leer cualquier clave que pueda nombrar** — lo único que separa los archivos de dos inquilinos (tenants) es la imprevisibilidad de la clave, lo cual no es un modelo de control de acceso. Peor aún, pueden hacer primero `GET /storage/list?prefix=`, por lo que ni siquiera tienen que adivinar las claves.

:::caution[El almacenamiento no arrancará en producción sin uno]
Las tablas están protegidas por seguridad a nivel de fila; el almacenamiento no. No hay un equivalente por objeto en el bucket, por lo que este hook *es* el modelo — y `initializeRebaseBackend` **lanza un error al iniciar** bajo `NODE_ENV=production` cuando el almacenamiento está configurado y no se ha establecido ninguno de estos:

- `storageAuthorize` — un hook, por objeto. Recomendado.
- `storagePolicies` — las reglas declaradas anteriormente.
- `storagePublicRead: true` — el bucket es genuinamente un CDN público de solo lectura.
- `storageInsecureAllowAnyAuthenticated: true` — una aplicación de un solo inquilino (single-tenant) donde se confía en cada usuario que haya iniciado sesión con cada archivo. Nombrado a propósito para leerse dos veces.

En desarrollo, en su lugar registra una advertencia, por lo que un proyecto puede equivocarse en esto y funcionar bien localmente hasta que se despliega. Un proyecto generado con scaffolding ya incluye un hook en `backend/storage.ts` — léelo antes de reemplazarlo, y ten en cuenta que modela la *biblioteca de contenido compartido* de un CMS, que no tiene la misma estructura que los archivos por usuario.
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
| `key` | Clave del objeto, con el prefijo del bucket eliminado y el recorrido de directorios saneado |
| `bucket` | Bucket resuelto (`"default"` cuando no se especifica) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, o `null` donde la ruta permite acceso anónimo |
| `storageId` | El backend con nombre, cuando la solicitud apuntó a uno — su clave canónica (`storageId=%20media` es `"media"`). Ausente para la fuente por defecto, independientemente de cómo la haya nombrado la solicitud (sin parámetro, vacío o `(default)`) |
| `data` | Acceso de lectura confiable que **omite RLS** — `data.table(slug).find(query)` / `.findById(id)`. La propiedad reside en una fila, no en el prefijo de una clave, por lo que el hook necesita un lector para responder "¿a quién pertenece este objeto?". Omite la seguridad a nivel de fila deliberadamente: este hook *es* la decisión de autorización, y tomarla a través de un lector ya restringido por los propios permisos del llamador sería circular. De solo lectura por diseño. |

Devuelve `false` para denegar con un **403**. Lanzar una excepción también deniega — una búsqueda de propiedad que falla no deja el acceso abierto.

Información importante:

- **La ruta de metadatos es donde realmente se decide el acceso de lectura.** Genera el token de descarga de corta duración y acotado a la ruta en el que confía la ruta del archivo, por lo que el hook lo restringe allí. Dos tipos de lecturas omiten el hook, por diseño. Una que lleva dicho token: el hook lo aprobó cuando se generó el token, solo para esa ruta y fuente, por lo que un hook que ahora lo rechazaría (una membresía revocada desde entonces) no lo detiene antes de que el token expire — `storageDownloadTokenTtl`, 300 segundos por defecto. Y una lectura de una clave bajo `public/` por parte de un llamador sin credenciales: el prefijo es la declaración de que cualquiera puede leerlo, incluidos visitantes anónimos y CDN. Aún se consulta sobre la lectura de un llamador que ha iniciado sesión, pero no sobre uno anónimo, por lo que un hook no puede hacer privada una clave `public/`; en su lugar, almacena el archivo fuera de `public/`. Solo esas dos lecturas lo omiten: un usuario al que tu adaptador de autenticación llame por casualidad `public` se consulta como cualquier otro.
- **Un bucket, un nombre.** En S3 y GCS, el `bucket` del hook es siempre `"default"`, incluso cuando una solicitud nombra el bucket del proveedor, el cual accede a los mismos objetos.
- **Una ruta es pública cuando la clave que nombra lo es.** El prefijo `public/` se evalúa en la clave canónica que sirve la ruta — después de extraer un segmento inicial de bucket `default/` y de simplificar `//`, `./` y una `/` inicial —, nunca en la URL tal como fue escrita. `/api/storage/file/notes://public/x.txt` nombra la clave privada `notes:/public/x.txt`, y la clave `default/public/x.txt` (a la que se accede como `/api/storage/file/default/default/public/x.txt`) se encuentra en una carpeta llamada `default`; ninguna de las dos es pública. En un hook, prueba la `key` que se te entrega con `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lee una ruta o URL del lado del cliente, y evalúa ambas como públicas.
- **`list` está restringido en el prefijo.** Listar es cómo descubres claves sobre las que nadie te informó.
- **Las subidas reanudables (TUS) se controlan en el momento de la creación**, por lo que una subida denegada no deja ningún archivo temporal atrás.
- Omitir el hook (y `storagePolicies`) no deja ninguna verificación por objeto, por lo que producción se negará a arrancar a menos que se configure `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## API keys y tokens

Una persona que ha iniciado sesión posee todos los scopes de almacenamiento, por lo que el hook y las políticas anteriores deciden por ella. Una [API key](/docs/backend/api-keys/) también necesita el scope de almacenamiento para la operación, en la fuente que la solicitud especifica: `storage:read` para descargas, metadatos y listados, `storage:write` para subidas, carpetas y cada paso de una subida reanudable, `storage:delete` para eliminaciones. El destino es el id de la fuente, y el de la fuente por defecto es `(default)`: `storage:read:(default)`, `storage:write:avatars`. Sin él, la respuesta es `403 SCOPE_MISSING`. Con él, el hook aún se ejecuta, actuando como quienquiera que represente la clave.

## Siguientes pasos

- **[Configuración de almacenamiento](/docs/backend/storage/)** — backends, endpoints y límites
- **[Claves de API](/docs/backend/api-keys/)** — los scopes que porta una clave
