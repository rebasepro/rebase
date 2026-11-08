---
sourceHash: 095805c8d62157c4
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma coleção, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, sem o shell administrativo ao redor deles."
---

No 0.24,
o `CollectionPanel` aceita apenas um `path` registrado e renderiza "Collection not
found" fora da árvore completa do admin, e `EntityFormPanel` e
`CollectionsProvider` não existem.

Você não precisa de todo o admin para exibir uma tabela. O `<CollectionPanel>` recebe
a coleção como um valor e funciona em qualquer lugar sob `<Rebase>` e um
roteador do React Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`:

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

Um registro é aberto sobre a sua página, em um painel lateral ou caixa de diálogo, e nunca por URL:
nenhuma rota do admin serve a página, então `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para seus próprios
componentes ali. Qualquer roteador funciona: um `<BrowserRouter>` simples, um
`<MemoryRouter>` ou um data router. Um roteador ainda é obrigatório. Um data router
também permite que um registro com alterações não salvas interrompa a navegação interna do app; sob os
outros, apenas o aviso de saída de página do navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página
deve exibir o login do Rebase primeiro.

## O que um painel exibe

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Um painel renderiza a coleção assim como o admin faz. Estas props o limitam ao
que a sua página precisa; nenhuma delas altera a própria página da coleção.

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
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

- `fields` — as propriedades que ele exibe, nesta ordem, e nada mais. Na
  tabela, elas são as colunas. Na lista, em um card e em um card kanban, elas
  são a origem com a qual os espaços da linha — título, imagem, subtítulo, status, data,
  chips de relação, as colunas da lista — são preenchidos, os primeiros vindo
  antes; um espaço que nenhum deles preenche permanece vazio. Para este painel, ele prevalece sobre `propertiesOrder`, a
  ordem de colunas salva por um usuário e `listProperties`. As larguras de coluna arrastadas pelo usuário
  ainda persistem; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — a barra de ferramentas completa por padrão, `null` para nenhuma, ou uma composta por
  suas partes: `CollectionToolbar` (com `start` e `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Eles leem o painel no qual são renderizados e lançam
  erros em qualquer outro lugar. Os slots de plugin e a sobreposição de `Collection.Actions` residem na
  barra de ferramentas padrão.
- `onRowClick` — chamado com a linha clicada e seu id em vez de o painel
  abri-la, a partir de uma linha, um card, um card kanban e da ação de edição. A linha é
  aquela enviada pelo servidor, no formato que `useRows`, `useRow` e `<FieldValue>`
  recebem: exatamente suas colunas, strings de data ISO (`YYYY-MM-DD` para uma
  coluna apenas de data) e uma relação belongsTo como sua chave estrangeira (`customerId`). Uma relação cujo destino o painel carregou
  chega aninhada sob seu nome, assim como o `include` do REST a retorna
  (`order.customer` é a linha do cliente); sua chave estrangeira também está lá. O
  id é a string pela qual o admin endereça o registro — sua chave primária, ou as partes de uma
  chave composta unidas por `:::` — que `highlightedIds` e
  `useSidePanel().open` recebem. `row.id` é a coluna `id` do registro, quando a
  tabela possui uma, com o tipo dessa coluna: `5` para uma chave inteira, cujo id é
  `"5"`.
- `highlightedIds` — os ids das linhas renderizadas como selecionadas, como aquela que uma página
  exibe ao lado da lista, por exemplo: `highlightedIds={selected ? [selected] : []}`.
  `[]` não renderiza nenhuma. Sem isso, o painel destaca a última linha aberta. Os ids
  são comparados como strings, de modo que `5` e `"5"` de uma chave inteira correspondem à mesma linha.
- `where` — quais linhas ele contém, da forma como `useRows` aceita:
  `where={{ status: ["==", "pending"] }}`. Filtros definidos pelo usuário em outros
  campos são combinados com ele, e seus próprios campos não podem ser alterados ou limpos
  pela barra de ferramentas. Ele segue a prop, permitindo que uma barra de abas ou uma barra clicada de um gráfico
  o controlem a partir do estado. Ele sobrepõe o `fixedFilter` da coleção, campo por
  campo.
- `viewMode` — o modo em que se abre, prevalecendo sobre o que está na URL e o que a
  pessoa escolheu por último. O usuário ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da visualização de lista.
- `updateUrl` — desativado por padrão: o painel não lê nem grava os parâmetros de
  `__view`, filtro e ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card kanban, como
botões quando declaradas com `collapsed: false` e no menu da linha caso contrário — um
"Aprovar" em cada card é uma ação.

O tamanho de um painel se ajusta às suas linhas. Sem uma altura definida pelo pai, ou apenas com
`max-height`, uma coleção curta renderiza sua barra de ferramentas e linhas, e uma coleção longa
rola dentro do espaço disponível, até a altura da janela. Defina uma altura para
preenchê-lo. Seu layout se adapta à sua própria largura, não à da janela: em uma
coluna estreita, ele usa seu layout compacto, independentemente do tamanho da tela.

`propertiesOrder` reordena e nunca oculta: uma propriedade omitida é renderizada
após as que foram nomeadas. Para ocultar uma em todos os lugares, defina `admin.hideFromCollection`
nela; para exibir apenas algumas em um local específico, passe `fields`.

## O formulário de um registro

O `<EntityFormPanel>` faz o mesmo para o formulário de um registro. Ele carrega o registro
por `id`, salva-o por meio da camada de dados do `<Rebase>` como o próprio formulário
do admin faz, e chama `onSaved` após cada salvamento com o registro salvo conforme o
servidor envia a linha, `row`, e seu `id`. Omita o `id` para criar um
registro. `onClose` é chamado quando o formulário solicita o fechamento, por exemplo, após
a exclusão do registro:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Assim como o `CollectionPanel`, o formulário e o `EntityViewPanel` recebem uma coleção
registrada por `path`, sem a necessidade de um objeto de configuração em mãos:
`<EntityFormPanel path="posts" id={postId}/>`. Sob o `<RebaseCMS>` ou um
`CollectionsProvider` que a registre, isso é tudo de que precisam. Sem nenhum escopo
acima, forneça a coleção como um valor, como aqui, e o painel trará o
seu próprio; um nomeado por um caminho que nada registra indicará que o registro não foi encontrado.

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário manterá
o que foi digitado e informará que o registro foi excluído em outro lugar. Sua ação
"Save as new" o transforma em um formulário que cria um novo registro com esses valores;
`onSaved` então reporta o novo registro.

<span class="since-badge" data-since="0.29">Desde 0.29</span> O formulário pode exibir
parte de um registro ou organizá-lo à sua maneira. `fields` exibe apenas os campos informados,
nessa ordem; as seções e o rail mantêm seu agrupamento. `layout`
substitui os campos gerados pelo seu próprio JSX, no qual
`<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras fornecidos pelo
formulário gerado:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

De qualquer forma, o formulário valida apenas os campos que exibe; o servidor ainda
verifica o registro completo. Um formulário que cria um registro e omite um
campo obrigatório sem valor padrão avisa quando é aberto: um erro indica o
campo, e o salvamento permanece bloqueado até que o campo seja exibido ou receba um valor padrão.
`collectionOverrides` altera a coleção apenas para este formulário, assim como faz para o
`CollectionPanel`.

Cada formulário delimita o escopo de seus IDs de DOM, portanto dois formulários podem compartilhar a mesma página. Para encontrar um campo
a partir de um teste, selecione `[data-form-field="title"]` dentro de
`[data-form-path="posts"]` do formulário.

<span class="since-badge" data-since="0.29">Desde 0.29</span>
O `<EntityViewPanel>` é a versão somente leitura do `EntityFormPanel`. Ele carrega o
registro por `id` e o renderiza da mesma forma que a página de registro do admin: as
mesmas seções e rótulos, com cada valor como sua pré-visualização, de modo que um enum é exibido como seu
chip, uma data em seu fuso horário e uma relação como o título do seu destino. Ele aceita
`fields` e `collectionOverrides` assim como o formulário, e omite os campos que
o formulário omite: aquele que uma regra `conditions.hidden` oculta para este registro, e
aquele que o usuário conectado não tem permissão para ler.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

O `<FieldValue>` renderiza um valor da mesma forma, dentro do seu próprio JSX. Ele recebe a
linha inteira, conforme retornada por `useRows`, `useRow` e `client.data`, porque uma
relação belongsTo chega sob sua coluna de chave estrangeira (`customerId`), e não
sob o nome da propriedade; `field="customer"` a localiza ali. Ele precisa da
coleção registrada acima dele, pelo `<RebaseCMS>` ou por um `CollectionsProvider`.
Uma coleção ou campo desconhecido lança um erro indicando seu nome.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} path="orders" field="customer"/>
            <FieldValue row={row} path="orders" field="status"/>
            <FieldValue row={row} path="orders" field="placedAt"/>
        </div>
    ));
}
```

## Vários painéis em um mesmo escopo

Os três painéis trazem seu próprio `CollectionsProvider` quando nenhum está acima deles. Essa é
a camada subjacente, e você pode montá-la você mesmo para compartilhar um escopo entre
vários painéis ou para usar os componentes de nível inferior (`CollectionViewBinding`,
`useSidePanel`) sob ele. Dentro dele, um painel pode indicar sua coleção por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

O `CollectionsProvider` mantém um registro das coleções passadas a ele, com os
métodos `modifyCollection` e `injectCollections` dos seus plugins aplicados como no
admin, além dos painéis laterais e caixas de diálogo nos quais os registros são abertos, e a
proteção contra alterações não salvas. Mantenha o array `collections` estável:
uma constante de módulo ou com `useMemo`.

## Próximos passos

- [Personalizando o admin](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que esses painéis e o `FieldValue` leem.
- [Substituições de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário renderizado por um painel.
