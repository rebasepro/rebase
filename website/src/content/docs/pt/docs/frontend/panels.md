---
sourceHash: a9be6e44e281baff
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma coleção, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue e CollectionsProvider, sem o shell administrativo ao redor deles."
---

Na versão 0.24
O `CollectionPanel` aceita apenas um `path` registrado e renderiza "Collection not
found" fora da árvore administrativa completa, e o `EntityFormPanel` e o
`CollectionsProvider` não existem.

Você não precisa de todo o painel de administração para exibir uma tabela. O `<CollectionPanel>` aceita
a coleção como um valor e funciona em qualquer lugar sob `<Rebase>` e um roteador do React
Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`:

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
nenhuma rota administrativa serve a página, então `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para seus próprios
componentes ali. Qualquer roteador funciona: um `<BrowserRouter>` simples, um
`<MemoryRouter>` ou um data router. Um roteador ainda é obrigatório. Um data router
também permite que um registro com alterações não salvas impeça a navegação dentro do app; sob
os outros, apenas o prompt de saída de página do navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página
deve exibir o login do Rebase primeiro.

## O que um painel exibe

<span class="since-badge" data-since="0.29">Desde a 0.29</span>
Um painel renderiza a coleção assim como o admin faz. Estas propriedades (props) o restringem ao que
a sua página precisa; nenhuma delas altera a própria página da coleção.

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
  são a origem com a qual os espaços da linha — título, imagem, subtítulo, status, data,
  chips de relacionamento, colunas da lista — são preenchidos, os primeiros primeiro; um espaço
  que nenhum deles preenche permanece vazio. Para este painel, ele prevalece sobre `propertiesOrder`,
  a ordem de colunas salva pelo usuário e `listProperties`. As larguras de coluna arrastadas
  pelo usuário ainda persistem; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — a barra de ferramentas completa por padrão, `null` para nenhuma, ou uma composta
  por suas partes: `CollectionToolbar` (com `start` e `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Eles lêem o painel no qual são renderizados e lançam erros em
  qualquer outro lugar. Os slots de plugin e a sobreposição `Collection.Actions` residem na
  barra de ferramentas padrão.
- `onRowClick` — chamado com a linha clicada em vez de o painel abri-la,
  a partir de uma linha, um card, um card kanban e da ação de edição. A linha é aquela enviada
  pelo servidor, no formato que `useRows`, `useRow` e `<FieldValue>` aceitam: `id`,
  strings de data ISO (`YYYY-MM-DD` para uma coluna somente de data) e uma relação belongsTo
  como sua chave estrangeira (`customerId`). Uma relação cujo destino foi carregado pelo painel
  chega aninhada sob seu nome, assim como o `include` do REST a retorna
  (`order.customer` é a linha do cliente); sua chave estrangeira também está presente.
- `highlightedIds` — os IDs das linhas exibidas como selecionadas, como aquela que uma página
  mostra ao lado da lista, por exemplo: `highlightedIds={selected ? [selected] : []}`.
  `[]` não destaca nenhuma. Sem isso, o painel destaca a última linha aberta.
- `viewMode` — o modo no qual ele abre, sobrepondo-se ao da URL e ao último
  selecionado pela pessoa. O usuário ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da visualização em lista.
- `updateUrl` — desativado por padrão: o painel não lê nem escreve os parâmetros
  `__view`, de filtro e de ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card kanban, como
botões quando declaradas com `collapsed: false` e no menu da linha caso contrário — um
botão "Aprovar" em cada card é uma ação.

Um painel ajusta seu tamanho às suas linhas. Sem uma altura definida pelo seu elemento pai, ou apenas
com um `max-height`, uma coleção curta renderiza sua barra de ferramentas e linhas, e uma longa
rola dentro do espaço disponível, até a altura da janela. Defina uma altura para
preenchê-lo. Ele se organiza com base em sua própria largura, não na da janela: em uma coluna
estreita, ele usa seu layout compacto, independentemente do tamanho da tela.

`propertiesOrder` reordena e nunca oculta: uma propriedade que ele omite é renderizada
após as nomeadas. Para ocultar uma propriedade em todos os lugares, defina `admin.hideFromCollection`
nela; para exibir apenas algumas em um local específico, passe `fields`.

## Formulário de um registro

`<EntityFormPanel>` faz o mesmo para o formulário de um único registro. Ele carrega o registro
pelo `id`, salva-o através da camada de dados do `<Rebase>` assim como o próprio formulário
do admin faz, e chama `onSaved` após cada salvamento com o registro salvo conforme o
servidor envia a linha, `row`, e seu `id`. Omita o `id` para criar um
registro. `onClose` é chamado quando o formulário solicita ser fechado, por exemplo após
a exclusão do seu registro:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário manterá
o que foi digitado e informará que o registro foi excluído em outro lugar. Sua ação "Save as new"
o transforma em um formulário que cria um novo registro com esses valores;
`onSaved` então reporta o novo registro.

<span class="since-badge" data-since="0.29">Desde a 0.29</span> O formulário pode exibir
parte de um registro ou organizá-lo à sua maneira. `fields` exibe apenas os campos
nomeados, nessa ordem; as seções e o painel lateral mantêm seu agrupamento. `layout`
substitui os campos gerados pelo seu próprio JSX, no qual
`<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras fornecidos
pelo formulário gerado:

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
campo obrigatório sem valor padrão avisa isso ao abrir: um erro indica o nome do
campo e a opção Salvar permanece bloqueada até que o campo seja exibido ou receba um valor padrão.
`collectionOverrides` altera a coleção apenas para este formulário, assim como faz para
o `CollectionPanel`.

Cada formulário delimita o escopo de seus IDs de DOM, para que dois formulários possam compartilhar uma página. Para encontrar um campo
a partir de um teste, selecione `[data-form-field="title"]` dentro do
`[data-form-path="posts"]` do formulário.

<span class="since-badge" data-since="0.29">Desde a 0.29</span>
`<EntityViewPanel>` é a versão somente leitura do `EntityFormPanel`. Ele carrega o
registro pelo `id` e o renderiza como a página de registro do admin faz: as
mesmas seções e rótulos, com cada valor em sua respectiva pré-visualização, portanto um enum é exibido como seu
chip, uma data em seu fuso horário e uma relação como o título do seu destino. Ele aceita
`fields` e `collectionOverrides` como o formulário faz, e omite os campos que o
formulário omite: aquele que uma regra `conditions.hidden` oculta para este registro e
aquele que o usuário conectado não tem permissão para ler.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

O `<FieldValue>` renderiza um único valor da mesma forma, dentro do seu próprio JSX. Ele aceita
a linha inteira, conforme retornada por `useRows`, `useRow` e `client.data`, porque uma
relação belongsTo chega sob a coluna de sua chave estrangeira (`customerId`), e não
sob o nome da propriedade; `field="customer"` a localiza lá. Ele precisa que a
coleção esteja registrada acima dele, por meio do `<RebaseCMS>` ou de um `CollectionsProvider`.
Uma coleção ou campo desconhecido lança um erro que indica seu nome.

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

Os três painéis trazem seu próprio `CollectionsProvider` quando nenhum está presente acima deles. Essa é
a camada subjacente, e você mesmo pode montá-la para compartilhar um único escopo entre
vários painéis ou para usar as partes de nível inferior (`CollectionViewBinding`,
`useSidePanel`) sob ela. Dentro dele, um painel pode indicar sua coleção por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

O `CollectionsProvider` mantém um registro das coleções fornecidas a ele, com o
`modifyCollection` e o `injectCollections` dos seus plugins aplicados como no
admin, além dos painéis laterais e caixas de diálogo em que os registros são abertos, e a
proteção contra alterações não salvas. Mantenha o array `collections` estável: uma constante de módulo
ou `useMemo`.

## Próximos passos

- [Customização do painel de administração](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que esses painéis e o `FieldValue` lêem.
- [Substituições de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário renderizado por um painel.
