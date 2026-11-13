---
sourceHash: 7a427ea4f8f8b272
title: Des panneaux dans votre propre page
sidebar_label: Panneaux dans vos propres pages
description: "Affichez une table, le formulaire d'un enregistrement, un enregistrement ou une valeur dans votre propre page : CollectionPanel, RecordForm, RecordDetail, FieldValue et CollectionsProvider, sans shell d'administration autour d'eux."
---

Vous n'avez pas besoin de l'admin complet pour afficher une table. `<CollectionPanel>` prend
une table via son slug et fonctionne n'importe où sous `<Rebase>` et un routeur
React Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>` :

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection="posts"/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un enregistrement s'ouvre au-dessus de votre page, dans un panneau latéral ou une boîte de dialogue, et jamais par URL :
aucune route d'administration ne dessert la page, donc `full_screen` et `split` s'ouvrent sous
forme de panneau latéral, et `useUrlController().routesMounted` vaut `false` pour vos
propres composants à cet endroit. N'importe quel routeur fonctionne : un simple `<BrowserRouter>`, un
`<MemoryRouter>` ou un routeur de données. Un routeur reste obligatoire. Un routeur de données
permet également à un enregistrement contenant des modifications non enregistrées d'interrompre la navigation dans l'application ; avec
les autres, seule l'invite de fermeture de page du navigateur fait office de garde-fou. Enveloppez le panneau dans `<RebaseAuthGate>` si la page
doit d'abord afficher la connexion Rebase.

## Ce qu'affiche un panneau

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un panneau affiche la table comme le fait l'admin — à partir du descripteur servi par
le serveur, avec les éventuels `customizeTable` que vous avez enregistrés. Ces props permettent de la restreindre à ce dont
votre page a besoin ; aucune d'entre elles ne modifie la page propre de la table dans l'admin.

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

`collection` prend le slug de la table, comme ici, ou une collection externe
(`defineFirestoreCollection`) en tant que valeur ; `path` permet également de la désigner, et adresse une
collection imbriquée par son chemin complet.

- `fields` — les propriétés qu'il affiche, dans cet ordre, et rien d'autre. Dans
  la table, ce sont les colonnes. Dans la liste, sur une carte et sur une carte kanban, elles
  servent à remplir les emplacements de la ligne — titre, image, sous-titre, statut, date,
  chips de relation, colonnes de la liste —, les premières en priorité ; un emplacement qu'aucune
  d'entre elles ne remplit reste vide. Pour ce panneau, elle prévaut sur `propertiesOrder`,
  l'ordre des colonnes enregistré par l'utilisateur et `listProperties`. Les largeurs de colonne ajustées
  par un utilisateur persistent toujours ; l'ordre étant le vôtre, les colonnes ne peuvent pas être réorganisées par glisser-déposer.
- `toolbar` — `"full"`, la valeur par défaut ; `"compact"`, qui correspond à la recherche, au
  sélecteur de mode de vue et à Nouveau (lorsque l'utilisateur peut créer) ; `"none"` (ou `null`)
  pour aucune barre d'outils ; ou une barre composée de ses éléments : `CollectionToolbar` (avec `start` et `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  et `CollectionAddButton`. Ils lisent le panneau dans lequel ils sont affichés, et lèvent une erreur
  partout ailleurs. Les slots de plugins et la surcharge `Collection.Actions` résident dans la
  barre d'outils par défaut.
- `onRowClick` — appelé avec la ligne cliquée et son identifiant au lieu que le panneau ne
  l'ouvre, depuis une ligne, une carte, une carte kanban et l'action d'édition. La ligne correspond à
  celle envoyée par le serveur, avec la structure attendue par `useRows`, `useRow` et `<FieldValue>` :
  exactement ses colonnes, des chaînes de date ISO (`YYYY-MM-DD` pour une
  colonne de date seule), et une relation belongsTo sous forme de sa clé étrangère (`customerId`). Une relation dont le panneau a chargé
  la cible arrive imbriquée sous son nom, telle que renvoyée par un `include` REST
  (`order.customer` correspond à la ligne du client) ; sa clé étrangère s'y trouve également.
  L'identifiant est la chaîne par laquelle l'admin référence l'enregistrement — sa clé primaire, les parties
  d'une clé composite étant jointes par `:::` — acceptée par `highlightedIds` et
  `useSidePanel().open`. `row.id` est la colonne `id` de l'enregistrement, lorsque
  la table en possède une, avec le type de cette colonne : `5` pour une clé entière, dont l'identifiant est
  `"5"`.
- `rowActions` — votre propre JSX sur chaque ligne, carte et carte kanban, recevant la
  ligne et son id : un « Approuver », un « Expédier ». Dans la table, il s'agit de la dernière colonne,
  toujours visible ; sur une ligne de liste, une carte et une carte kanban, elle se place à côté des
  actions propres de la collection. Un clic dessus n'ouvre pas l'enregistrement, et elle
  s'affiche à nouveau avec l'état de votre composant, de sorte qu'un drapeau `saving` la désactive.
- `orderBy` — l'ordre dans lequel les lignes s'affichent à l'ouverture, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. L'utilisateur peut toujours trier par une autre colonne.
- `highlightedIds` — les identifiants des lignes affichées comme sélectionnées, par exemple celle qu'une page
  affiche à côté de la liste : `highlightedIds={selected ? [selected] : []}`.
  `[]` n'en affiche aucune. Sans cela, le panneau met en surbrillance la dernière ligne ouverte. Les identifiants
  sont comparés sous forme de chaînes de caractères, de sorte que le `5` et le `"5"` d'une clé entière représentent la même ligne.
- `where` — les lignes qu'il contient, tel qu'accepté par `useRows` :
  `where={{ status: ["==", "pending"] }}`. Les filtres définis par l'utilisateur sur d'autres
  champs s'y combinent, et ses propres champs ne peuvent être ni modifiés ni effacés depuis
  la barre d'outils. Il suit la prop, de sorte qu'une barre d'onglets ou un clic sur une barre de graphique peut
  le piloter depuis l'état. Il prévaut sur le `fixedFilter` de la collection, champ par
  champ.
- `viewMode` — le mode dans lequel il s'ouvre, prioritaire sur celui dans l'URL et sur celui que
  l'utilisateur a sélectionné en dernier. L'utilisateur peut toujours en changer.
- `title={false}` — aucun titre au-dessus du panneau, ni l'en-tête propre de la vue en liste.
- `updateUrl` — désactivé par défaut : le panneau ne lit ni n'écrit les paramètres
  `__view`, de filtre et de tri de la page.

Les `entityActions` de la collection s'affichent sur chaque ligne, carte et carte kanban, sous
forme de boutons lorsqu'elles sont déclarées avec `collapsed: false`, et dans le menu de la ligne dans le cas contraire — un bouton
« Approuver » sur chaque carte représente une action.

Un panneau s'ajuste à ses lignes. En l'absence de hauteur définie par son parent, ou avec seulement un
`max-height`, une collection courte affiche sa barre d'outils et ses lignes, tandis qu'une collection longue
défile à l'intérieur de l'espace disponible, jusqu'à concurrence de la hauteur de la fenêtre. Donnez-lui une hauteur pour
la remplir. Il s'adapte en fonction de sa propre largeur, et non de celle de la fenêtre : dans une colonne
étroite, il utilise sa disposition compacte, quelle que soit la taille de l'écran.

`fieldOrder` dans le `customizeTable` de la table réordonne et ne masque jamais : un champ
qu'il omet est affiché après ceux qu'il mentionne. Pour exclure un champ de la liste
partout, définissez `hidden: true` dans ses options de champ ; pour n'en afficher que certains à un
endroit précis, transmettez `fields`.

## Formulaire d'un seul enregistrement

`<RecordForm>` fait de même pour le formulaire d'un enregistrement (il s'appelait `EntityFormPanel`
avant la 0.29 ; ce nom fonctionne toujours et émet un avertissement unique). Il charge l'enregistrement
par son `id`, l'enregistre via la couche de données de `<Rebase>` comme le fait le
propre formulaire de l'admin, et appelle `onSaved` après chaque sauvegarde avec l'enregistrement sauvegardé tel que le
serveur renvoie la ligne, `row`, et son `id`. Omettez `id` pour créer un
enregistrement. `onClose` est appelé lorsque le formulaire demande à être quitté, par exemple après
la suppression de son enregistrement :

```tsx
<RecordForm
    collection="posts"
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Comme `CollectionPanel`, le formulaire et `RecordDetail` prennent une table par son slug
(`path="posts"` fonctionne également). Toutes les tables servies par le serveur leur sont connues,
sous `<RebaseCMS>`, sous un `CollectionsProvider`, ou sans scope parent, auquel
cas le panneau fournit le sien. Une collection externe est transmise sous
forme de valeur. Une collection désignée par un chemin que rien ne dessert indique que l'enregistrement est introuvable.

Si quelqu'un d'autre supprime l'enregistrement pendant que le formulaire est ouvert, le formulaire conserve
ce qui a été saisi et indique que l'enregistrement a été supprimé ailleurs. Son action « Enregistrer en tant que nouveau »
le transforme en un formulaire qui crée un nouvel enregistrement avec ces valeurs ;
`onSaved` signale ensuite le nouvel enregistrement.

Le formulaire peut afficher
une partie d'un enregistrement ou l'agencer à votre convenance. `fields` n'affiche que les champs qu'il
mentionne, dans cet ordre ; les sections et le rail conservent leur groupement. Les enfants (children)
remplacent les champs générés par votre propre JSX, dans lequel
`<FormField name="…"/>` affiche un champ avec le libellé, la taille et les règles que lui
attribue le formulaire généré :

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

`compact` est le formulaire condensé destiné à une carte latérale ou à un panneau de 350–700 px : pas de rail
à côté des champs (son contenu se replie dans la colonne), pas de métadonnées d'enregistrement,
des contrôles de hauteur moyenne et un espacement plus restreint :
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

Dans les deux cas, le formulaire ne valide que les champs qu'il affiche ; le serveur vérifie
toujours l'ensemble de l'enregistrement. Un formulaire qui crée un enregistrement et omet un
champ obligatoire sans valeur par défaut le signale dès son ouverture : une erreur nomme le
champ, et le bouton Enregistrer reste bloqué tant que le champ n'est pas affiché ou qu'une valeur par défaut ne lui est pas attribuée.
`collectionOverrides` modifie la présentation pour ce formulaire uniquement, comme il le fait pour
`CollectionPanel`.

Chaque formulaire isole ses identifiants DOM (scope), permettant ainsi à deux formulaires de coexister sur une même page. Pour cibler un champ
depuis un test, sélectionnez `[data-form-field="title"]` à l'intérieur de
`[data-form-path="posts"]` du formulaire.

`<RecordDetail>` est l'équivalent en lecture seule de `RecordForm`. Il charge
l'enregistrement par son `id` et l'affiche comme le fait la page d'enregistrement de l'admin : les
mêmes sections et libellés, chaque valeur apparaissant selon son aperçu, de sorte qu'un enum s'affiche sous
forme de chip, une date dans son fuseau horaire et une relation avec le titre de sa cible. Il accepte
`fields` et `collectionOverrides` comme le fait le formulaire, et omet les champs que
le formulaire omet : ceux qu'une règle `conditions.hidden` masque pour cet enregistrement, et
ceux que l'utilisateur connecté n'est pas autorisé à lire.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` affiche une valeur de la même manière, au sein de votre propre JSX : transmettez-lui la
valeur telle que le serveur la renvoie. Une relation belongsTo arrive sous forme de sa clé étrangère
(`order.customerId`), ainsi `field="customer" value={order.customerId}` affiche le titre
de l'enregistrement lié ; nommer la clé étrangère elle-même, `field="customerId"`,
produit le même résultat. Il nécessite que la table soit connue en amont, par `<RebaseCMS>` ou un
`CollectionsProvider`. Une collection ou un champ inconnu lève une erreur
le précisant.

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

## Plusieurs panneaux dans un même scope

Les trois panneaux intègrent leur propre `CollectionsProvider` lorsqu'aucun n'est présent au-dessus d'eux. C'est
la brique sous-jacente, et vous pouvez la monter vous-même pour partager un scope entre
plusieurs panneaux, ou pour utiliser les éléments de plus bas niveau (`CollectionViewBinding`,
`useSidePanel`) en dessous. Il accepte les mêmes paramètres que `<RebaseCMS>` :

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";
import { postsCms } from "./cms/posts";

const tableCustomizations = [postsCms];

<CollectionsProvider tableCustomizations={tableCustomizations}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` contient un registre des tables servies par le serveur, avec
vos `tableCustomizations` et d'éventuelles `externalCollections`, les
`modifyCollection` et `injectCollections` de vos plugins appliqués comme dans l'admin, ainsi que les
panneaux latéraux et boîtes de dialogue dans lesquels les enregistrements s'ouvrent, et le dispositif de protection contre les modifications non enregistrées. Veillez
à ce que les tableaux restent stables : une constante de module ou `useMemo`. `tables` remplace
les tables servies par les descripteurs que vous transmettez, pour l'intégration et les tests.

## Ensuite

- [Personnaliser l'admin](/docs/frontend/customizing) : les emplacements où placer
  vos composants et les recettes élaborées à partir de ces panneaux.
- [Hooks](/docs/hooks) : `useRows`, `useRow`, `useRowCount`, `useAggregate` et
  `useRowWrites`, les lignes lues par ces panneaux et `FieldValue`.
- [Surcharges de composants](/docs/frontend/component-overrides) : remplacer la vue
  ou le formulaire affiché par un panneau.
