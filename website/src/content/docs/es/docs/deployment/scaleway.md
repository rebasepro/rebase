---
sourceHash: a83732a379b7739b
title: Despliegue de Rebase en Scaleway
description: Aprende a desplegar Rebase en Scaleway para una infraestructura en la nube segura y con base en Francia utilizando Contenedores Serverless.
sidebar_label: Scaleway
---

Scaleway es un proveedor de nube europeo de primer nivel con sede en Francia y centros de datos en París, Ámsterdam y Varsovia. Es una excelente opción para organizaciones que priorizan la soberanía de datos de la UE.

Recomendamos utilizar la **Base de Datos Gestionada** de Scaleway para un respaldo fiable de Postgres y los **Contenedores Serverless** para escalar dinámicamente la aplicación Node.js de Rebase.

## 1. Crear una Base de Datos Postgres Gestionada

Las Bases de Datos Gestionadas de Scaleway ofrecen copias de seguridad automáticas y alta disponibilidad.

**No hay ninguna imagen de aplicación que construir a partir de tu código**. `rebase build` produce un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y —si tu proyecto declara una app estática— tu frontend construido. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Serverless Containers extrae desde un registro, así que hornea el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Actualizar Rebase más adelante es un cambio en esa línea `FROM`. Tu bundle queda intacto.

1. En la Consola de Scaleway, ve a **PostgreSQL**.
2. Haz clic en **Crear una Instancia de Base de Datos**.
3. Elige una Región (ej., París - `PAR1`).
4. Selecciona un Tipo de Nodo (un **Play2-Pico** o **Pro2-XXS** estándar funciona bien).
5. Añade un nombre de base de datos (`rebase_db`) y define una contraseña de usuario increíblemente segura.
6. Una vez desplegada, anota la **cadena de conexión** (URI) del panel de control. Tendrá el siguiente formato:
   `postgres://user:password@ip:port/rebase_db`

## 2. Construir y Empujar el Contenedor

Los Contenedores Serverless de Scaleway ejecutan imágenes Docker estándar. Primero, construye el backend de Rebase localmente y empújalo al Registro de Contenedores de Scaleway.

1. Ve a **Container Registry** en la Consola de Scaleway y crea un Namespace (ej., `rebase-apps`).
2. Inicia sesión en el registro desde tu terminal local utilizando las instrucciones proporcionadas.
3. Compila y envía desde la raíz del proyecto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
```

Construye desde la raíz del proyecto — el Dockerfile del backend necesita todo el workspace como contexto de compilación (copia `pnpm-workspace.yaml`, `backend/` y `config/`), por lo que usar `./backend` como contexto falla.

4. Empuja la imagen:

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Desplegar Contenedor Serverless

Ahora despliega la imagen completamente serverless sin gestionar infraestructura.

1. Navega a **Serverless Containers**.
2. Haz clic en **Crear un Contenedor**.
3. Elige la imagen que acabas de empujar desde el Registro de Contenedores.
4. Establece el Puerto en **3001**.
5. En Variables de Entorno, añade lo siguiente de forma segura:

| Clave | Valor |
|-----|-------|
| `DATABASE_URL` | La URI de tu paso de Postgres Gestionado |
| `JWT_SECRET` | Una cadena aleatoria segura de 32+ caracteres para firmar tokens de autenticación |
| `NODE_ENV` | `production` |

6. Haz clic en **Desplegar Contenedor**.

Scaleway aprovisionará inmediatamente el contenedor y te proporcionará una URL de endpoint público (ej., `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

## 4. Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de tus propias colecciones **no se crean automáticamente**. Debes aplicar el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omites este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta.

Ejecútalo desde un checkout del proyecto o desde CI con `DATABASE_URL` apuntando a la base de datos de producción, **no dentro del contenedor**: la imagen de producción se distribuye sin la CLI. Usa la cadena de conexión (URI) de tu instancia de Base de Datos Gestionada y asegúrate de que tu IP esté permitida en las ACL de la base de datos mientras ejecutas el comando.

Para migraciones versionadas, usa `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

*Nota: Para un cumplimiento estricto de los datos, verifica que los detalles de tu Organización de Scaleway reflejen tu entidad corporativa europea.*

---
