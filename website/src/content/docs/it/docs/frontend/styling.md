---
title: Stilizzare la UI personalizzata
sidebar_label: Stilizzare la UI personalizzata
description: Costruisci viste personalizzate, home page e azioni a partire dagli stessi componenti e token di tema del resto dell'admin, in modo che appaiano native e rispettino il tema.
---

## Panoramica

Ogni meccanismo di estensione in questa sezione ti fornisce un componente React e si fa da parte: una [custom view](/docs/frontend/extending), una [home page](/docs/frontend/component-overrides), una [entity view](/docs/frontend/entity-views), uno [slot](/docs/frontend/slots). Ciò che nessuno di essi specifica è *con cosa costruirlo*.

La risposta è: con le stesse parti di cui è composto l'admin. Una vista personalizzata è pur sempre una vista dell'admin. Si trova all'interno della stessa shell, accanto alle stesse tabelle, sotto lo stesso selettore del tema — dovrebbe quindi utilizzare gli stessi componenti, la stessa scala tipografica e gli stessi token di colore.

L'alternativa è inventare un secondo linguaggio di design all'interno della stessa app. Questo è l'errore più comune, e non solo appare incoerente: si rompe. Un `color: #111` scritto a mano diventa invisibile nel momento in cui qualcuno passa al tema scuro, e nessun test lo rileva.

## La regola

**Importa i componenti da `@rebasepro/ui`. Ricorri a un `<div>` puro e a una classe solo per il layout.**

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

Ogni componente del kit è catalogato sotto [UI components](/docs/ui/components/Card) con le sue prop reali, generate dal codice sorgente. Controlla lì prima di crearlo da zero: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` e circa altri quaranta esistono già.

## Colore: usa i token, mai valori letterali

Il tema è un insieme di variabili CSS esposte come utility Tailwind. Usale e abbina a ogni valore chiaro uno `dark:`:

| Utilizzo | Classe |
|---|---|
| Testo principale | `text-surface-900 dark:text-surface-100` |
| Testo secondario | `text-surface-600 dark:text-surface-400` — o semplicemente `<Typography color="secondary">` |
| Sfondo del pannello | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordi | `border-surface-200 dark:border-surface-700` |
| Accento | `text-primary` / `bg-primary` (`#0070F4`) |

Due regole che derivano da problemi reali riscontrati:

- **Non scrivere mai un valore di colore letterale.** `#111`, `rgba(128,128,128,.28)`, `white` — ognuno di essi è corretto esattamente in un solo tema. Una pagina i cui numeri erano impostati come `color: var(--fg, #111)` è risultata nero su nero per ogni utente con tema scuro, mentre sembrava perfetta a chi l'aveva scritta.
- **Non impostare mai un colore che un componente imposta già.** `<Typography>` sceglie il colore di primo piano corretto per il tema. Sovrascriverlo con una classe è il motivo per cui un'intestazione finisce per essere l'unico elemento della pagina a ignorare il tema.

## Tipografia: usa la scala

`Typography` include l'intera scala: `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `caption`, `label`. Usa `variant`, non una classe per la dimensione del font. La scala include già la spaziatura (tracking) necessaria per ogni livello (`--tracking-display` a ≥30px, `--tracking-title` a 20–24px, `--tracking-heading` al di sotto), cosa che un `text-[27px]` non fa.

La UI di prodotto non scende sotto `text-xs`. I livelli `text-2xs` e `text-3xs` esistono solo per le pagine di marketing.

## Configurazione

La UI personalizzata richiede che il CSS del tema e Tailwind siano puntati verso i pacchetti, altrimenti le classi di utilità utilizzate *all'interno* di `@rebasepro/ui` non verranno mai generate:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` scrive questo per te. Se la tua vista personalizzata viene visualizzata senza stili, questa è la prima cosa da controllare.

## Checklist

Prima di rilasciare una vista personalizzata:

- Nessun valore di colore letterale: ogni colore è un token o proviene da un componente.
- Ogni `bg-`, `text-` e `border-` ha una controparte `dark:`.
- Il testo è `<Typography variant=…>`, non una classe per la dimensione del font.
- I contenitori sono `Card` / `Paper`, non un `<div>` con un bordo scritto a mano.
- Cambia il tema e guarda la pagina. Questo è l'intero test e richiede cinque secondi.

---
