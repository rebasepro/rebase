---
sourceHash: 53beac2b1e144124
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma coleção, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, RecordForm, RecordDetail, FieldValue e CollectionsProvider, sem nenhuma shell de admin ao redor deles."
---

Você não precisa de todo o admin para exibir uma tabela. O `<CollectionPanel>` aceita
a coleção como um valor e funciona em qualquer lugar sob `<Rebase>` e um roteador do
React Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`:

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

Um registro abre sobre a sua página, em um painel lateral ou em um diálogo, e nunca por URL:
nenhuma rota de admin serve a página, portanto `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para seus próprios
componentes ali. Qualquer roteador funciona: um `<BrowserRouter>` simples, um
`<MemoryRouter>`, ou um roteador de dados. Um roteador ainda é necessário. Um roteador de dados
também permite que um registro com alterações não salvas impeça a navegação dentro do app; sob os
outros, apenas o aviso de saída de página do navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página
deve exibir o login do Rebase primeiro.

## O que um painel exibe

Um painel renderiza a coleção assim como o admin faz. Estas props restringem-no àquilo de que
sua página precisa; nenhuma delas altera a própria página da coleção.

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

`collection` aceita o nome da coleção, como aqui, ou a própria coleção como
um valor (`collection={ordersCollection}`); `path` também a identifica, e endereça uma
subcoleção por seu caminho completo.

- `fields` — as propriedades que ele exibe, nesta ordem, e nada mais. Na
  tabela, elas são as colunas. Na lista, em um card e em um card kanban, elas
  são a origem de preenchimento dos locais da linha — título, imagem, subtítulo,
  status, data, chips de relação, as colunas da lista —, os primeiros vêm
  primeiro; um local que nenhum deles preenche permanece vazio. Para este painel,
  ele prevalece sobre `propertiesOrder`, a ordem de colunas salva por um usuário e
  `listProperties`. As larguras de coluna arrastadas por um usuário continuam
  persistindo; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — `"full"`, o padrão; `"compact"`, que é a busca, a
  alternância de modo de visualização e Novo (onde o usuário pode criar); `"none"`
  (ou `null`) para nenhum; ou uma composta por suas partes: `CollectionToolbar`
  (com `start` e `end`), `CollectionSearchBar`, `CollectionFiltersButton`,
  `CollectionViewModeToggle` e `CollectionAddButton`. Eles leem o painel no qual
  são renderizados e geram erro em qualquer outro lugar. Os slots de plugin e a
  sobreposição `Collection.Actions` residem na barra de ferramentas padrão.
- `onRowClick` — chamado com a linha clicada e seu id em vez de o painel
  abri-la, a partir de uma linha, um card, um card kanban e a ação de edição.
  A linha é aquela enviada pelo servidor, o formato aceito por `useRows`,
  `useRow` e `<FieldValue>`: exatamente suas colunas, strings de data ISO
  (`YYYY-MM-DD` para uma coluna somente de data) e uma relação belongsTo como
  sua chave estrangeira (`customerId`). Uma relação cujo destino foi carregado
  pelo painel chega aninhada sob seu nome, assim como o `include` de REST retorna
  (`order.customer` é a linha do cliente); sua chave estrangeira também está
  presente. O id é a string pela qual o admin endereça o registro — sua chave
  primária, com as partes de uma chave composta unidas por `:::` — aceita por
  `highlightedIds` e `useSidePanel().open`. `row.id` é a coluna `id` do registro,
  quando a tabela tiver uma, com o tipo daquela coluna: `5` para uma chave inteira,
  cujo id é `"5"`.
- `rowActions` — seu próprio JSX em cada linha, card e card kanban, recebendo a
  linha e seu id: um "Approve", um "Ship". Na tabela, é a última coluna,
  sempre visível; em uma linha de lista, em um card e em um card kanban, fica ao
  lado das próprias ações da coleção. Um clique nela não abre o registro, e ela
  renderiza novamente com o estado do seu componente, para que uma flag `saving`
  a desative.
- `orderBy` — a ordem em que as linhas são abertas, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. O usuário ainda pode ordenar por outra coluna.
- `highlightedIds` — os ids das linhas renderizadas como selecionadas, como aquela
  que uma página exibe ao lado da lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` não renderiza nenhuma. Sem isso, o painel destaca a última linha aberta. Os
  ids são comparados como strings, de modo que `5` e `"5"` de uma chave inteira
  correspondem à mesma linha.
- `where` — quais linhas ele contém, da forma aceita por `useRows`:
  `where={{ status: ["==", "pending"] }}`. Os filtros definidos pelo usuário em
  outros campos são combinados a ele, e seus próprios campos não podem ser
  alterados ou limpos na barra de ferramentas. Ele acompanha a prop, de modo que
  uma barra de abas ou uma barra de gráfico clicada pode controlá-lo a partir do
  estado. Ele tem precedência sobre o `fixedFilter` da coleção, campo por campo.
- `viewMode` — o modo em que ele é aberto, sobrepondo-se ao da URL e ao que o
  usuário escolheu por último. O usuário ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da
  visualização de lista.
- `updateUrl` — desativado por padrão: o painel não lê nem grava os parâmetros
  `__view`, de filtro e de ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card kanban,
como botões quando declaradas com `collapsed: false` e no menu da linha caso
contrário — um "Approve" em cada card é uma ação.

Um painel dimensiona-se de acordo com suas linhas. Sem uma altura definida pelo
elemento pai, ou apenas com um `max-height`, uma coleção curta renderiza sua
barra de ferramentas e linhas, e uma longa rola dentro do espaço disponível, até
a altura da janela. Defina uma altura para preenchê-la. Ele se organiza com base
em sua própria largura, não na da janela: em uma coluna estreita, ele usa seu
layout compacto, independentemente da tela.

`propertiesOrder` reordena e nunca oculta: uma propriedade que ele omite é
renderizada após as que ele nomeia. Para ocultar uma em todos os lugares, defina
`admin.hideFromCollection` nela; para exibir apenas algumas em um local, passe
`fields`.

## Formulário de um único registro

`<RecordForm>` faz o mesmo para o formulário de um único registro (era
`EntityFormPanel` antes da 0.29; esse nome ainda funciona e emite um aviso uma
vez). Ele carrega o registro por `id`, salva-o por meio da camada de dados do
`<Rebase>` como o próprio formulário do admin faz, e chama `onSaved` após cada
salvamento com o registro salvo conforme o servidor envia a linha, `row`, e
seu `id`. Omita o `id` para criar um registro. `onClose` é chamado quando o
formulário solicita o fechamento, por exemplo, após a exclusão de seu registro:

```tsx
<RecordForm
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Assim como o `CollectionPanel`, o formulário e o `RecordDetail` aceitam uma coleção
registrada pelo seu nome, sem a necessidade de um objeto de configuração em mãos:
`<RecordForm collection="posts" id={postId}/>` (`path="posts"` também funciona). Sob `<RebaseCMS>` ou um
`CollectionsProvider` que a registre, isso é tudo de que precisam. Sem nenhum escopo
acima, passe a coleção como um valor, como aqui, e o painel fornecerá o seu
próprio; uma identificada por um caminho que nada registra informará que o registro
não foi encontrado.

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário
manterá o que foi digitado e informará que o registro foi excluído em outro lugar.
Sua ação "Save as new" o transforma em um formulário que cria um novo registro com
esses valores; `onSaved` então reporta o novo registro.

O formulário pode
exibir parte de um registro ou organizá-lo à sua maneira. `fields` exibe apenas os
campos informados, nessa ordem; as seções e a barra lateral (rail) mantêm seu
agrupamento. Elementos filhos (children) substituem os campos gerados pelo seu próprio
JSX, no qual `<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras
fornecidos pelo formulário gerado:

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

`compact` é o formulário denso para um card lateral ou um painel de 350–700px: sem
barra lateral (rail) ao lado dos campos (o que ela contém é agrupado na coluna), sem
metadados do registro, controles de altura média e preenchimento (padding) mais compacto:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De qualquer forma, o formulário valida apenas os campos exibidos; o servidor ainda
verifica o registro completo. Um formulário que cria um registro e omite um campo
obrigatório sem valor padrão avisa quando é aberto: um erro indica o campo, e o
salvamento permanece bloqueado até que o campo seja exibido ou receba um valor
padrão. `collectionOverrides` altera a coleção apenas para este formulário, assim como
faz para o `CollectionPanel`.

Cada formulário delimita seus IDs de DOM, para que dois formulários possam
compartilhar uma página. Para encontrar um campo a partir de um teste, selecione
`[data-form-field="title"]` dentro do `[data-form-path="posts"]` do formulário.

`<RecordDetail>` é o gêmeo somente leitura do `RecordForm`. Ele carrega o
registro por `id` e o renderiza como a página de registro do admin faz: as
mesmas seções e rótulos, com cada valor em sua visualização prévia, de modo que
um enum é exibido como seu chip, uma data em seu fuso horário e uma relação
como o título do seu destino. Ele aceita `fields` e `collectionOverrides` da mesma
forma que o formulário, e omite os campos que o formulário omite: aquele que uma
regra `conditions.hidden` oculta para este registro, e aquele que o usuário
autenticado não tem permissão para ler.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderiza um valor da mesma forma, dentro do seu próprio JSX: passe
o valor conforme o servidor o envia. Uma relação belongsTo chega como sua chave
estrangeira (`order.customerId`), portanto `field="customer" value={order.customerId}`
renderiza o título do registro relacionado; informar a própria chave estrangeira,
`field="customerId"`, faz o mesmo. Ele precisa da coleção registrada acima dele,
pelo `<RebaseCMS>` ou por um `CollectionsProvider`. Uma coleção ou campo desconhecido
lança um erro especificando o nome.

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

## Vários painéis em um único escopo

Os três painéis fornecem seu próprio `CollectionsProvider` quando nenhum está acima
deles. Essa é a camada subjacente, e você pode montá-la por conta própria para
compartilhar um escopo entre vários painéis ou para usar as partes de nível inferior
(`CollectionViewBinding`, `useSidePanel`) sob ele. Dentro dele, um painel pode
indicar sua coleção por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantém um registro das coleções fornecidas a ele, com o
`modifyCollection` e `injectCollections` dos seus plugins aplicados como no
admin, além dos painéis laterais e diálogos nos quais os registros são abertos, e
a proteção contra alterações não salvas. Mantenha o array `collections` estável:
uma constante de módulo ou `useMemo`.

## Próximos passos

- [Personalizando o admin](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que estes painéis e o `FieldValue` leem.
- [Substituições de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário renderizado por um painel.
