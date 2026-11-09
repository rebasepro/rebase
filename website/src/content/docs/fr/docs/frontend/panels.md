---
sourceHash: e40c0f481cca1bc9
title: Panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une collection, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, RecordForm, RecordDetail, FieldValue et CollectionsProvider, sans l'interface d'administration autour."
---

Sur la version 0.24
`CollectionPanel` n'accepte qu'un `path` enregistré et affiche « Collection not
found » en dehors de l'arborescence complète de l'administration, et `EntityFormPanel` ainsi que
`CollectionsProvider` n'existent pas.

Vous n'avez pas besoin de l'ensemble de l'administration pour afficher une seule table. `<CollectionPanel>` prend
la collection en tant que valeur et fonctionne n'importe où sous `<Rebase>` et un routeur React
Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>` :

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, ou tout autre routeur, depuis "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un enregistrement s'ouvre par-dessus votre page, dans un panneau latéral ou une boîte de dialogue, et jamais via l'URL :
aucune route d'administration ne dessert la page, donc `full_screen` et `split` s'ouvrent sous forme de panneau
latéral, et `useUrlController().routesMounted` vaut `false` pour vos propres
composants à cet endroit. Tout routeur fonctionne : un simple `<BrowserRouter>`, un
`<MemoryRouter>` ou un routeur de données (data router). Un routeur reste néanmoins requis. Un data router
permet également à un enregistrement contenant des modifications non enregistrées d'interrompre la navigation interne de l'application ; avec les
autres, seule l'invite de fermeture de page du navigateur fait office de garde-fou. Enveloppez le panneau dans `<RebaseAuthGate>` si la page
doit d'abord afficher la page de connexion de Rebase.

## Ce qu'affiche un panneau

Un panneau restitue la collection de la même manière que l'administration. Ces props permettent de la restreindre aux besoins
de votre page ; aucune d'entre elles ne modifie la page propre de la collection.

```tsx
import { CollectionPanel } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

<CollectionPanel
    collection="orders"
    viewMode="table"
    fields={["number", "customer", "status", "total"]}
    where={{ status: ["==", "pending"] }}
    orderBy="placed_at:desc"
    toolbar="compact"
    rowActions={(order, id) => (
        <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>
    )}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

`collection` accepte le nom de la collection, comme ici, ou la collection elle-même sous forme
de valeur (`collection={ordersCollection}`) ; `path` permet également de la désigner et cible une
sous-collection par son chemin complet.

- `fields` — les propriétés qu'il affiche, dans cet ordre, et rien d'autre. Dans la
  table, il s'agit des colonnes. Dans la liste, sur une carte et sur une carte kanban, elles correspondent
  aux éléments à partir desquels les emplacements de la ligne — titre, image, sous-titre, statut, date,
  pastilles de relation, colonnes de la liste — sont renseignés, les premiers en priorité ; un emplacement qu'aucun
  d'entre eux ne remplit reste vide. Pour ce panneau, il prévaut sur `propertiesOrder`, l'ordre
  des colonnes enregistré par un utilisateur et `listProperties`. Les largeurs de colonne ajustées par un utilisateur
  persistent toujours ; l'ordre étant le vôtre, les colonnes ne peuvent pas être déplacées.
- `toolbar` — `"full"` par défaut ; `"compact"`, qui comprend la recherche, le sélecteur
  de mode de vue et Nouveau (lorsque la personne a le droit de création) ; `"none"` (ou `null`)
  pour aucune barre d'outils ; ou une barre composée à partir de ses éléments : `CollectionToolbar` (avec `start` et `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  et `CollectionAddButton`. Ils lisent le panneau dans lequel ils sont affichés et lèvent une erreur
  partout ailleurs. Les slots de plugins et la surcharge de `Collection.Actions` résident dans la
  barre d'outils par défaut.
- `onRowClick` — appelée avec la ligne cliquée et son identifiant à la place de l'ouverture habituelle par le panneau,
  depuis une ligne, une carte, une carte kanban et l'action de modification. La ligne correspond à celle envoyée
  par le serveur, selon la structure attendue par `useRows`, `useRow` et `<FieldValue>` :
  exactement ses colonnes, des chaînes de date ISO (`YYYY-MM-DD` pour une colonne
  de type date seule), et une relation belongsTo sous forme de sa clé étrangère (`customerId`). Une relation dont le panneau a chargé la
  cible arrive imbriquée sous son nom, de la même manière que le paramètre `include` de REST la renvoie
  (`order.customer` correspond à la ligne du client) ; sa clé étrangère s'y trouve également.
  L'id est la chaîne par laquelle l'administration référence l'enregistrement — sa clé primaire, ou les parties d'une clé
  composite jointes par `:::` — que prennent `highlightedIds` et
  `useSidePanel().open`. `row.id` correspond à la colonne `id` de l'enregistrement, lorsque la
  table en possède une, avec le type de cette colonne : `5` pour une clé entière, dont l'identifiant est
  `"5"`.
- `rowActions` — votre propre JSX sur chaque ligne, carte et carte kanban, recevant la
  ligne et son id : un « Approve », un « Ship ». Dans la table, il s'agit de la dernière colonne,
  toujours visible ; sur une ligne de liste, une carte et une carte kanban, il se place à côté des
  actions propres à la collection. Un clic dessus n'ouvre pas l'enregistrement, et il se rafraîchit
  avec l'état de votre composant, de sorte qu'un indicateur `saving` le désactive.
- `orderBy` — l'ordre dans lequel les lignes s'affichent, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. L'utilisateur peut toujours trier selon une autre colonne.
- `highlightedIds` — les identifiants des lignes affichées comme sélectionnées, par exemple celle qu'une page
  affiche à côté de la liste : `highlightedIds={selected ? [selected] : []}`.
  `[]` n'en met aucune en surbrillance. Sans cette prop, le panneau met en surbrillance la dernière ligne ouverte. Les identifiants
  sont comparés sous forme de chaînes, de sorte qu'un `5` pour une clé entière et `"5"` correspondent à la même ligne.
- `where` — quelles lignes il contient, de la façon dont `useRows` le reçoit :
  `where={{ status: ["==", "pending"] }}`. Les filtres définis par l'utilisateur sur d'autres
  champs s'y combinent, et ses propres champs ne peuvent pas être modifiés ou effacés depuis
  la barre d'outils. Il suit la prop, de sorte qu'une barre d'onglets ou une barre de graphique cliquée peut
  la piloter depuis l'état. Il prévaut sur le `fixedFilter` de la collection, champ par
  champ.
- `viewMode` — le mode dans lequel il s'ouvre, prioritaire sur celui de l'URL et sur le dernier
  choisi par l'utilisateur. Ce dernier peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni l'en-tête propre à la vue liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres
  `__view`, de filtre et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban, sous forme
de boutons lorsqu'elles sont déclarées avec `collapsed: false`, et dans le menu de la ligne dans le cas contraire — un bouton
« Approve » sur chaque carte représente une seule action.

Un panneau adapte ses dimensions à ses lignes. Sans hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, tandis qu'une collection longue
défile dans l'espace disponible, jusqu'à concurrence de la hauteur de la fenêtre. Donnez-lui une hauteur pour
qu'il la remplisse. Il s'organise selon sa propre largeur, et non celle de la fenêtre : dans une colonne
étroite, il adopte sa disposition compacte, quel que soit l'écran.

`propertiesOrder` réorganise et ne masque jamais : une propriété omise est affichée
après celles mentionnées. Pour en masquer une partout, définissez `admin.hideFromCollection`
sur celle-ci ; pour n'en afficher que certaines à un endroit donné, passez `fields`.

## Le formulaire d'un enregistrement

`<RecordForm>` fait de même pour le formulaire d'un enregistrement (il se nommait `EntityFormPanel`
avant la version 0.29 ; ce nom fonctionne toujours et émet un avertissement unique). Il charge l'enregistrement
par son `id`, l'enregistre via la couche de données de `<Rebase>` tout comme le fait le propre
formulaire de l'administration, et appelle `onSaved` après chaque sauvegarde avec l'enregistrement sauvegardé tel que le
serveur renvoie la ligne, `row`, et son `id`. Omettez `id` pour créer un
enregistrement. `onClose` est appelée lorsque le formulaire demande à être quitté, par exemple après
la suppression de son enregistrement :

```tsx
<RecordForm
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Comme `CollectionPanel`, le formulaire et `RecordDetail` acceptent une collection
enregistrée par son nom, sans avoir besoin de l'objet de configuration sous la main :
`<RecordForm collection="posts" id={postId}/>` (`path="posts"` fonctionne également). Sous `<RebaseCMS>` ou un
`CollectionsProvider` qui l'enregistre, c'est tout ce dont ils ont besoin. Sans portée
parente, fournissez la collection sous forme de valeur, comme ici, et le panneau apporte la
sienne ; une collection désignée par un chemin que rien n'enregistre indique que l'enregistrement est introuvable.

Si quelqu'un d'autre supprime l'enregistrement pendant que le formulaire est ouvert, celui-ci conserve
ce qui a été saisi et indique que l'enregistrement a été supprimé ailleurs. Son action « Save as new »
le transforme en un formulaire qui crée un nouvel enregistrement avec ces valeurs ;
`onSaved` signale ensuite le nouvel enregistrement.

Le formulaire peut afficher
une partie d'un enregistrement, ou l'organiser à votre façon. `fields` affiche uniquement les champs qu'il
mentionne, dans cet ordre ; les sections et le volet latéral (rail) conservent leur regroupement. Les enfants
remplacent les champs générés par votre propre JSX, dans lequel
`<FormField name="…"/>` restitue un champ avec le libellé, la taille et les règles que le
formulaire généré lui attribue :

```tsx
import { RecordForm, FormField } from "@rebasepro/cms";

<RecordForm collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</RecordForm>
```

`compact` correspond au formulaire dense destiné à une carte latérale ou à un panneau de 350 à 700 px : pas de rail
à côté des champs (son contenu se replie dans la colonne), pas de métadonnées d'enregistrement,
des contrôles de hauteur moyenne et un espacement interne plus serré :
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

Dans les deux cas, le formulaire ne valide que les champs qu'il affiche ; le serveur continue
de vérifier l'ensemble de l'enregistrement. Un formulaire qui crée un enregistrement et omet un
champ requis sans valeur par défaut le signale dès son ouverture : une erreur indique le
champ concerné, et le bouton Save reste bloqué jusqu'à ce que le champ soit affiché ou doté d'une valeur par défaut.
`collectionOverrides` modifie la collection uniquement pour ce formulaire, tout comme pour
`CollectionPanel`.

Chaque formulaire isole la portée de ses identifiants DOM, de sorte que deux formulaires peuvent cohabiter sur une même page. Pour cibler un champ
depuis un test, sélectionnez `[data-form-field="title"]` à l'intérieur du
`[data-form-path="posts"]` du formulaire.

`<RecordDetail>` est le pendant en lecture seule de `RecordForm`. Il charge
l'enregistrement par son `id` et le restitue comme le fait la page d'enregistrement de l'administration : les mêmes
sections et libellés, chaque valeur apparaissant sous forme d'aperçu, de sorte qu'une énumération s'affiche sous forme
de pastille, une date dans son fuseau horaire et une relation sous forme du titre de sa cible. Il accepte
`fields` et `collectionOverrides` tout comme le formulaire, et omet les champs
que le formulaire exclut : ceux qu'une règle `conditions.hidden` masque pour cet enregistrement, et
ceux que l'utilisateur connecté n'est pas autorisé à lire.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur unique de la même manière, au sein de votre propre JSX : transmettez-lui la
valeur telle que le serveur l'envoie. Une relation belongsTo arrive sous la forme de sa clé étrangère
(`order.customerId`), de sorte que `field="customer" value={order.customerId}` affiche le
titre de l'enregistrement lié ; cibler directement la clé étrangère elle-même, `field="customerId"`,
donne le même résultat. Le composant nécessite que la collection soit enregistrée en amont, par `<RebaseCMS>`
ou un `CollectionsProvider`. Une collection ou un champ inconnu lève une erreur
le mentionnant.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(order => (
        <div key={String(order.id)} className="flex gap-4">
            <FieldValue collection="orders" field="customer" value={order.customerId}/>
            <FieldValue collection="orders" field="status" value={order.status}/>
            <FieldValue collection="orders" field="placedAt" value={order.placedAt}/>
        </div>
    ));
}
```

## Plusieurs panneaux dans une même portée

Les trois panneaux intègrent leur propre `CollectionsProvider` lorsqu'aucun n'est défini au-dessus d'eux. C'est
l'élément sous-jacent, et vous pouvez le monter vous-même pour partager une même portée entre
plusieurs panneaux, ou pour utiliser les éléments de plus bas niveau (`CollectionViewBinding`,
`useSidePanel`) situés en dessous. À l'intérieur, un panneau peut désigner sa collection par son `path` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` conserve un registre des collections que vous lui confiez, avec
les hooks `modifyCollection` et `injectCollections` de vos plugins appliqués comme dans
l'administration, ainsi que les panneaux latéraux et boîtes de dialogue dans lesquels les enregistrements s'ouvrent, et la
protection contre les modifications non enregistrées. Gardez le tableau `collections` stable : sous forme de constante de module,
ou via `useMemo`.

## Suivant

- [Personnalisation de l'administration](/docs/frontend/customizing) : les emplacements où intégrer vos
  propres composants, et les recettes construites à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes que ces panneaux et `FieldValue` lisent.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacez la vue
  ou le formulaire affiché par un panneau.
