---
sourceHash: 93a59ca2be100841
title: Theming e branding
sidebar_label: Theming e branding
description: Applica il tuo brand al pannello di amministrazione — colori, font, angoli, superfici, modalità chiara e scura, logo e schermata di accesso — sovrascrivendo una manciata di token CSS, senza dover riscrivere i componenti.
---

## Panoramica

Ogni elemento dell'amministrazione — il drawer, le tabelle, i form, le finestre di dialogo, Studio, la schermata di accesso — viene generato a partire da un unico set di design token in `@rebasepro/ui`. Modifica un token nel tuo foglio di stile e ogni componente che lo utilizza si adatterà di conseguenza, in entrambi i temi.

La personalizzazione del brand si articola quindi su due livelli, e raramente avrai bisogno del secondo:

1. **Token.** Colore del brand, font, raggio degli angoli e superfici sono variabili CSS che puoi sovrascrivere in `frontend/src/index.css`. Logo e nome sono prop di `<RebaseShell>`. Questo copre ciò che la maggior parte dei progetti intende con "farlo sembrare nostro".
2. **Componenti.** Quando una parte deve *comportarsi o essere disposta* in modo diverso — la tua barra dell'app personalizzata, la tua schermata di accesso — sostituiscila con un [component override](/docs/frontend/component-overrides).

## Colore del brand

Una sola riga. Inserisci un blocco `@theme` dopo le importazioni in `frontend/src/index.css`:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Tutto ciò che fa riferimento a "primary" cambierà di conseguenza: pulsanti pieni (filled), link, caselle di controllo e switch selezionati, anelli di messa a fuoco (focus ring), la riga attiva nel drawer, grafici, selezioni. I token correlati derivano da esso, quindi non è necessario impostarli manualmente:

| Token | Derivato come | Utilizzato per |
|---|---|---|
| `--color-primary-light` | più chiaro di 0,15 di luminosità OKLCH | testo di accento su sfondi scuri |
| `--color-primary-dark` | più scuro di 0,15 | stati pressed e hover |
| `--color-primary-bg` | primary con opacità al 10% | righe selezionate, sfondi colorati |
| `--color-on-primary` | bianco o nero, a seconda di quale sia leggibile sul colore primario | etichetta di un pulsante pieno, segno di spunta in una casella di controllo |

`--color-on-primary` (introdotto nella versione 0.34; prima di questa, i pulsanti pieni avevano sempre etichette bianche) è ciò che garantisce la leggibilità con brand dai colori chiari. Un colore primario giallo o lime riceve etichette nere sui pulsanti anziché bianche con un contrasto di 2:1. Il passaggio avviene con una luminosità OKLCH pari a 0,6, selezionando l'inchiostro a contrasto più elevato per quasi tutti i colori reali di brand; se il tuo si trova vicino alla soglia e preferisci l'altro inchiostro, impostalo esplicitamente:

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` e `--color-on-secondary` funzionano allo stesso modo. Il pannello di amministrazione usa a malapena il colore secondario: è pensato principalmente per la tua interfaccia utente.

## Font

L'interfaccia di amministrazione imposta il corpo del testo in `--font-sans`, i titoli in `--font-headers` e i valori misurati (id, timestamp, codice) in `--font-mono`. Installa il font, importalo una volta e associa il token ad esso:

```bash
pnpm --dir frontend add @fontsource-variable/manrope
```

```tsx no-verify
// frontend/src/App.tsx, next to the existing font imports
import "@fontsource-variable/manrope";
```

```css
@theme {
    --font-sans: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
    --font-headers: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
}
```

Rimuovi le importazioni dei font che non usi più (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), altrimenti continueranno a essere scaricati.

## Angoli

Tre valori di raggio gestiscono l'intera interfaccia utente:

| Token | Predefinito | Utilizzato per |
|---|---|---|
| `--radius-md` | `6px` | chip, riquadri di codice, riquadri piccoli |
| `--radius-lg` | `9px` | controlli, menu, evidenziazioni di riga |
| `--radius-xl` | `13px` | schede (card), finestre di dialogo, pannelli laterali (side sheet) |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Superfici

I colori di sfondo sono denominati in base al ruolo, e ogni ruolo ha un valore chiaro e uno scuro. Si tratta di normali variabili CSS anziché di token `@theme`, poiché cambiano con il tema — sovrascrivile quindi sotto `:root` per il tema chiaro e sotto `.dark` per quello scuro:

```css
/* A warmer ground in both themes */
:root {
    --surface-frame: #f4f1ec;
    --surface-sheet: #faf8f5;
}

.dark {
    --surface-frame: #0d0b09;
    --surface-sheet: #15120f;
    --surface-card: #1b1814;
}
```

| Variabile | Descrizione |
|---|---|
| `--surface-frame` | la pagina dietro ogni elemento, attorno al drawer |
| `--surface-sheet` | l'area di contenuto principale |
| `--surface-card` | schede (card), righe di tabella, pannelli dei form |
| `--surface-raised` | un controllo o pannello sollevato rispetto a una scheda |
| `--surface-lifted` | menu, popover, finestre di dialogo |
| `--surface-field` | il riempimento di un campo di testo (traslucido) |
| `--surface-hover` / `--surface-active` | riempimenti per gli stati hover e pressed (traslucidi) |
| `--surface-well` | un'area incassata per codice o log |
| `--hairline` / `--hairline-strong` | bordi e separatori (traslucidi) |

Mantieni l'ordine: in ciascun tema, frame, sheet e card dovrebbero distanziarsi visivamente l'uno dall'altro nella stessa direzione. I colori del testo sono calibrati sui valori predefiniti, quindi dopo una modifica significativa verifica il contrasto di una pagina in entrambi i temi.

## Modalità chiara e scura

Per impostazione predefinita, l'amministrazione segue il sistema operativo, mostra un selettore di tema e memorizza la scelta dell'utente.

Per distribuire un tema singolo, gestisci la modalità autonomamente. Passa a `<Rebase>` un `modeController` il cui metodo `setMode` ignora il selettore, e applica la classe corrispondente a `<html>` — con un controller personalizzato, Rebase non modificherà le classi della pagina:

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logo e nome

`<RebaseShell>` accetta il nome e il logo visualizzati nel drawer. Lo stesso logo appare nella schermata di accesso predefinita. Posiziona i file in `frontend/public/`:

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` è facoltativo. Usalo quando il tuo logo è realizzato con inchiostro scuro e risulterebbe invisibile sul tema scuro; se non impostato, `logo` viene utilizzato per entrambi.

Il titolo e l'icona della scheda del browser provengono da `frontend/index.html`:

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## La schermata di accesso

La schermata di accesso predefinita eredita il colore del brand, i font, le superfici e il `logo` della shell senza richiedere codice aggiuntivo.

Per modificarne i testi o aggiungere contenuti personalizzati, passa a `<RebaseAuth>` una `LoginView` configurata. Nel file generato `App.tsx`, `authController` è già nello scope:

```tsx
import { LoginView, RebaseAuth } from "@rebasepro/app";

<RebaseAuth loginView={
    <LoginView
        authController={authController}
        logo="/logo.svg"
        logoDark="/logo-dark.svg"
        title="Acme Ops"
        subtitle="Sign in with your work account"
        additionalComponent={<a href="https://acme.example/help">Trouble signing in?</a>}
    />
}/>
```

Altre prop: `topComponent` (sopra i pulsanti di accesso), `layout="form-first"` (senza una card propria, per una pagina che inquadra direttamente il login, come una schermata divisa a metà accanto all'immagine di un prodotto) e `disableSignupScreen`.

Per sostituire completamente la schermata, sovrascrivi `"Auth.LoginView"` (consulta [Component Overrides](/docs/frontend/component-overrides)).

## Oltre i token

- **Sostituisci una parte della shell** — la barra dell'applicazione, il drawer, una riga di navigazione, la schermata di accesso — con un [component override](/docs/frontend/component-overrides).
- **Aggiungi le tue pagine** coerenti con il tema: [Styling Custom UI](/docs/frontend/styling) illustra con quali componenti e classi realizzarle, affinché recepiscano anch'esse i tuoi token.

## Checklist

- Il colore del brand è impostato una sola volta, in `@theme`, e in nessun altro punto. Non scriverlo come valore letterale nei componenti; usa `bg-primary` / `text-primary`.
- Osserva un pulsante pieno e una casella di controllo selezionata: l'etichetta e il segno di spunta devono essere facilmente leggibili.
- Alterna il tema e controlla una tabella, un form e una finestra di dialogo in entrambe le modalità.
- Se hai sostituito i font, rimuovi le importazioni dei font predefiniti.
