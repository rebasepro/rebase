---
sourceHash: 3e18de6e2b935fc7
title: Firebase
sidebar_label: Firebase
description:"\"@rebasepro/firebase ejecuta Rebase CMS contra Firestore, Firebase Auth y Firebase Storage: un adaptador del lado del cliente, sin ningún servidor de Rebase involucrado.\""
---

`@rebasepro/firebase` apunta Rebase CMS hacia Firebase. Tus
colecciones describen documentos de Firestore, y el panel los lee y escribe
a través del SDK de Firebase.

:::caution[Experimental y estructuralmente diferente del resto de Rebase]
Este es un **adaptador del lado del cliente**. No hay ningún servidor de Rebase involucrado: el
navegador se comunica directamente con Firebase, por lo que todo lo que proporciona el backend de Rebase
(seguridad a nivel de fila, la API REST, el SDK generado, funciones, tareas cron, el
modelo de acceso al almacenamiento) no forma parte de esta configuración.

La autorización se gestiona mediante las **Reglas de seguridad de Firebase**, escritas y desplegadas en Firebase.
Las `securityRules` de Rebase en una colección no se aplican.
:::

## Instalación

```bash
pnpm add @rebasepro/firebase firebase
```

Dependencias peer: `firebase` (10, 11 o 12), `react` ≥ 19, `react-dom` ≥ 19, y
opcionalmente `typesense` para búsqueda de texto.

## Lo que te ofrece

- **`RebaseFirebaseApp`**: una aplicación de administración completa: inicio de sesión con Firebase Auth, enrutamiento
  y CRUD sobre Firestore creados a partir de las definiciones de tus colecciones.
- **Hooks por servicio**: auth, Firestore, storage, App Check, gestión de usuarios.
- **Adaptadores de búsqueda de texto**: Algolia, Typesense, Pinecone o local.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

Hay un ejemplo funcional disponible en [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## Lo que no se traslada

Todo lo que describe el **backend** de Rebase en este sitio describe la
ruta de PostgreSQL (o MongoDB), no esta:

| | |
|---|---|
| Seguridad a nivel de fila | En su lugar, Reglas de seguridad de Firebase, escritas en Firebase |
| API REST y SDK generado | No disponible: el navegador utiliza el SDK de Firebase |
| Funciones y tareas cron | En su lugar, Cloud Functions for Firebase |
| Modelo de acceso al almacenamiento | En su lugar, reglas de Firebase Storage |
| Studio, `rls-check`, migraciones | Características de Postgres; no aplicable |

## Cuándo elegirlo

Elige esta opción cuando ya tengas un proyecto de Firebase y quieras un mejor panel de administración
sobre él. Si estás eligiendo un backend en lugar de adaptarte a uno que ya tienes,
la [ruta de PostgreSQL](/docs/getting-started/quickstart/) es de la que trata el resto
de esta documentación.

## Relacionado

- [Configuración del frontend](/docs/frontend/) — el panel cuya capa de datos es reemplazada por esto
- [Autenticación e inicio de sesión](/docs/frontend/authentication/) — la interfaz de inicio de sesión, en cualquier caso
- [Definición de colecciones](/docs/collections/) — la estructura de colección que leen ambos controladores
