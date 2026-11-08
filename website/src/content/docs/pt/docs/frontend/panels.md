---
sourceHash: 29030083cf83fb27
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma coleção, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, sem o shell de administração em volta deles."
---

Na versão 0.24,
o `CollectionPanel` aceita apenas um `path` registrado e renderiza "Collection not
found" fora da árvore administrativa completa, e `EntityFormPanel` e
`CollectionsProvider` não existem.

Você não precisa de todo o painel de administração para exibir uma tabela. O `<CollectionPanel>` recebe
a coleção como um valor e funciona em qualquer lugar sob o `<Rebase>` e um
roteador do React Router, sem a necessidade de `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`:

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

Um registro abre sobre a sua página, em um painel lateral ou caixa de diálogo, e nunca por URL:
nenhuma rota de administração serve a página, portanto `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para seus próprios componentes ali.
Qualquer roteador funciona: um `<BrowserRouter>` simples, um `<MemoryRouter>` ou um data router.
Um roteador ainda é obrigatório. Um data router também permite que um registro com alterações
não salvas impeça a navegação interna no app; com os outros, apenas o aviso de sair da página do
navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página deve exibir o login do Rebase primeiro.

## O que um painel exibe

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Um painel renderiza a coleção assim como a administração faz. Estas props o limitam ao que
sua página precisa; nenhuma delas altera a página da própria coleção.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order) => setSelected(order.id)}
    className="max-h-[480px]"/>
```

- `fields` — as propriedades que ele exibe, nesta ordem, e nada mais. Na
  tabela, elas são as colunas. Na lista, em um card e em um card kanban, elas
  são a partir de onde os espaços da linha — título, imagem, subtítulo, status, data,
  chips de relação, as colunas da lista — são preenchidos, os primeiros primeiro; um espaço
  que nenhum deles preencher permanece vazio. Para este painel, ela tem precedência sobre `propertiesOrder`,
  a ordem de colunas salva pelo usuário e `listProperties`. As larguras de coluna ajustadas
  pelo usuário ainda persistem; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — a barra de ferramentas completa por padrão, `null` para nenhuma, ou uma composta
  por suas partes: `CollectionToolbar` (com `start` e `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Elas leem o painel no qual são renderizadas e geram erro
  em qualquer outro lugar. Os slots de plugin e a sobreposição `Collection.Actions` residem na
  barra de ferramentas padrão.
- `onRowClick` — chamada com a linha clicada em vez de o painel abri-la,
  a partir de uma linha, um card, um card kanban e da ação de edição. A linha é a mesma
  enviada pelo servidor, no formato que `useRows`, `useRow` e `<FieldValue>` aceitam: strings
  de data ISO (`YYYY-MM-DD` para uma coluna somente com data) e uma relação belongsTo
  como sua chave estrangeira (`customerId`), não sob o nome da relação.
- `viewMode` — o modo no qual ele abre, sobrepondo o da URL e o último
  selecionado pela pessoa. Ela ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da visualização em lista.
- `updateUrl` — desativado por padrão: o painel não lê nem escreve os parâmetros
  `__view`, de filtro e de ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card kanban,
como botões quando declaradas com `collapsed: false` e no menu da linha caso contrário — um
"Aprovar" em cada card é uma ação.

Um painel ajusta seu tamanho às suas linhas. Sem uma altura vinda de seu elemento pai, ou apenas com
um `max-height`, uma coleção curta renderiza sua barra de ferramentas e linhas, e uma longa
rola dentro do espaço disponível, até a altura da janela. Defina uma altura para
preenchê-la. Ele organiza seu layout de acordo com sua própria largura, não a da janela: em uma
coluna estreita, ele usa seu layout compacto, independentemente da tela.

`propertiesOrder` reordena e nunca oculta: uma propriedade deixada de fora é renderizada
após as que ele especifica. Para ocultar uma em todos os lugares, defina `admin.hideFromCollection`
nela; para exibir apenas algumas em um local, passe `fields`.

## Formulário de um registro

O `<EntityFormPanel>` faz o mesmo para o formulário de um registro. Ele carrega o registro
por `entityId`, salva-o por meio da camada de dados do `<Rebase>` assim como o formulário da
própria administração faz, e chama `onSaved` após cada salvamento. Omita `entityId` para criar
um registro. `onClose` é chamado quando o formulário solicita a saída, por exemplo após
seu registro ser excluído:

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário mantém
o que foi digitado e informa que o registro foi excluído em outro lugar. Sua ação "Save as new"
o transforma em um formulário que cria um novo registro com esses valores;
`onSaved` então reporta o novo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> O formulário pode exibir
parte de um registro ou organizá-lo à sua maneira. `fields` exibe apenas os campos
especificados, nessa ordem; as seções e o rail mantêm seu agrupamento. `layout`
substitui os campos gerados pelo seu próprio JSX, no qual
`<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras fornecidos pelo
formulário gerado:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    entityId={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

De qualquer forma, o formulário valida apenas os campos que exibe; o servidor ainda
verifica o registro inteiro. Um formulário que cria um registro e deixa de fora um
campo obrigatório sem valor padrão avisa quando for aberto: um erro indica o
campo, e a ação Salvar permanece bloqueada até que o campo seja exibido ou receba um valor padrão.
`collectionOverrides` altera a coleção apenas para este formulário, assim como faz para o
`CollectionPanel`.

Cada formulário isola o escopo de seus IDs de DOM, para que dois formulários possam compartilhar uma página. Para encontrar um campo
a partir de um teste, selecione `[data-form-field="title"]` dentro do
`[data-form-path="posts"]` do formulário.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
O `<EntityViewPanel>` é o equivalente somente leitura do `EntityFormPanel`. Ele carrega o
registro por `entityId` e o renderiza da mesma forma que a página de registro da administração: as mesmas
seções e rótulos, com cada valor como sua pré-visualização, de modo que um enum é exibido como seu
chip, uma data em seu fuso horário e uma relação como o título de seu destino. Ele aceita
`fields` e `collectionOverrides` assim como o formulário, e omite os campos que
o formulário omite: aqueles que uma regra `conditions.hidden` oculta para este registro e
aqueles que o usuário autenticado não pode ler.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    entityId={orderId}
    fields={["customer", "status", "total"]}/>
```

O `<FieldValue>` renderiza um valor da mesma forma, dentro do seu próprio JSX. Ele aceita a
linha inteira, como `useRows`, `useRow` e `client.data` a retornam, porque uma
relação belongsTo chega sob a coluna de sua chave estrangeira (`customerId`), não
sob o nome da propriedade; `field="customer"` a encontra ali. Ele precisa da
coleção registrada acima dele, por meio do `<RebaseCMS>` ou de um `CollectionsProvider`.
Uma coleção ou campo desconhecido dispara um erro que o identifica.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} collection="orders" field="customer"/>
            <FieldValue row={row} collection="orders" field="status"/>
            <FieldValue row={row} collection="orders" field="placedAt"/>
        </div>
    ));
}
```

## Vários painéis em um único escopo

Os três painéis trazem seu próprio `CollectionsProvider` quando não houver nenhum acima deles. Essa é
a camada subjacente, e você mesmo pode montá-la para compartilhar um único escopo entre
vários painéis, ou para usar os componentes de nível mais baixo (`CollectionViewBinding`,
`useSidePanel`) sob ele. Dentro dele, um painel pode indicar sua coleção por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

O `CollectionsProvider` mantém um registro das coleções passadas para ele, com o
`modifyCollection` e o `injectCollections` dos seus plugins aplicados como na
administração, além dos painéis laterais e caixas de diálogo nos quais os registros são abertos, e a
proteção contra alterações não salvas. Mantenha o array `collections` estável: uma constante de módulo,
ou `useMemo`.

## Próximos passos

- [Customizando o admin](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que esses painéis e o `FieldValue` leem.
- [Sobrescrita de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário que um painel renderiza.
