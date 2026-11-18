---
sourceHash: 8d29618687855b39
title: Stile della UI personalizzata
sidebar_label: Stile della UI personalizzata
description: Costruisci viste personalizzate, home page e azioni usando gli stessi componenti e token di tema del resto dell'admin, così che abbiano un aspetto nativo e seguano il tema.
---

## Panoramica

Ogni meccanismo di estensione in questa sezione ti fornisce un componente React e si fa da parte: una [custom view](/docs/frontend/extending), una [home page](/docs/frontend/component-overrides), una [entity view](/docs/frontend/entity-views), uno [slot](/docs/frontend/slots). Quello che nessuno di essi specifica è con cosa *costruirlo*.

La risposta è: con le stesse parti di cui è composto l'admin. Una vista personalizzata è pur sempre una vista dell'admin. Risiede all'interno della stessa shell, accanto alle stesse tabelle, sotto lo stesso selettore del tema; pertanto dovrebbe utilizzare gli stessi componenti, la stessa scala tipografica e gli stessi token di colore.

Questa pagina spiega come creare le tue viste. Per modificare l'aspetto dell'admin stesso (colore del brand, font, angoli, logo), consulta [Theming & Branding](/docs/frontend/theming); poiché le tue viste utilizzano gli stessi token, seguiranno anch'esse queste modifiche.

L'alternativa è inventare un secondo design language all'interno della stessa app. Questo è l'errore più comune e non si limita a sembrare incoerente: si rompe. Un `color: #111` scritto a mano diventa invisibile nel momento in cui qualcuno passa al tema scuro, e nessun test se ne accorge.

## La regola

**Importa i componenti da `@rebasepro/ui`. Ricorri a un semplice `<div>` e a una classe solo per il layout.**

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

Ogni componente del kit è catalogato in [UI components](/docs/ui/components/card/) con le sue prop reali, generate dal codice sorgente. Controlla lì prima di creare qualcosa da zero: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` e circa altri settanta sono già disponibili.

## Colore: usa i token, mai valori letterali

Il tema è un insieme di variabili CSS esposte come utility Tailwind. Usale e associa a ogni valore chiaro uno `dark:`:

| Utilizzo | Classe |
|---|---|
| Testo del corpo | `text-surface-900 dark:text-surface-100` |
| Testo secondario | `text-surface-600 dark:text-surface-400` — oppure semplicemente `<Typography color="secondary">` |
| Sfondo del pannello | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordi | `border-surface-200 dark:border-surface-700` |
| Accento | `text-primary` / `bg-primary` (il colore del brand del progetto, `#0070F4` per impostazione predefinita) |
| Testo su riempimento d'accento | `text-on-primary` — bianco o nero, a seconda di quale sia leggibile sul colore del brand |

Due regole nate da problemi reali:

- **Non scrivere mai un colore letterale.** `#111`, `rgba(128,128,128,.28)`, `white`: ciascuno di essi è corretto in un solo tema. Una pagina i cui numeri avevano `color: var(--fg, #111)` veniva renderizzata nero su nero per ogni utente in tema scuro, mentre sembrava perfetta a chi l'aveva scritta.
- **Non impostare mai un colore che un componente imposta già.** `<Typography>` sceglie il colore di primo piano corretto per il tema. Sovrascriverlo con una classe è il modo in cui un'intestazione finisce per essere l'unico elemento della pagina a ignorare il tema.

## Tipografia: usa la scala

`Typography` include l'intera scala: `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `lead`, `caption`, `label`, `button`, `stat`, `micro`, `mono`. Usa `variant`, non una classe per la dimensione del font. La scala codifica già il tracking richiesto da ciascun livello (`--tracking-display` a ≥30px, `--tracking-title` a 20–24px, `--tracking-heading` al di sotto), cosa che un `text-[27px]` non fa.

La UI di prodotto non scende mai sotto `text-xs`, con una sola eccezione: la variante `micro`, l'etichetta maiuscola sopra un valore, è basata su `text-2xs`. Il livello `text-3xs` esiste solo per le pagine di marketing.

## Configurazione

La UI personalizzata richiede il CSS del tema e Tailwind puntati sui pacchetti, altrimenti le classi di utilità utilizzate *all'interno* di `@rebasepro/ui` non verranno mai generate:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` scrive questo per te. Se la tua vista personalizzata viene renderizzata priva di stile, questa è la prima cosa da verificare.

## Checklist

Prima di rilasciare una vista personalizzata:

- Nessun colore letterale: ogni colore è un token o proviene da un componente.
- Ogni `bg-`, `text-` e `border-` ha una controparte `dark:`.
- Il testo usa `<Typography variant=…>`, non una classe per la dimensione del font.
- I contenitori sono `Card` / `Paper`, non un `<div>` con un bordo scritto a mano.
- Cambia tema e osserva la pagina. Questo è tutto il test, e richiede cinque secondi.
