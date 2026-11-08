---
sourceHash: 99297021573eef28
title: Panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une collection, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, EntityFormPanel, RecordDetail, FieldValue et CollectionsProvider, sans shell d'administration autour d'eux."
---

Sur la version 0.24,
`CollectionPanel` n'accepte qu'un `path` enregistré et affiche « Collection not
found » en dehors de l'arborescence complète de l'administration, et `EntityFormPanel` ainsi que
`CollectionsProvider` n'existent pas.

Vous n'avez pas besoin de l'ensemble de l'administration pour afficher un tableau. `<CollectionPanel>` prend
la collection comme valeur et fonctionne n'importe où sous `<Rebase>` et un routeur React
Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>` :

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

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

Un enregistrement s'ouvre par-dessus votre page, dans un panneau latéral ou une boîte de dialogue, et jamais par URL :
aucune route d'administration ne dessert la page, donc `full_screen` et `split` s'ouvrent sous la forme
d'un panneau latéral, et `useUrlController().routesMounted` vaut `false` pour vos
propres composants à cet endroit. Tout routeur convient : un simple `<BrowserRouter>`, un
`<MemoryRouter>` ou un routeur de données (*data router*). Un routeur reste nécessaire. Un routeur de données
permet également à un enregistrement contenant des modifications non enregistrées d'interrompre la navigation dans l'application ; avec
les autres, seule l'invite de fermeture de page du navigateur fait office de protection. Enveloppez le panneau dans `<RebaseAuthGate>` si la page
doit d'abord afficher la connexion Rebase.

## Ce qu'affiche un panneau

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
Un panneau affiche la collection de la même manière que l'administration. Ces props permettent de la restreindre
aux besoins de votre page ; aucune d'entre elles ne modifie la propre page de la collection.

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

`collection` prend le nom de la collection, comme ici, ou la collection elle-même en
tant que valeur (`collection={ordersCollection}`) ; `path` permet également de la nommer et cible
une sous-collection par son chemin complet.

- `fields` — les propriétés affichées, dans cet ordre, et rien d'autre. Dans le
  tableau, ce sont les colonnes. Dans la liste, sur une carte et sur une carte kanban,
  elles déterminent la façon dont les emplacements de la ligne — titre, image, sous-titre, statut, date,
  puces de relation (*relation chips*), colonnes de la liste — sont renseignés, les
  premières en priorité ; un emplacement qu'aucune d'entre elles ne renseigne reste vide. Pour ce panneau, cette prop l'emporte sur `propertiesOrder`,
  l'ordre des colonnes enregistré par un utilisateur et `listProperties`. La largeur des colonnes redimensionnées par un utilisateur
  est toujours conservée ; l'ordre étant le vôtre, les colonnes ne peuvent pas être réorganisées par glisser-déposer.
- `toolbar` — `"full"`, la valeur par défaut ; `"compact"`, qui comprend la recherche,
  le sélecteur de mode de vue et Nouveau (lorsque l'utilisateur a le droit de créer) ; `"none"` (ou `null`)
  pour aucune ; ou une barre composée de ses éléments : `CollectionToolbar` (avec `start` et `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  et `CollectionAddButton`. Ils lisent le panneau dans lequel ils sont rendus et génèrent une erreur
  partout ailleurs. Les emplacements de plugins (*plugin slots*) et la surcharge `Collection.Actions` se trouvent dans la
  barre d'outils par défaut.
- `onRowClick` — appelée avec la ligne cliquée et son identifiant au lieu que le panneau
  ne l'ouvre, depuis une ligne, une carte, une carte kanban et l'action de modification. La ligne correspond
  à celle renvoyée par le serveur, au format attendu par `useRows`, `useRow` et `<FieldValue>` :
  exactement ses colonnes, des chaînes de date ISO (`YYYY-MM-DD` pour une colonne
  de date seule), et une relation belongsTo sous forme de sa clé étrangère (`customerId`). Une relation dont le panneau a chargé
  la cible arrive imbriquée sous son nom, telle que l'opération `include` de REST la renvoie
  (`order.customer` correspond à la ligne du client) ; sa clé étrangère s'y trouve également. L'identifiant
  est la chaîne par laquelle l'administration fait référence à l'enregistrement — sa clé primaire, ou les parties d'une clé
  composite jointes par `:::` — que reçoivent `highlightedIds` et
  `useSidePanel().open`. `row.id` est la colonne `id` de l'enregistrement, lorsque la
  table en possède une, avec le type de cette colonne : `5` pour une clé entière, dont l'identifiant est
  `"5"`.
- `rowActions` — votre propre JSX sur chaque ligne, carte et carte kanban, recevant
  la ligne et son identifiant : un bouton « Approuver », « Expédier ». Dans le tableau, il s'agit de la dernière colonne,
  toujours visible ; sur une ligne de liste, une carte et une carte kanban, elle se place à côté des
  actions propres à la collection. Un clic dessus n'ouvre pas l'enregistrement, et elle
  est réaffichée avec l'état de votre composant, de sorte qu'un indicateur `saving` permet de la désactiver.
- `orderBy` — l'ordre dans lequel les lignes s'ouvrent, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. L'utilisateur peut toujours trier selon une autre colonne.
- `highlightedIds` — les identifiants des lignes affichées comme sélectionnées, par exemple celle qu'une page
  affiche à côté de la liste : `highlightedIds={selected ? [selected] : []}`.
  `[]` n'en met aucune en surbrillance. Sans cette prop, le panneau met en surbrillance la dernière ligne ouverte. Les identifiants
  sont comparés sous forme de chaînes de caractères, donc un `5` et un `"5"` pour une clé entière représentent la même ligne.
- `where` — les lignes à inclure, telles que `useRows` les accepte :
  `where={{ status: ["==", "pending"] }}`. Les filtres que l'utilisateur applique sur d'autres
  champs s'y combinent, et ses propres champs ne peuvent être modifiés ni effacés depuis
  la barre d'outils. Il suit la prop, de sorte qu'une barre d'onglets ou un clic sur une barre de graphique peut
  la piloter depuis l'état (*state*). Elle s'applique par-dessus le `fixedFilter` de la collection,
  champ par champ.
- `viewMode` — le mode dans lequel elle s'ouvre, prioritaire sur celui de l'URL et sur celui
  que l'utilisateur a choisi en dernier. Il peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni l'en-tête propre à la vue en liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres
  `__view`, de filtre et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban, sous forme
de boutons lorsqu'elles sont déclarées avec `collapsed: false` et dans le menu de la ligne dans le cas contraire — un
bouton « Approuver » sur chaque carte représente une seule action.

Un panneau s'adapte à la taille de ses lignes. Sans hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, tandis qu'une collection longue
défile dans l'espace dont elle dispose, jusqu'à la hauteur de la fenêtre. Donnez-lui une hauteur pour
qu'il la remplisse. Sa disposition s'adapte à sa propre largeur et non à celle de la fenêtre : dans une colonne
étroite, il utilise sa disposition compacte, quelle que soit la taille de l'écran.

`propertiesOrder` réorganise et ne masque jamais : une propriété omise est affichée
après celles qu'elle mentionne. Pour en masquer une partout, définissez `admin.hideFromCollection`
dessus ; pour n'en afficher que certaines à un endroit donné, passez `fields`.

## Le formulaire d'un enregistrement

`<EntityFormPanel>` fait de même pour le formulaire d'un enregistrement. Il charge l'enregistrement
par son `id`, l'enregistre via la couche de données de `<Rebase>` comme le fait le
formulaire de l'administration, et appelle `onSaved` après chaque sauvegarde avec l'enregistrement sauvegardé tel que le
serveur renvoie la ligne, `row`, et son `id`. Omettez `id` pour créer un
enregistrement. `onClose` est appelé lorsque le formulaire demande à être fermé, par exemple après
la suppression de son enregistrement :

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Comme `CollectionPanel`, le formulaire et `RecordDetail` acceptent une collection
enregistrée par son nom, sans avoir besoin de manipuler l'objet de configuration :
`<EntityFormPanel collection="posts" id={postId}/>` (`path="posts"` fonctionne également). Sous `<RebaseCMS>` ou un
`CollectionsProvider` qui l'enregistre, c'est tout ce dont ils ont besoin. Sans portée (*scope*)
parente, transmettez la collection comme valeur, comme ici, et le panneau apporte la
sienne ; une collection désignée par un chemin que rien n'enregistre indiquera que l'enregistrement est introuvable.

Si quelqu'un d'autre supprime l'enregistrement pendant que le formulaire est ouvert, celui-ci conserve
ce qui a été saisi et indique que l'enregistrement a été supprimé ailleurs. Son action « Enregistrer en tant que nouveau »
le transforme en un formulaire qui crée un nouvel enregistrement avec ces valeurs ;
`onSaved` signale ensuite le nouvel enregistrement.

<span class="since-badge" data-since="0.29">Depuis 0.29</span> Le formulaire peut afficher
une partie d'un enregistrement ou l'agencer selon vos souhaits. `fields` affiche uniquement les champs qu'il
énumère, dans cet ordre ; les sections et le rail conservent leur groupement.
Les éléments enfants remplacent les champs générés par votre propre JSX, dans lequel
`<FormField name="…"/>` affiche un champ avec le libellé, la taille et les règles que le
formulaire généré lui attribue :

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</EntityFormPanel>
```

`compact` est la version dense pour une carte latérale ou un panneau de 350 à 700 px : pas de rail
à côté des champs (son contenu se replie dans la colonne), pas de métadonnées d'enregistrement,
des contrôles de hauteur moyenne et un espacement plus resserré :
`<EntityFormPanel collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

Dans les deux cas, le formulaire ne valide que les champs qu'il affiche ; le serveur vérifie
toujours l'intégralité de l'enregistrement. Un formulaire qui crée un enregistrement et omet un
champ requis sans valeur par défaut l'indique dès son ouverture : une erreur nomme le
champ, et l'enregistrement reste bloqué jusqu'à ce que le champ soit affiché ou qu'une valeur par défaut lui soit attribuée.
`collectionOverrides` modifie la collection uniquement pour ce formulaire, tout comme pour
`CollectionPanel`.

Chaque formulaire isole ses identifiants DOM, de sorte que deux formulaires peuvent cohabiter sur une même page. Pour cibler
un champ lors d'un test, sélectionnez `[data-form-field="title"]` à l'intérieur du
`[data-form-path="posts"]` du formulaire.

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
`<RecordDetail>` est le pendant en lecture seule de `EntityFormPanel`. Il charge
l'enregistrement par son `id` et l'affiche comme le fait la page d'enregistrement de l'administration : les mêmes
sections et libellés, avec chaque valeur sous forme d'aperçu, de sorte qu'une énumération apparaît sous forme de
puce (*chip*), une date dans son fuseau horaire et une relation sous forme du titre de sa cible. Il accepte
`fields` et `collectionOverrides` de la même manière que le formulaire, et omet les champs
que le formulaire omet : ceux masqués par une règle `conditions.hidden` pour cet enregistrement, et
ceux que l'utilisateur connecté n'a pas le droit de lire.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur unique de la même manière, au sein de votre propre JSX : transmettez-lui la
valeur telle que le serveur la renvoie. Une relation belongsTo arrive sous forme de clé étrangère
(`order.customerId`), ainsi `field="customer" value={order.customerId}` affiche le titre de
l'enregistrement lié ; nommer directement la clé étrangère, `field="customerId"`,
donne le même résultat. Il nécessite que la collection soit enregistrée en amont, par `<RebaseCMS>`
ou un `CollectionsProvider`. Une collection ou un champ inconnu lève une erreur
qui le mentionne.

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

Les trois panneaux intègrent leur propre `CollectionsProvider` lorsqu'aucun n'est présent au-dessus d'eux. Il s'agit
de la couche sous-jacente, et vous pouvez la monter vous-même pour partager une même portée entre
plusieurs panneaux, ou pour utiliser les éléments de plus bas niveau (`CollectionViewBinding`,
`useSidePanel`) en dessous. À l'intérieur, un panneau peut désigner sa collection par son `path` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` contient un registre des collections que vous lui transmettez, avec
les fonctions `modifyCollection` et `injectCollections` de vos plugins appliquées comme dans
l'administration, ainsi que les panneaux latéraux et boîtes de dialogue dans lesquels les enregistrements s'ouvrent, et le
gestionnaire des modifications non enregistrées. Veillez à ce que le tableau `collections` reste stable : une constante de module
ou `useMemo`.

## Étapes suivantes

- [Personnaliser l'administration](/docs/frontend/customizing) : les emplacements où vos
  composants peuvent s'insérer, et les recettes construites à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes que ces panneaux et `FieldValue` lisent.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacer la vue
  ou le formulaire qu'un panneau affiche.
