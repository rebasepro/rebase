---
slug: docs/changelog
title: Registro modifiche
---
## [3.1.0] - 2026-02-20

- **Integrazione AI**:
  - Introdotte funzionalità di generazione di collezioni e miglioramento dei dati basate sull'IA.
  - Aggiunta nuova icona AI e integrate le capacità AI nell'editor di collezioni.
- **Vista Kanban**:
  - Aggiunto supporto completo per le bacheche Kanban con colonne personalizzabili.
  - Implementato il riordino delle colonne tramite drag-and-drop e aggiornamenti ottimistici.
  - Aggiunte opzioni di configurazione Kanban, inclusi i colori delle colonne.

- **Funzionalità delle Collezioni**:
  - Aggiunta la vista `display` all'editor di collezioni.
  - Implementato il riordino delle colonne tramite drag-and-drop nelle tabelle dati con persistenza.
  - Migliorata l'inferenza delle collezioni con parametri di filtro e ordinamento opzionali.
- **Miglioramenti UI/UX**:
  - Aggiunto il Toggle della Modalità di Visualizzazione (Elenco, Griglia, Tabella) per un migliore controllo della visualizzazione dei dati.
  - Implementati gruppi di navigazione del cassetto a scomparsa.
  - Aggiunto il supporto per modale a schermo intero per il Cookie Banner.
  - Armonizzati i colori dei pulsanti e ridisegnati i componenti Tab.
  - Sostituita `AutorenewIcon` con `FindInPageIcon` per una maggiore chiarezza.
  - Abilitato un comportamento di scorrimento fluido.
- **Storage**:
  - Aggiunto supporto per URL di storage completamente qualificati.
  - Aggiunte opzioni `includeBucketUrl` e `imageResize` per i caricamenti di file.
- **Gestione Utenti**:
  - Aggiunto il metodo `updateUserFields` per aggiornamenti diretti di Firestore.
- **Correzioni**:
  - Aggiornata la dipendenza Firebase alla v12.7.0.
  - Aggiornamenti di sicurezza per Next.js (CVE-2025-66478).
  - Corretti bug di validazione degli autovalori delle date.
  - Corretti problemi con la fusione di oggetti e le modifiche locali.
  - Migliorata l'integrazione della ricerca testuale con Typesense.
  - Corretto layout e stile in FormEnhanceAction.

## [3.0.0] - 2025-12-01

- **Miglioramenti dell'Editor**:
  - Migliorato il comportamento del tasto escape nel comando slash dell'editor.
  - Migliorato il comportamento del menu dei suggerimenti.
  - Migliorata la gestione dei suggerimenti di percorso nei componenti dell'editor di collezioni.
  - Refactor dei suggerimenti della collezione radice.
- **Miglioramenti UI/UX**:
  - Aggiunta la funzione `prettifyIdentifier` per formattare gli identificatori e migliorare la leggibilità.
  - Refactor della formattazione delle chiavi per utilizzare prettifyIdentifier.
  - Piccoli aggiustamenti UI in tutta l'applicazione.
  - Piccolo aggiornamento visivo ai dialoghi.
  - Rimosso font-mono dall'anteprima della mappa.
- **Editor di Collezioni**:
  - Aggiunta la modifica delle prop in linea all'editor di collezioni.
  - Correzioni per il salvataggio delle proprietà dell'editor di collezioni.
  - Applicato un comportamento coerente alle prop `editable` nelle collezioni e proprietà.
- **Aggiornamenti API**:
  - Aggiornati gli URL del server API per utilizzare nuovi endpoint.
- **Dipendenze**:
  - Molti aggiornamenti delle dipendenze.
  - Aggiunta la configurazione PostCSS con Tailwind CSS e Autoprefixer.
- **Gestione Utenti**:
  - Refactor della gestione utenti per utilizzare in modo coerente `saas_uid` e `firebase_uid`.
  - Aggiornati gli stili dei pulsanti in EnableAuthView per coerenza.
  - Refactor dei moduli utente per migliorare il layout e la gestione dello stato.
- **Configurazione Progetto**:
  - Aggiornata la gestione della configurazione del progetto per tenere conto dello stato della prova.
  - Aggiunta schermata di caricamento iniziale.
- **Correzioni**:
  - Corretti problemi di DND della home.
  - Corretta l'anteprima delle modifiche locali nelle azioni di riga.
  - Corretto il diff delle modifiche locali.
  - Corrette le date che perdevano il focus durante la digitazione e quando si selezionavano valori nulli nei filtri data.
  - Corretto il glitch UI dei filtri enum di selezione.
  - Corrette le viste di entità a schermo intero con caratteri codificati nel loro ID.
- **Archiviazione e Immagini**:
  - Aggiunte nuove capacità di ridimensionamento delle immagini.
  - Sostituita la libreria di compressione interna con compressor.js.
  - Migliorato il messaggio di errore quando Firebase Storage probabilmente non è abilitato.
- **Miglioramento Dati**:
  - Aggiustata l'estetica del miglioramento dei dati.
- **Gestione Moduli**:
  - Visualizzazione degli errori pre-salvataggio nella vista tabella.
  - Migliorato il focus sugli errori quando si salva un modulo con errori e feedback.
  - Debouncing sui cambiamenti di valore in Formex.
  - Aggiunto `initialTouched` al controller Formex.
  - Modificato il modo in cui i valori sporchi vengono persistiti nell'archiviazione locale.
- **Modifiche Locali**:
  - Aggiunto `enableLocalChangesBackup` alle collezioni, consentendo agli utenti di disabilitare la copia locale delle entità non salvate nel browser.
  - Modificato il modo in cui le modifiche locali possono essere applicate manualmente.
  - Eliminato l'indicatore di modifiche non salvate se la funzione non è abilitata nelle collezioni.
- **Cronologia Entità**:
  - Aggiunto un tipo più pulito al plugin di cronologia entità.


## [3.0.0-rc.4] - 2025-11-25

- Refactor dei moduli utente per migliorare il layout e la gestione dello stato.
- Aggiornata la gestione della configurazione del progetto per tenere conto dello stato della prova.
- Molti aggiornamenti delle dipendenze.

## [3.0.0-rc.3] - 2025-11-07

- Visualizzazione degli errori pre-salvataggio nella vista tabella.
- Corretti problemi di DND della home.
- Aggiunte nuove capacità di ridimensionamento delle immagini e sostituita la libreria di compressione interna con compressor.js.
- Migliorato il messaggio di errore quando Firebase Storage probabilmente non è abilitato.
- Piccolo aggiornamento visivo ai dialoghi.
- Aggiunta la modifica delle prop in linea all'editor di collezioni.
- Correzioni per il salvataggio delle proprietà dell'editor di collezioni e applicazione di un comportamento coerente alle prop `editable` nelle collezioni e proprietà.
- Corretto il glitch UI dei filtri enum di selezione.
- Corrette le date che perdevano il focus durante la digitazione e quando si selezionavano valori nulli nei filtri data.
- Corretta l'anteprima delle modifiche locali nelle azioni di riga.
- Rimosso font-mono dall'anteprima della mappa.
- Corretto il diff delle modifiche locali.
- Aggiunto un tipo più pulito al plugin di cronologia entità.
- Modificato il modo in cui le modifiche locali possono essere applicate manualmente.
- Aggiunto `enableLocalChangesBackup` alle collezioni, consentendo agli utenti di disabilitare la copia locale delle entità non salvate nel browser.
- Debouncing sui cambiamenti di valore in Formex e aggiunto `initialTouched` al controller Formex.
- Modificato il modo in cui i valori sporchi vengono persistiti nell'archiviazione locale.
- Migliorato il focus sugli errori quando si salva un modulo con errori e feedback.

## [3.0.0-rc.2] - 2025-10-16

- **Gestione Utenti in Rebase Core**: Aggiunte capacità di gestione utenti direttamente a Rebase Core, espandendo le opzioni self-hosted.
- **Campi Utente come Valori Stringa**: Pienamente implementato il supporto per i campi utente come valori stringa, migliorando la flessibilità nella gestione dei dati utente.
- **Migrazione TipTap V3**: Migrato l'editor markdown a TipTap V3 per prestazioni e funzionalità migliorate.
- **Retrofit Tailwind 4**: Multipli adattamenti per supportare il retrofit di Tailwind 4, modernizzando l'infrastruttura di stile.
- **Miglioramenti del Login**:
  - Implementato il login Cloud tramite email.
  - Aggiunta l'autenticazione tramite email e password a Cloud SaaS.
  - Aggiunti eventi analitici di login.
  - Corretto il layout del login demo.
- **Aggiornamenti Sito Web**:
  - Aggiunto il sito di atterraggio Astro (WIP).
  - Aggiornamenti della migrazione del sito web.
  - Immagini migrate.
  - CSS in linea del sito web.
  - Aggiornamenti del web design.
  - Ritocchi alla pagina di sicurezza.
- **Miglioramenti della Home Page**:
  - Archiviazione dello stato collassato della home page nell'archiviazione locale.
  - Tentativo di correzione per la ridenominazione dei gruppi nella home page.
  - Revertite alcune modifiche drag-and-drop.
- **Correzioni**:
  - Corretto il supporto SSR (Server-Side Rendering) dell'editor.
  - Corretta l'importazione di riferimenti con database secondari.
  - Corretto il supporto per i riferimenti a database secondari.
  - Corretta la vista delle autorizzazioni SaaS.
  - Corretto l'input del filtro per i numeri quando il valore è 0.
  - Migliore gestione degli errori per il doctor (strumento diagnostico).
- **UI/UX**:
  - Rimosso il pulsante forzato della collezione genitore.
- **Dipendenze**: Aggiornate le dipendenze del template.
- **Documentazione**:
  - Migliorata la documentazione per le icone personalizzate nelle collezioni.
  - Aggiunta documentazione sull'autenticazione.
  - Aggiunta sezione informazioni sulla sicurezza.

## [3.0.0-rc.1] - 2025-09-25

- **Aggiornamento Firebase 12**: Aggiornato a Firebase 12 per prestazioni e funzionalità migliorate.
- **Miglioramenti del Plugin Cronologia**:
  - Aggiunto il tracciamento dei valori precedenti al plugin cronologia.
  - Aggiunta la creazione programmatica di voci di cronologia.
- **Miglioramenti delle Proprietà di Riferimento**:
  - Aggiunta la configurazione del riferimento come campo stringa.
  - Corretto il problema delle colonne aggiuntive non visualizzate nella selezione dei riferimenti.
  - Corretto il problema delle proprietà di riferimento non renderizzate correttamente senza percorso ma con un campo personalizzato.
- **Aggiornamenti UI**:
  - Aggiornata l'icona SaaS predefinita.
  - Aggiornamenti colore pulsanti.
  - Sezioni della home che si collassano.
  - Piccoli aggiornamenti web e rimosso Algolia DocSearch.
- **Correzioni**:
  - Corretto problema di login con Google Cloud.
  - Corretto l'errore che si verificava tornando dalla vista di sottoscrizione.
  - Corretto il salvataggio del progetto recente.
  - Corrette le importazioni TipTap.
  - Corretto il passaggio corretto di gclid all'app.
  - Correzione CLS (Cumulative Layout Shift) del sito web.
- **CLI**: Aggiunte istruzioni npm alla CLI.
- **Dipendenze**: Vari aggiornamenti e pulizie delle dipendenze.
- **Documentazione**: Corretto un errore di battitura in custom_previews.md.
- **Import/Export**: Pulite le importazioni.
- **Gestione Ruoli**: Aggiunta la possibilità di impostare i ruoli programmaticamente nel codice.

## [3.0.0-beta.15] - 2025-08-18

- **Funzione Sondaggio**: Aggiunto un sondaggio utente iniziale con tracciamento analitico per migliorare l'esperienza utente e raccogliere feedback.
- **Miglioramenti delle Azioni Entità**:
  - Aggiunto registro azioni entità per una migliore organizzazione.
  - Aggiunto contesto del modulo alle azioni entità.
  - Le azioni entità ora disponibili in modalità a schermo intero.
  - Migliorata la pagina delle azioni entità.
- **Gestione Abbonamenti**:
  - Aggiunto link al portale Stripe per una facile gestione degli abbonamenti.
  - Migliorata la vista abbonamento nelle impostazioni del progetto.
  - Aggiunta la possibilità di cambiare metodo di pagamento.
  - Aggiunti eventi analitici per il successo o il fallimento dell'abbonamento.
  - Aggiornamenti prezzi.
- **Miglioramenti della Home Page**:
  - Aggiunta funzionalità drag and drop alle sezioni della home page.
  - Reintrodotta la vista vuota predefinita nella home page.
  - Implementato il comportamento di drop del gruppo.
  - Aggiunta la possibilità di rinominare i gruppi.
  - Le collezioni possono ora essere modificate all'interno della vista di modifica dell'entità.
  - Corretto il problema di re-rendering della ricerca nella home page.
- **Miglioramenti UI/UX**:
  - Cambiati i pulsanti predefiniti da colore primario a neutro.
  - Aggiunta la dimensione più piccola per gli switch.
  - Aggiornato il gradiente dello sfondo dell'eroe.
  - Aggiornamenti di stile minori.
  - Aggiunto toggle valuta nella pagina dei prezzi.
  - Rese più piccole le icone delle collezioni.
  - Ottimizzazioni mobile della landing page.
  - Aggiunta una piccola animazione alle viste di login.
  - Aggiornato il logo.
  - Piccoli aggiornamenti visivi del drawer.
- **Analitiche**:
  - Aggiunto il tracciamento delle campagne all'analisi.
  - Aggiunti eventi analitici della landing.
  - Aggiunti eventi analitici per i sondaggi.
- **Aggiornamenti Componenti**:
  - Cambiate le prop di classe Alert.
  - Aggiunto `viewportClassName` al componente Select.
  - Aggiornamento visivo del caricamento file.
  - Consentito l'uso di componenti React come icone.
  - Aggiunti `previous values` al plugin cronologia.
  - Consentito di disabilitare il focus nei dialoghi.
- **Performance e Correzioni Bug**:
  - Corretta la dimensione del pulsante di caricamento.
  - Corrette le entità che diventavano sporche alla creazione a causa del campo markdown.
  - Corretto il bug di filtraggio per valori nulli.
  - Corretto l'errore useMemo con argomenti che cambiano.
  - Corretto il bug dei percorsi id.
  - Corretto l'ordine delle collezioni unite.
  - Ottimizzazioni delle prestazioni e correzioni bug DND (drag and drop).
  - Corretta la gestione del percorso dei gruppi di collezioni.
- **Campi Personalizzati**: Migliorata la pagina dei campi personalizzati.
- **Correzione Dialogo Riferimento**: Corretto il problema di ordinamento del dialogo riferimento quando i filtri sono applicati nella collezione principale.
- **Demo Prodotto**: Migliorata l'azione demo di sincronizzazione del prodotto.
- **Aggiornamenti Web**:
  - Aggiornamenti del web design.
  - Ottimizzazioni web mobile.
  - Migliorata la funzione getPath.
  - Aggiunti attributi dati al componente Button.
- **Documentazione**: Migliorata la pipeline di generazione di llms.txt.
- **Docusaurus**: Aggiornamento versione.

## [3.0.0-beta.14] - 2025-04-17

- **Toggle Vista JSON**: Aggiunto toggle nella vista editor di collezioni per accedere ai dati JSON grezzi.
- **Coerenza UI**: Migliorata la coerenza dell'interfaccia utente per i componenti select e multiselect.
- **Miglioramenti Moduli**: Migliorato il ridimensionamento dei campi del modulo popup e la gestione dei bordi.
- **Plugin Cronologia Entità**: Aggiunta funzionalità di tracciamento della cronologia a Rebase Cloud e Rebase PRO.
- **Correzioni**:
  - Corretto il troncamento del testo nei titoli delle entità.
  - Corretti gli errori visualizzati in modo errato in array di mappe.
  - Corretti i pulsanti di troncamento.
  - Corrette le entità di sola lettura che venivano oscurate dalla barra inferiore.
  - Corretto il colore del testo dell'overlay in modalità scura.
  - Corretti gli errori che non venivano cancellati nell'editor di collezioni.
  - Corretto mergeDeep per gestire correttamente i casi null.
  - Corretto il reset dello scroll sull'asse x alla paginazione.
  - Reintrodotta l'indicazione di errore della cella della tabella.
- **Drag and Drop**: Sostituito `@hello-pangea/dnd` con `@dnd-kit` per migliori prestazioni e flessibilità.

## [3.0.0-beta.13] - 2025-04-11

- **Anteprima JSON**: Aggiunta la scheda anteprima JSON alle entità, fornendo una vista dati grezza. Può essere disabilitata con la prop `disableJsonTab`.
- **Miglioramenti TextField**: Aggiunte le prop `maxRows` e `minRows` al componente TextField per un migliore controllo degli input multilinea.
- **AuthController in PropertyBuilder**: Aggiunto `authController` alla callback PropertyBuilder, consentendo l'accesso al contesto di autenticazione.
- **Miglioramenti Storage**: Aggiunto `processFile` alle proprietà di storage per il pre-processing dei file prima del caricamento.
- **Moduli Secondari**: I moduli secondari sono ora sempre renderizzati, anche se disabilitati, per una migliore coerenza.
- **Miglioramenti UI**:
  - Regolate le dimensioni dei campi piccoli e piccolissimi per una migliore gerarchia visiva.
  - Aggiornato lo stile del colore neutro del pulsante.
  - Migliorato il layout per ID entità lunghi.
  - Varie piccole modifiche al layout.
- **Correzioni**:
  - Corretto il campo di riferimento dell'array con un pulsante aggiungi errato.
  - Corrette le sottocollezioni che non risolvevano correttamente il percorso.
  - Corretta la sottocollezione complessa con bug di navigazione alias.
  - Corretta la funzionalità di esportazione quando flatten arrays è falso (le virgolette doppie sono ora correttamente escapeate).
  - Corretti problemi di selezione enum di CollectionDetailsForm.
  - Corretto un bug nella creazione di entità.
  - Corretto l'aggiornamento URL per le entità con vista selezionata predefinita.
  - Corretti i valori che non si resettavano correttamente.
  - Corrette le viste di entità di sola lettura che mancavano di schede.
  - Corretto un bug relativo al camel case.
- **Demo**: Aggiunta dimostrazione del componente MultiSelect.

## [3.0.0-beta.12] - 2025-03-13

- **Viste di entità a schermo intero**: Ora puoi aprire le entità in una vista a schermo intero. Questo è utile quando desideri
  concentrarti sull'entità che stai modificando. Puoi abilitare questa funzione impostando la prop `openEntityMode` su `full_screen`
  nella vista collezione. La modalità predefinita continua ad essere `side_panel`. C'è stata una grande riorganizzazione della navigazione per
  adattarsi a tutti i nuovi casi d'uso.
- **Conservazione dello scroll**: Quando apri un'entità in una vista a schermo intero, la posizione di scroll della vista collezione viene conservata.
- **Bozze salvate localmente**: Le bozze sono ora salvate localmente nel browser. Ciò significa che se chiudi accidentalmente il browser o navighi via, le tue modifiche saranno ancora presenti quando tornerai.
- **Conservazione dello stato dell'URL**: Lo stato dei filtri e dell'ordinamento è ora conservato nell'URL.
- **Funzionalità annulla/ripristina**: Aggiunta la possibilità di annullare e ripristinare le modifiche durante la modifica delle entità.
- Aggiunto il flag `alwaysApplyDefaultValues` alle collezioni. Questo flag consente di applicare i valori predefiniti anche quando si aggiornano
  le entità, non solo quando le si crea.
- I moduli secondari ora mantengono la loro larghezza quando in modalità pannello laterale. È possibile creare moduli secondari completi
  che vivono nella loro scheda. I moduli secondari sono costruiti come componenti personalizzati e possono includere qualsiasi componente, inclusi
  i binding dei campi.
- Aggiunta la modalità colore del sistema oltre alle modalità scura e chiara. Il pulsante è ora un menu a discesa invece di un toggle.
- Miglioramenti dei moduli, incluso il reset dello stato iniziale dopo il salvataggio e le azioni del modulo entità staccate.
- Avviso quando si lasciano moduli non salvati per prevenire la perdita accidentale di dati.
- Ora è possibile sovrascrivere le azioni predefinite delle entità fornendo un'azione con una delle chiavi `edit`, `copy` o `delete`
  nella prop `entityActions`.
- Fix: Le proprietà stringa con storage ora hanno la preferenza nelle anteprime.
- Fix per la codifica URL per le collezioni.
- Corretto lo scroll delle azioni di dialogo quando non avrebbero dovuto.
- Fix per la navigazione verso nuove entità dal pannello laterale.

## [3.0.0-beta.11] - 2024-12-13

- Nuovo template Next.js per Rebase PRO. Ora puoi creare un nuovo progetto con il template PRO usando la CLI.
- [BREAKING] Rimosso `userRoles` da AuthController. Ora puoi accedere direttamente alla prop `roles` nell'oggetto utente.
- [BREAKING] Molte dimensioni dell'interfaccia utente di Rebase sono state modificate per una migliore coerenza. Questo ti influenzerà solo se stai usando
  componenti personalizzati.
    - `smallest` o `tiny` sono stati rinominati in `small`.
    - `small` è stato rinominato in `medium`.
    - `medium` è stato rinominato in `large`.
- [BREAKING] Per le versioni self-hosted, c'è stato un cambiamento nell'API per i controller di gestione dei dati. Il
  `authController` è ora passato al controller User Management, invece del contrario. Il
  `userManagementController` può essere usato come controller di autenticazione, ma con tutta la logica aggiunta per la gestione degli utenti.

❌ Codice precedente:

```typescript
    /**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
        dataSourceDelegate: firestoreDelegate
    });

/**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
    firebaseApp,
    signInOptions,
    loading: userManagement.loading,
    defineRolesFor: userManagement.defineRolesFor
});
```

✅ Codice successivo:

```typescript
    /**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
        firebaseApp,
        signInOptions
    });

/**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
    dataSourceDelegate: firestoreDelegate,
    authController
});
```

- Aggiunte molte direttive "use client" ai componenti dell'interfaccia utente.
- Corretti problemi nel dialogo del codice dell'editor di collezioni.
- Aggiornati gli stili web e integrate le migliorie in Docusaurus.
- Migliorato lo stile per i riferimenti vuoti e piccole modifiche al design.
- Lavori in corso sugli Editor custom components.
- Reintrodotta la variante di colore primario scuro per migliori opzioni di tema.
- Piccoli aggiornamenti web per migliorare estetica e funzionalità.
- Corretto un bug per cui l'Editor non salvava i valori falsi.
- Sostituite tutte le istanze dei colori grigio e ardesia con colori `surface` e `surface-accent` più unificati per la coerenza dell'interfaccia utente.
- Aggiunto il fallback del componente Avatar e integrata la configurazione ESLint nei template.
- Migliorata la gestione degli errori nei moduli e migliorati i messaggi di errore del cloud.
- Refactor della logica di gestione utenti per una migliore organizzazione del codice.
- Migliorata la gestione delle proprietà booleane switch nelle configurazioni.
- Introdotta la gestione dello stato per i figli in ArrayContainer.
- Aggiunta una ricetta per la creazione di slug, migliorando la gestione degli URL e la SEO.
- Corretti problemi di crash nei campi ripetuti per le sottoproprietà e risolti vari bug minori di stile e funzionalità.
- Apportati miglioramenti alla reattività della heatmap (correzioni HMR).
- Refactor delle funzionalità di ricerca testuale per una migliore efficienza e aggiunta la documentazione pertinente.
- Corretti problemi con i campi di input numerici che bloccavano lo scroll e sostituito il date picker con l'input data HTML nativo per
  coerenza.
- Se stai usando il componente `Select`, non è più necessario fornire una funzione `renderValue`. Il componente
  lo gestirà automaticamente.
- Le proprietà di anteprima personalizzate sono ora renderizzate se il valore non è definito.
- Corretto il problema della versione Cloud che aggiornava la navigazione troppo spesso.
- Corretto il problema della ricerca locale che non funzionava quando si tornava a una collezione.
- Corretto un bug quando si selezionava un'entità di sola lettura.
- Corretto un bug di selezione nei gruppi di collezioni per entità che condividono l'ID.
- Le anteprime dei riferimenti ora tengono conto degli array di immagini per l'immagine di anteprima.

## [3.0.0-beta.10] - 2024-07-10

- Corretti problemi con licenze errate.
- Risolte le dipendenze di TipTap.
- Risolti vari aggiornamenti di stile minori in tutto il web.
- Spostato il CSS del body dalle importazioni predefinite a singoli file per una migliore modularità.
- Implementati diversi aggiornamenti web, inclusi fix di stile per select e aggiustamenti del titolo del dialogo per la ricerca testuale.
- Aggiornata la vista di selezione delle proprietà dell'editor di collezioni e migliorato il layout di selezione dei widget.
- Applicati ritocchi ad AppBar per migliorare il comportamento sui dispositivi mobili.
- Migliorate le uscite della console e puliti segmenti di codice vari.
- Migliorata l'interfaccia utente con l'aggiunta di un componente Slider e aggiornata la documentazione correlata.
- Sostituita l'icona di modifica dell'entità con una matita per chiarezza.
- Aggiornate le dipendenze e affinata la gestione del progetto con una funzione di controllo licenze.
- Migliorata la gestione degli input numerici in Formex e corretto l'export di DateTimeField in Next.js.
- Aggiunta la generazione di chiavi API e le capacità di selezione del progetto.
- Introdotto un messaggio di avviso di scadenza e miglioramenti nella gestione dei dati di collezioni e sottocollezioni.
- Fornita una migliore gestione degli errori e coerenza del layout nell'applicazione.


## [3.0.0-beta.9] - 2024-07-10

- **NUOVO EDITOR MARKDOWN**: L'editor markdown è stato completamente rinnovato. Ora supporta un'anteprima live e un'esperienza di editing notevolmente migliorata. Ora include un menu slash a cui puoi accedere digitando `/` nell'editor. Inoltre, una nuova barra degli strumenti con pulsanti per le operazioni markdown comuni. Il nuovo editor include anche una funzione di completamento automatico AI, che suggerisce elementi markdown mentre digiti e visualizza il markdown generato in tempo reale e evidenziato.
- Campi aggiuntivi vengono ora visualizzati anche nel dialogo laterale dell'entità.
- L'import/export è ora suddiviso in 2 plugin separati.
- I pacchetti ora non sono minificati, lasciando tale responsabilità al bundler del client.
- Aggiunto il campo dimensione massima nell'editor di collezioni per i file.
- Migliorata la gestione degli errori per caricamenti di file errati.
- Miglioramento dell'errore quando si apre un'entità non accessibile nella vista laterale.
- Ritocchi al componente Select e rimossa la prop `multiple`.
- Nuovo componente `MultiSelect` con un'esperienza utente notevolmente migliorata.
- Introdotto AppCheck direttamente in Rebase Cloud.
- Aggiunto supporto MongoDB per Rebase PRO.
- Molteplici correzioni nel plugin di gestione utenti per progetti PRO.
- Aggiornate le dipendenze di react-router.
- Migliorata la personalizzazione, ora è possibile definire gli stili per ogni voce di tipografia, inclusa la dimensione del font, la tipografia...
- Migliorata la ricerca nella home page, ora usando fuse.js.
- Fix per indice mancante e chiavi errate in array di mappe con property builder.
- Fix per la posizione del drag handle nell'editor.
- Rinominato `partOfBlock` in `minimalistView` nelle prop dei campi.
- Ora è possibile definire proprietà di anteprima a livello di collezione.
- Stile dei riferimenti aggiornato.
- I tooltip sono stati rinnovati per utilizzare meno div.
- Fix per la posizione del plugin di miglioramento dati.
- Fix per come è possibile sovrascrivere la fonte dati per collezioni specifiche.
- È ora possibile definire un database diverso da `(default)` nella fonte dati.
- Il plugin User Management ora salva gli utenti con l'email come chiave, invece di un valore casuale.
- Fix per i pannelli laterali che si adattano alla dimensione corretta quando la finestra cambia dimensione.
- Alcuni aggiornamenti di stile del drawer.
- `RepeatFieldBinding` può ora utilizzare proprietà di array irrisolte.

## [3.0.0-beta.8] - 2024-07-10

- Corretto il problema di eccessivi re-render nella vista del modulo.
- Ora puoi utilizzare i componenti `PropertyFieldBinding` nelle tue viste di entità personalizzate, e saranno trattati come campi regolari.
- Per le viste di entità aggiuntive, ora puoi preservare la barra delle azioni inferiore, con la prop `includeActions`.
- Per le proprietà di mappa, se non sono richieste, il valore potrebbe essere `undefined`, ma se una proprietà figlio ha un valore, la validazione sarà attivata per tutti i figli.
- Corretto il problema delle mappe dati che non venivano attraversate correttamente con valore null.
- Il template pro CLI ora supporta la creazione della configurazione dell'app web.
- Corretto il problema dell'inferenza dei dati nell'editor di collezioni per gli enum.
- Piccolo miglioramento dello stile di Sheet.
- Corretto il problema di caricamento della ricerca locale con dati memorizzati nella cache.
- Piccola correzione visiva per gli ID.
- Aggiornamenti di AppCheck.
- Corretta l'apertura incoerente dei dialoghi laterali di anteprima dei riferimenti.
- Corrette le icone per le anteprime delle immagini.
- Navigazione all'URL della home quando si esegue il logout.
- Aggiunta la prop `previewUrl` nelle opzioni di storage (#639).
- Corretto il problema di sicurezza XLSX CVE-2024-22363 (#654).
- Fix per la rimozione delle chiavi nei campi KeyValue.
- Aggiunta la dimensione grande per gli switch booleani.
- Aggiornato eslint all'ultima versione e configurazione.
- Fix dei tipi per `removePropsIfExisting`.
- Fix per il bug del trascinamento del video nei campi array.
- Aggiunta l'opzione per chiedere il reset della password, nella vista di login PRO.
- Consentiti valori predefiniti null per le proprietà.
- Aggiunto il conteggio ai binding dei campi array.
- Corretti i valori predefiniti nelle mappe nidificate negli array.
- Risoluzione del percorso della collezione entità con quello proveniente dall'entità, non dalla configurazione della vista.
- Piccola correzione per l'immagine del logo.
- Corretti i campi condizionali che non si aggiornavano correttamente.
- Nascondi il pulsante "nuovo utente" se `disabledSignupScreen`.
- Migliorato lo stile della barra di navigazione della documentazione.
- Consentite le mappe completamente indefinite.
- Disabilitato il pulsante "aggiungi" nei gruppi di collezioni.
- Grande refactor delle entità, le viste personalizzate sono ora sotto il provider formex.
- Correzione CLI per utenti non loggati.
- Corretto il problema delle datamaps che non venivano attraversate correttamente con valori null.
- Aggiornamenti delle prop Scaffold.

## [3.0.0-beta.7] - 2024-06-18

- Rinominata la classe utility `cn` in `cls`, mantenendo `cn` disponibile con un avviso di deprecazione.
- Aggiunta documentazione di Menubar e documentazione skeleton mancante.
- Corretto il tipo di ordine delle proprietà per consentire le sottocollezioni.
- Nuova sezione UI aggiunta alla landing page.
- Migliorato il flusso di salvataggio e chiusura dei dialoghi.
- Consentito nascondere ID e link di entità in riferimenti e anteprime.
- Rimosse alcune transizioni CSS.
- Consentito nascondere il toggle della modalità colore.
- Aggiunto esempio di vista JSON.
- Modificata la tabella virtuale per utilizzare le dimensioni in pixel.
- Alcuni aggiornamenti di design per una migliore esperienza utente.
- Reintrodotta la colonna del gruppo di collezioni con ID genitore.
- Migliorato l'output dei risultati vuoti.
- Aggiunti prompt e suggerimenti di esempio per DataTalk.
- Migliorata la vista laterale dell'entità, calcolata dinamicamente in base alla profondità delle proprietà della collezione.
- Corretti i tipi mergeDeep.
- Corretto un problema con l'esportazione di proprietà non esistenti definite in `propertiesOrder`.
- Corretti i problemi del template PRO senza progetti Cloud.
- Migliorata la gestione per i valori enum con valore 0.

## [3.0.0-beta.6] - 2024-04-23

- Aggiunto AppCheck a ogni variante di Rebase.
- Varie correzioni per datasource delegate.
- Corretto il salvataggio dei dati puliti.
- Corretto il problema di creazione di nuovi ruoli utente in Cloud.
- Corretto il problema di visualizzazione dei messaggi di errore nelle celle della tabella.
- Corretto il problema di aggiornamento delle sottocollezioni.
- Aggiornati gli analytics di import/export e le relative conversioni di mappatura dei dati.
- Aggiornata e migliorata la gestione dei ruoli e delle autorizzazioni utente.
- Migliorata la gestione dei file degli account di servizio e la creazione di progetti utilizzando SA.
- Aggiornato il comportamento delle query non indicizzate.
- Rimosso il collegamento della gestione utenti alla demo.
- Aggiornamenti delle dipendenze per mitigare i problemi di sicurezza.
- Esposizione di metodi aggiuntivi dall'inferenza dei dati per una migliore personalizzazione.
- Aggiornamenti del template Pro per un'UI/UX migliorata.
- Aggiornata la documentazione per le collezioni e la gestione utenti.

## [3.0.0-beta.5] - 2024-04-01

- [BREAKING] Il componente principale per Rebase Cloud è stato rinominato da `RebaseApp` a `RebaseCloudApp`. Si prega di aggiornare
  le proprie importazioni di conseguenza.
- Correzioni relative alla CLI. Ora puoi installare la CLI globalmente con `npm install -g @rebasepro/cli`.

## [3.0.0-beta.4] - 2024-03-27

- [BREAKING] Il nome del pacchetto per Rebase Cloud è cambiato da `rebase` a `@rebasepro/cloud`. Questo è fatto
  per evitare conflitti con il pacchetto principale Rebase. Se stai usando Rebase Cloud, dovrai aggiornare il tuo
  importazioni.
- [BREAKING] Se stai importando la configurazione tailwind, ora puoi trovare l'importazione su:
  `import rebaseConfig from "@rebasepro/ui/tailwind.config.js";`
- [BREAKING] In tal caso, devi anche aggiungere `@tailwindcss/typography` alle tue dipendenze di sviluppo.
- [BREAKING] Devi aggiornare il tuo `vite.config.js` e sostituire il nome del pacchetto nella configurazione federata:
    ```javascript
    import { defineConfig } from "vite"
    import react from "@vitejs/plugin-react"
    import federation from "@originjs/vite-plugin-federation"
    
    // https://vitejs.dev/config/
    export default defineConfig({
        esbuild: {
            logOverride: { "this-is-undefined-in-esm": "silent" }
        },
        plugins: [
            react(),
            federation({
                name: "remote_app",
                filename: "remoteEntry.js",
                exposes: {
                    "./config": "./src/index"
                },
                shared: ["react", "react-dom", "@rebasepro/cloud", "@rebasepro/core", "@rebasepro/firebase", "@rebasepro/ui"]
            })
        ],
        build: {
            modulePreload: false,
            target: "ESNEXT",
            cssCodeSplit: false,
        }
    })
    ```
- Piccoli miglioramenti delle prestazioni e correzioni di bug.
- Funzionalità di filtraggio e ordinamento migliorate per i campi indicizzati.
- Esteso StorageSource per supportare `bucketUrl` personalizzati.
- Pulizia per i generici del navigation controller e le classi Markdown prose.
- Risolti problemi di salvataggio della gestione utenti e rinominato il template Cloud.
- Corretti i re-render di ReferenceWidget.tsx.
- Corretto il problema del pulsante "nuova collezione" nella homepage.
- Corretti i percorsi dei template CLI.
- Ruoli integrati in AuthController.
- Piccola modifica all'API dei plugin.
- Aggiunti dettagli utente al menu a discesa della barra di navigazione.
- Dipendenze aggiornate.
- Refactor dell'anteprima della vista entità e del titolo.
- Lavori in corso sulla bacheca Kanban.
- Fix per i nuovi valori di selezione vuoti di radix.
- Correzioni per proprietà indefinite in array e nell'editor.
- Parametri aggiuntivi aggiunti nei controller di autenticazione.
- Refactor delle schede di navigazione e pulizia dell'API del plugin.
- Fix per l'importazione di dati con ID non stringa.
- Documentazione: Aggiunta ricetta per la gestione delle callback delle entità.
- Aggiornamenti web e fix CLI per yarn.

## [3.0.0-beta.3] - 2024-02-21

- Fix per l'importazione di dati in sottocollezioni.
- Riordino del codice.
- Rimossa la minificazione. Modificati i controlli di tipo EntityReference.
- Aggiornamenti per l'upload di immagini nell'editor.
- Cosmetico.
- Spostato il plugin tailwind.config.js dell'editor.
- Rimosse le callback nelle viste di navigazione laterali, previene bug.
- Fix template PRO.
- Pulizia della vista di login PRO.

## [3.0.0-beta.2] - 2024-02-21

- Aggiunto il pacchetto Formex per gestire i moduli su tutta la piattaforma. Formex è una libreria di gestione dei moduli
  interna con un'API simile a Formik, ma con prestazioni migliori e molto più leggera.
- Processo di onboarding migliorato per i nuovi utenti.
- Corretti problemi di importazione dati per nuove collezioni.
- Modifiche all'onboarding SaaS per una migliore esperienza utente.
- Implementata la validazione regexp per i campi di input.
- Feedback di errore di login migliorato.
- Estratto il navigation controller per una migliore gestibilità.
- Stili aggiornati per la coerenza.
- Aggiornato Vite e le dipendenze per prestazioni e sicurezza.
- Refactor dei moduli utente e ruoli per utilizzare Formex.
- Corretti i moduli dell'intestazione della tabella e i problemi dell'editor di collezioni.
- Risolti problemi di importazione JSON errati.
- Rimosso Formik, migliorando la gestione dei moduli con Formex.
- Apportate piccole correzioni di annidamento HTML e debounce.
- Corretti i bug del menu del contenitore array e degli input multilinea.
- Migrata la configurazione Tailwind alla libreria per una gestione più semplice.
- Regolata la configurazione di Sentry per la segnalazione degli errori.
- Correzione per la vista di modifica delle sottocollezioni che appariva vuota.
- Correzioni per le proprietà di blocco e gruppo nell'editor che salvavano più voci durante la modifica di una sottoproprietà esistente.

## [3.0.0-beta.1] - 2024-02-01

Questa è la prima versione beta di Rebase v3.0.0.
Anche se ancora in beta, consideriamo questa versione sufficientemente stabile per essere utilizzata in
produzione.

> Tutte le modifiche relative alla V2 alpha sono attualmente raggruppate in questi documenti:
> - [Novità della versione 2.0.0](https://rebase.pro/docs/new_in_v2)
> - [Guida alla migrazione dalla versione 1.x alla 2.0.0](https://rebase.pro/docs/migrating_from_v1)

> Il changelog per le versioni 1.0.0 e precedenti può essere
> trovato [qui](https://rebase.pro/docs/1.0.0/changelog)

---
## [2.2.0] - 2023-11-09

- Fix per link di sottocollezione mancanti.
- Nuovo flusso di login via email e password.
- Rimosso il pulsante aggiungi nel gruppo di collezioni.
- Correzioni di esportazione.
- Fix per la ricerca nelle collezioni.

## [2.1.0] - 2023-09-12

- [BREAKING] La logica per verificare le combinazioni di filtri valide è stata spostata nell'interfaccia `DataSource`.
  Questo migliora la capacità di personalizzare la fonte dati e consente filtri più complessi.
  Questa modifica ti influenzerà solo se hai implementato una fonte dati personalizzata. Dovrai
  aggiungere un metodo `isFilterCombinationValid` alla tua fonte dati.
- [BREAKING] La prop `filterCombinations` è stata rimossa dal componente `EntityCollection`.
  Questa è ora gestita dalla fonte dati. Se hai bisogno di consentire più filtri, puoi utilizzare la
  nuova callback `FireStoreIndexesBuilder`. Controlla
  la [documentazione](https://rebase.pro/docs/collections/multiple_filters)
  per maggiori informazioni.
- Ora puoi usare `spreadChildren` nidificati nelle proprietà di mappa, consentendo di mostrare arbitrariamente
  strutture nidificate come singole colonne nella vista collezione.
- Il valore di conteggio della collezione è ora aggiornato con i filtri applicati.
- Fix per l'esportazione csv che non funzionava quando i dati sottostanti non erano validi.
- Fix per un bug di ricerca nelle collezioni che restituiva un singolo risultato.
- Fix per i campi di riferimento che si rompevano con valori errati.

## [2.0.5] - 2023-07-11

- Il valore predefinito per le proprietà stringa è ora `null` invece di `""`.
- Fix per il controller di ricerca testuale che non si aggiornava correttamente come dipendenza.
- Fix per l'impostazione di un campo univoco utilizzando un riferimento, che stava
  generando una query non valida in Firestore.

## [2.0.4] - 2023-06-15

- Fix per `forceFilter` che non veniva applicato correttamente nelle viste di riferimento.
- Fix per la configurazione di validazione degli enum nullable.

## [2.0.3] - 2023-06-15

- Fix per il modulo che resettava i valori durante il salvataggio.

## [2.0.2] - 2023-06-14

- Sostituito `flexsearch` con `js-search`. Le loro importazioni sono troppo confuse.
- Fix per il modulo che assegnava ID errati.
-

## [2.0.1] - 2023-06-12

- Fix per le voci di blocco che non generavano il valore predefinito corretto quando si aggiungeva una nuova voce. Questo causava
  un bug quando la proprietà figlio è un array, come nell'esempio del blog.
- Aggiunto `formAutoSave` alle collezioni. Questo rimuove i pulsanti dal modulo e salva automaticamente
  l'entità quando ci sono modifiche o l'utente lascia il modulo.
- Ora puoi accedere a `formContext` dalle viste di collezione, permettendoti di accedere all'entità corrente
  che viene modificata, modificare i valori e `save`.

## [2.0.0] - 2023-06-07

- Ora è possibile utilizzare una callback per definire la vista predefinita di un'entità.
- Fix quando si aprono le entità da una vista personalizzata, che utilizza anche sottocollezioni.

## [2.0.0-rc.2] - 2023-06-05

- Dipendenza `@mui/x-date-pickers` ripristinata a `^5.0.0`.
- Valori predefiniti assegnati ora a ogni proprietà, in base al tipo di proprietà.
  Ad esempio, le proprietà booleane avranno un valore predefinito `false`, le mappe `{}`,
  e la maggior parte delle altre proprietà `null`.
- Rimosso lo spazio vuoto per le proprietà nascoste nel dialogo laterale dell'entità.

## [2.0.0-rc.1] - 2023-05-31

- Aggiunti campi chiave-valore arbitrari con la prop `keyValue` nelle proprietà di mappa.
- Dipendenza `@mui/x-date-pickers` aggiornata (potrebbe essere necessario aggiornare la propria versione
  alla 6.5.0).
- Alcuni miglioramenti al componente `EntityCollectionTable`, riferiti ai
  valori che vengono aggiornati in background. Anche un corretto debouncing per
  i campi della tabella.

## [2.0.0-beta.7] - 2023-05-23

- Aggiunto supporto per i gruppi di collezioni.
- [BREAKING] La funzione `countEntities` nella fonte dati ora accetta un
  oggetto invece di una stringa come parametro. Questo ti influenzerà solo se hai
  costruito un componente personalizzato usando quella funzione.
- Aggiunte anteprime URL stringa ai campi.
- Fix per i geopunti che non venivano serializzati correttamente durante il salvataggio.

## [2.0.0-beta.6] - 2023-05-11

- Fix per i tipi Typescript che non venivano esportati correttamente e davano errori
  quando si utilizzava la libreria con il quickstart.
- Fix per i messaggi di errore che non venivano visualizzati correttamente nei nuovi campi di testo.
- Fix per l'importazione di flexsearch che causava crash usando webpack.

## [2.0.0-beta.5] - 2023-04-28

- Aggiornato l'aspetto dei campi. I campi di testo sono ora personalizzati, non quelli
  forniti da Material UI. Questo consente maggiore personalizzazione, meno codice e
  migliori prestazioni.
- Corretto il login view non centrato.
- Corretta la selezione del campo popup e il bug di drag and drop.
- Fix per il campo di skip login.
- HTML ora renderizzato correttamente nelle anteprime markdown.
- Fix per il permesso `read` che non veniva applicato correttamente.
- Fix per lo stato di vista vuota non centrato nelle collezioni.

## [2.0.0-beta.4] - 2023-03-30

- Corretto un bug nell'intestazione della tabella.
- Aggiunta una barra di ricerca nella home page.
- Aggiunte le viste delle collezioni preferite e recenti nella home page.
- Fix per alcuni property builder profondamente nidificati in array.
- Aggiunta la prop `autoOpenDrawer`, che consente di aprire il drawer automaticamente quando
  si passa il mouse sul menu.
- Consenti di scegliere quale vista personalizzata o sottocollezione viene aperta per impostazione predefinita,
  con la prop `defaultSelectedView`. Grazie a @SeeringPhil per la PR!
- Rinominato `builder` in `Builder` nelle viste personalizzate delle collezioni per coerenza.

## [2.0.0-beta.3] - 2023-03-21

- Corretto un bug relativo ai controller di selezione personalizzati.
- Fix per il valore predefinito non impostato nelle proprietà array.
- Abilitato Firebase App Check. Grazie a @sengerts per la PR!
- Aggiunta funzione di copia alle viste array. Grazie a @guustmc per la PR!
- Il dialogo laterale dell'entità è ora più ampio per impostazione predefinita.
- Piccoli miglioramenti alle proprietà di blocco. Ora il primo tipo viene selezionato
  per impostazione predefinita.
- Corretto l'ordinamento aggiuntivo aggiunto quando vengono applicati più filtri,
  il che creava un bug.
  Grazie a @juanleondev per la PR!
- Rinominato `ReferenceSelectionView` in `ReferenceSelectionInner`.
- Aggiunti filtri di riferimento.
- Corretto il ritardo nell'aggiornamento della tabella quando si elimina un'entità.
- Ora è possibile modificare il valore di qualsiasi proprietà all'interno di un campo personalizzato.

## [2.0.0-beta.2] - 2023-01-30

- Corretto un bug per cui le azioni della collezione resettavano il loro stato interno.
- Migliorata l'anteprima dei file che non sono immagini, video o audio.
- Ottimizzazioni del modulo.
- Fix per il dialogo di riferimento che non cancellava la selezione.
- Fix per snackbar di errori multipli, quando c'è un errore di caricamento di un file.
- Fix per l'evidenziazione mancante alla chiusura del dialogo laterale.
- Fix per l'aggiornamento ritardato dei dati al cambio dei filtri.
- Refactoring interno del componente `EntityCollectionTable`.
- [BREAKING] Nel componente `EntityCollectionTable`, la prop `ActionsBuilder`
  è stata sostituita con `actions`.

## [2.0.0-beta.1] - 2023-01-18

Questa è la prima versione beta di Rebase v2.0.0.
Anche se ancora in beta, consideriamo questa versione sufficientemente stabile per essere utilizzata in
produzione.

> Tutte le modifiche relative a V2 alpha sono attualmente raggruppate in questi documenti:
> - [Novità della versione 2.0.0](https://rebase.pro/docs/new_in_v2)
> - [Guida alla migrazione dalla versione 1.x alla 2.0.0](https://rebase.pro/docs/migrating_from_v1)

> Il changelog per le versioni 1.0.0 e precedenti può essere
> trovato [qui](https://rebase.pro/docs/1.0.0/changelog)

---
