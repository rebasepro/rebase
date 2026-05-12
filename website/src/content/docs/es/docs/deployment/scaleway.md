---
title: Despliegue de Rebase en Scaleway
description: Aprende a desplegar Rebase en Scaleway para una infraestructura en la nube segura y con base en Francia utilizando Contenedores Serverless.
sidebar_label: Scaleway
---

Scaleway es un proveedor de nube europeo de primer nivel con sede en Francia y centros de datos en París, Ámsterdam y Varsovia. Es una excelente opción para organizaciones que priorizan la soberanía de datos de la UE.

Recomendamos utilizar la **Base de Datos Gestionada** de Scaleway para un respaldo fiable de Postgres y los **Contenedores Serverless** para escalar dinámicamente la aplicación Node.js de Rebase.

## 1. Crear una Base de Datos Postgres Gestionada

Las Bases de Datos Gestionadas de Scaleway ofrecen copias de seguridad automáticas y alta disponibilidad.

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
3. Construye tu aplicación Rebase usando el `Dockerfile` generado:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest ./backend
```

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

*Nota: Para un cumplimiento estricto de los datos, verifica que los detalles de tu Organización de Scaleway reflejen tu entidad corporativa europea.*

---
