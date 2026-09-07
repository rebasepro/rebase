---
sourceHash: 8721ee795ebd8dce
title: Estilizar UI personalizada
sidebar_label: Estilizar UI personalizada
description: Construye vistas personalizadas, páginas de inicio y acciones con los mismos componentes y tokens de tema que el resto del panel de administración, para que se vean nativos y sigan el tema.
---

## Descripción general

Cada mecanismo de extensión en esta sección te entrega un componente de React y se aparta de tu camino: una [vista personalizada](/docs/frontend/extending), una [página de inicio](/docs/frontend/component-overrides), una [vista de entidad](/docs/frontend/entity-views), un [slot](/docs/frontend/slots). Lo que ninguno de ellos dice es *a partir de qué construirlo*.

La respuesta es: las mismas partes con las que está construido el panel de administración. Una vista personalizada sigue siendo una vista de administración. Se encuentra dentro del mismo contenedor, junto a las mismas tablas, bajo el mismo selector de tema, por lo que debería usar los mismos componentes, la misma escala tipográfica y los mismos tokens de color.

La alternativa es inventar un segundo lenguaje de diseño dentro de la misma aplicación. Ese es el fallo común, y no solo se ve inconsistente: se rompe. Un `color: #111` escrito a mano se vuelve invisible en el momento en que alguien cambia al tema oscuro, y ningún test lo detecta.

## La regla

**Importa componentes desde `@rebasepro/ui`. Recurre a un `<div>` básico y a una clase solo para el layout.**

```tsx
import { Alert, Button, Card, Chip, Typography } from "@rebasepro/ui";

export function DashboardView() {
    return (
        <div className="p-8 max-w-5xl mx-auto flex flex-col gap-8">
            <Typography variant="h4">Outreach</Typography>
            <Typography variant="body2" color="secondary">
                What ran last night, and what is waiting for you.
            </Typography>

            <Card className="p-4 flex flex-col gap-1">
                <Typography variant="h5" className="mb-0 tabular-nums">128</Typography>
                <Typography variant="subtitle2" className="mb-0">Signals</Typography>
                <Typography variant="caption" color="secondary" className="mb-0">12 approved</Typography>
            </Card>

            <Alert color="warning">Delivery is not configured, so nothing can be sent.</Alert>
        </div>
    );
}
```

Cada componente del kit está catalogado en [UI components](/docs/ui/components/card/) con sus props reales, generadas a partir del código fuente. Consulta allí antes de crearlos manualmente: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` y unos cuarenta más ya existen.

## Color: usa tokens, nunca literales

El tema es un conjunto de variables CSS expuestas como utilidades de Tailwind. Úsalas y combina cada valor claro con uno `dark:`:

| Uso | Clase |
|---|---|
| Texto del cuerpo | `text-surface-900 dark:text-surface-100` |
| Texto secundario | `text-surface-600 dark:text-surface-400` — o simplemente `<Typography color="secondary">` |
| Fondo de panel | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordes | `border-surface-200 dark:border-surface-700` |
| Acento | `text-primary` / `bg-primary` (`#0070F4`) |

Dos reglas que surgen de errores reales:

- **Nunca escribas un literal de color.** `#111`, `rgba(128,128,128,.28)`, `white`: cada uno es correcto en exactamente un tema. Una página cuyos números eran `color: var(--fg, #111)` se renderizó en negro sobre negro para todos los usuarios del tema oscuro, y se veía perfecta para la persona que la escribió.
- **Nunca definas un color que un componente ya define.** `<Typography>` selecciona el primer plano adecuado para el tema. Sobrescribirlo con una clase es la forma en que un encabezado termina siendo el único elemento en la página que ignora el tema.

## Tipografía: usa la escala

`Typography` incluye toda la escala: `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `caption`, `label`. Usa `variant`, no una clase de tamaño de fuente. La escala ya codifica el tracking que cada nivel necesita (`--tracking-display` en ≥30px, `--tracking-title` en 20–24px, `--tracking-heading` por debajo de eso), algo que un `text-[27px]` no hace.

La UI de producto no baja de `text-xs`. Los niveles `text-2xs` y `text-3xs` existen únicamente para páginas de marketing.

## Configuración

La UI personalizada necesita que el CSS del tema y Tailwind apunten a los paquetes, o las clases de utilidad utilizadas *dentro* de `@rebasepro/ui` nunca se generarán:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` escribe esto por ti. Si tu vista personalizada se renderiza sin estilos, esto es lo primero que debes comprobar.

## Checklist

Antes de publicar una vista personalizada:

- Sin literales de color: cada color es un token o proviene de un componente.
- Cada `bg-`, `text-` y `border-` tiene una contraparte `dark:`.
- El texto es `<Typography variant=…>`, no una clase de tamaño de fuente.
- Los contenedores son `Card` / `Paper`, no un `<div>` con un borde escrito a mano.
- Alterna el tema y observa la página. Esa es toda la prueba, y toma cinco segundos.

---
