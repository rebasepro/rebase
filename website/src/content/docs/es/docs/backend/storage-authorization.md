---
sourceHash: b5b66e5876dc7d9c
title: Autorización del almacenamiento
sidebar_label: Autorización del almacenamiento
description: Decide quién puede leer, escribir, eliminar o listar cada objeto de almacenamiento con storagePolicies y el hook storageAuthorize, y qué alcances de almacenamiento necesita una clave de API.
---

Las colecciones están protegidas por la seguridad a nivel de fila; un bucket no tiene un
equivalente por objeto, así que el almacenamiento se autoriza aquí. [Configuración de
Storage](/docs/backend/storage/) cubre los propios backends.

## Políticas

La forma declarativa. Una lista de patrones de ruta, que se leen sin ejecutar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una clave que no coincide con ninguna política se rechaza**, a menos que un hook `storageAuthorize` la permita: al hook solo se le pregunta cuando ninguna política coincidió, y ninguno de los dos puede restringir al otro. Toda ampliación es una línea explícita, y un error deniega en lugar de conceder.

Los patrones coinciden **por segmento, nunca por subcadena** — `public/**` no coincide con
`publicity/secret.png`:

| Patrón | Coincide con |
|---|---|
| `avatars/logo.png` | exactamente esa clave |
| `users/*/avatar.png` | exactamente un segmento donde está `*` |
| `users/:uid/**` | un segmento capturado y luego el resto — incluido nada |

`**` solo es válido como último segmento. `:name` captura un segmento y nunca
cruza una `/`; las capturas llegan como `params` en el predicado.

`allow` es `"public"` (cualquiera), `"authenticated"` (cualquier llamante con un uid), o un
predicado que recibe los parámetros capturados, el usuario, la operación y el bucket.
`operations` por defecto son las cuatro — `read`, `write`, `delete`, `list`.

Las políticas satisfacen por sí solas la protección de arranque en producción, y un patrón
mal formado hace fallar el arranque en lugar de la primera subida.

## El hook

`requireAuth` y `publicRead` son interruptores *globales*: deciden si un llamante debe haber iniciado sesión, no qué puede tocar. Sin un hook de autorización, **cualquier usuario autenticado puede leer cualquier clave que sepa nombrar** — lo único que separa los archivos de dos tenants es que la clave sea imposible de adivinar, lo cual no es un modelo de control de acceso. Peor aún, pueden hacer antes un `GET /storage/list?prefix=`, así que ni siquiera hace falta adivinar las claves.

:::caution[El almacenamiento no arrancará en producción sin uno]
Las colecciones están protegidas por la seguridad a nivel de fila; el almacenamiento no. No hay
un equivalente por objeto en el bucket, así que este hook *es* el modelo — e
`initializeRebaseBackend` **lanza una excepción al arrancar** bajo `NODE_ENV=production` cuando
el almacenamiento está configurado y no se ha definido ninguno de estos:

- `storageAuthorize` — un hook, por objeto. Recomendado.
- `storagePublicRead: true` — el bucket es de verdad un CDN público de solo lectura.
- `storageInsecureAllowAnyAuthenticated: true` — una aplicación de un solo tenant donde se confía
  en que cada usuario con sesión iniciada acceda a todos los archivos. Nombrado para leerse dos veces.

En desarrollo registra una advertencia en su lugar, de modo que un proyecto puede estar equivocado en esto y
funcionar bien en local hasta el momento de desplegarse. Un proyecto generado incluye ya un hook en
`config/storage.ts` — léelo antes de reemplazarlo, y ten en cuenta que modela
la *biblioteca de contenido compartido* de un CMS, que no tiene la misma forma que los archivos por usuario.
:::

`storageAuthorize` es el análogo en almacenamiento de las reglas de seguridad de una colección, y se ejecuta tras la autenticación en cada ruta de almacenamiento:

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
| `key` | Clave del objeto, sin el prefijo del bucket y con el recorrido de rutas (traversal) saneado |
| `bucket` | Bucket resuelto (`"default"` cuando no se especifica) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, o `null` donde la ruta permite el acceso anónimo |
| `storageId` | El backend con nombre, cuando la petición apuntaba a uno — su clave canónica (`storageId=%20media` es `"media"`). Ausente para el origen por defecto, sea cual sea la forma en que la petición lo nombró (sin parámetro, vacío o `(default)`) |
| `data` | Acceso de lectura de confianza que **omite RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La propiedad reside en una fila, no en un prefijo de clave, así que el hook necesita un lector para responder "¿quién es el propietario de este objeto?". Omite la seguridad a nivel de fila deliberadamente: este hook *es* la decisión de autorización, y tomarla a través de un lector ya restringido por los propios permisos del llamante sería circular. Solo lectura por diseño. |

Devuelve `false` para denegar con un **403**. Lanzar una excepción también deniega — una consulta de propiedad que falla no deja pasar la petición.

Conviene saber:

- **La ruta de metadatos es donde de verdad se decide el acceso de lectura.** Emite el token de descarga de corta duración y limitado a una ruta en el que confía la ruta del archivo, así que el hook la controla ahí. Dos lecturas se saltan el hook, por diseño. Una que lleva un token así: el hook la aprobó cuando se emitió el token, solo para esa ruta y ese origen, así que un hook que ahora la rechazaría (una pertenencia revocada desde entonces) no la detiene antes de que el token caduque — `storageDownloadTokenTtl`, 300 segundos por defecto. Y la lectura de una clave bajo `public/` por un llamante sin credencial: el prefijo es la declaración de que cualquiera puede leerla, incluidos visitantes anónimos y CDNs. La lectura de esa clave por un llamante con sesión iniciada sigue consultándose, pero la de uno anónimo no, así que un hook no puede volver privada una clave de `public/`; guarda el archivo fuera de `public/` en su lugar. Solo esas dos lecturas se lo saltan: a un usuario que tu adaptador de autenticación llame `public` se le consulta como a cualquier otro.
- **Un bucket, un nombre.** En S3 y GCS el `bucket` del hook es siempre `"default"`, también cuando una petición nombra el bucket del proveedor, que llega a los mismos objetos.
- **Una ruta es pública cuando lo es la clave que nombra.** El prefijo `public/` se comprueba sobre la clave canónica que sirve la ruta — después de leer un segmento de bucket `default/` inicial y de eliminar `//`, `./` y una `/` inicial — nunca sobre la URL tal como está escrita. `/api/storage/file/notes://public/x.txt` nombra la clave privada `notes:/public/x.txt`, y la clave `default/public/x.txt` (a la que se llega como `/api/storage/file/default/default/public/x.txt`) está en una carpeta llamada `default`; ninguna es pública. En un hook, comprueba la `key` que se te entrega con `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lee una ruta o URL del lado del cliente, y lee ambas como públicas.
- **`list` se controla sobre el prefijo.** Listar es la forma de descubrir claves de las que nadie te habló.
- **Las subidas reanudables (TUS) se controlan al crearse**, así que una subida denegada no deja ningún archivo temporal.
- Omitir el hook (y `storagePolicies`) no deja ninguna comprobación por objeto, así que producción se niega a arrancar a menos que se defina `storagePublicRead` o `storageInsecureAllowAnyAuthenticated`.

## Claves de API y tokens

Una persona con sesión iniciada tiene todos los alcances de almacenamiento, así que deciden por ella el hook
y las políticas de arriba. Una [clave de API](/docs/backend/api-keys/) necesita además el alcance de
almacenamiento de la operación, sobre el origen que nombra la petición: `storage:read` para
descargas, metadatos y listados, `storage:write` para subidas, carpetas y cada
paso de una subida reanudable, `storage:delete` para eliminaciones. El destino es el
id del origen, y el del origen por defecto es `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Sin él, la respuesta es `403 SCOPE_MISSING`. Con él,
el hook sigue ejecutándose, con la identidad con la que actúa la clave.

## Siguientes pasos

- **[Configuración de Storage](/docs/backend/storage/)** — backends, endpoints y límites
- **[Claves de API](/docs/backend/api-keys/)** — los alcances que lleva una clave
