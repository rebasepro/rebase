---
sourceHash: 99297021573eef28
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma coleção, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, EntityFormPanel, RecordDetail, FieldValue e CollectionsProvider, sem o shell de administração ao redor deles."
---

Na versão 0.24, o
`CollectionPanel` aceita apenas um `path` registrado e renderiza "Collection not
found" fora da árvore de administração completa, e o `EntityFormPanel` e o
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

Um registro é aberto sobre a sua página, em um painel lateral ou em um diálogo, e nunca por URL:
nenhuma rota de administração atende a página, portanto `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para seus próprios
componentes ali. Qualquer roteador funciona: um `<BrowserRouter>` simples, um
`<MemoryRouter>` ou um data router. Um roteador ainda é obrigatório. Um data router
também permite que um registro com alterações não salvas impeça a navegação dentro do app; sob os
outros, apenas o aviso de saída de página do navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página
deve exibir o login do Rebase primeiro.

## O que um painel exibe

<span class="since-badge" data-since="0.29">A partir da 0.29</span>
Um painel renderiza a coleção como o admin faz. Essas props o refinam para o que
a sua página precisa; nenhuma delas altera a própria página da coleção.

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

`collection` recebe o nome da coleção, como aqui, ou a própria coleção como
um valor (`collection={ordersCollection}`); `path` também a nomeia e endereça
uma subcoleção pelo seu caminho completo.

- `fields` — as propriedades que ele exibe, nesta ordem, e nada mais. Na
  tabela, são as colunas. Na lista, em um card e em um card kanban, são de onde
  os locais da linha — título, imagem, subtítulo, status, data, chips de relação,
  as colunas da lista — são preenchidos, os primeiros primeiro; um local que nenhum
  deles preenche permanece vazio. Para este painel, ele tem precedência sobre `propertiesOrder`, a
  ordem de colunas salva por um usuário e `listProperties`. As larguras de coluna arrastadas por um usuário
  ainda persistem; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — `"full"`, o padrão; `"compact"`, que inclui busca, a
  alternância do modo de visualização e Novo (onde a pessoa pode criar); `"none"` (ou `null`)
  para nenhum; ou uma composta por suas partes: `CollectionToolbar` (com `start` e `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Elas leem o painel em que estão desenhadas e lançam um erro
  em qualquer outro lugar. Os slots de plugin e a sobreposição de `Collection.Actions` ficam na
  barra de ferramentas padrão.
- `onRowClick` — chamado com a linha clicada e seu id em vez de o painel
  abri-la, a partir de uma linha, um card, um card kanban e a ação de edição. A linha é
  a enviada pelo servidor, no formato que `useRows`, `useRow` e `<FieldValue>`
  aceitam: exatamente suas colunas, strings de data ISO (`YYYY-MM-DD` para uma
  coluna apenas de data) e uma relação belongsTo como sua chave estrangeira (`customerId`). Uma relação cujo
  destino o painel carregou chega aninhada sob seu nome, como o `include` do REST retorna
  (`order.customer` é a linha do cliente); sua chave estrangeira também está lá. O
  id é a string pela qual o admin endereça o registro — sua chave primária, ou as
  partes de uma chave composta unidas por `:::` — que `highlightedIds` e
  `useSidePanel().open` aceitam. `row.id` é a coluna `id` do registro, onde a
  tabela possuir uma, com o tipo daquela coluna: `5` para uma chave inteira, cujo id é
  `"5"`.
- `rowActions` — seu próprio JSX em cada linha, card e card kanban, recebendo a
  linha e seu id: um "Aprovar", um "Enviar". Na tabela, é a última coluna,
  sempre visível; em uma linha de lista, um card e um card kanban, fica ao lado das
  ações da própria coleção. Clicar nela não abre o registro, e ela é
  renderizada novamente com o estado do seu componente, de modo que uma flag `saving` pode desativá-la.
- `orderBy` — a ordem em que as linhas são abertas, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. O usuário ainda pode ordenar por outra coluna.
- `highlightedIds` — os ids das linhas renderizadas como selecionadas, como aquela que uma página
  exibe ao lado da lista, por exemplo: `highlightedIds={selected ? [selected] : []}`.
  `[]` não desenha nenhuma. Sem ela, o painel destaca a última linha aberta. Os ids
  são comparados como strings, de modo que o `5` de uma chave inteira e `"5"` são a mesma linha.
- `where` — quais linhas ele contém, como `useRows` aceita:
  `where={{ status: ["==", "pending"] }}`. Os filtros que o usuário define em outros
  campos se combinam com ele, e seus próprios campos não podem ser alterados ou limpos a partir
  da barra de ferramentas. Ele segue a prop, de modo que uma barra de abas ou uma barra de gráfico clicada pode
  controlá-lo a partir do estado. Ele tem precedência sobre o `fixedFilter` da coleção, campo por
  campo.
- `viewMode` — o modo em que ele é aberto, sobrepondo o da URL e o que o
  usuário escolheu por último. O usuário ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da visualização de lista.
- `updateUrl` — desativado por padrão: o painel não lê nem grava os parâmetros
  `__view`, filtro e ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card kanban, como
botões quando declaradas com `collapsed: false` e no menu da linha caso contrário — um
"Aprovar" em cada card é uma ação.

Um painel se ajusta ao tamanho de suas linhas. Sem uma altura definida pelo elemento pai, ou apenas com
um `max-height`, uma coleção curta desenha sua barra de ferramentas e linhas, e uma longa
rola dentro do espaço que possui, até a altura da janela. Defina uma altura para
preenchê-la. Ele se organiza com base em sua própria largura, não na da janela: em uma coluna
estreita, ele usa seu layout compacto, independentemente da tela.

`propertiesOrder` reordena e nunca oculta: uma propriedade que ele omite é desenhada
após as que ele nomeia. Para ocultar uma em todos os lugares, defina `admin.hideFromCollection`
nela; para mostrar apenas algumas em um único lugar, passe `fields`.

## Formulário de um registro

O `<EntityFormPanel>` faz o mesmo para o formulário de um registro. Ele carrega o registro
por `id`, salva-o por meio da camada de dados do `<Rebase>` assim como o próprio
formulário do admin faz, e chama `onSaved` após cada salvamento com o registro salvo da forma como o
servidor envia a linha, `row`, e seu `id`. Omita o `id` para criar um
registro. `onClose` é chamado quando o formulário solicita a saída, por exemplo após
seu registro ser excluído:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Assim como o `CollectionPanel`, o formulário e o `RecordDetail` aceitam uma
coleção registrada pelo seu nome, sem precisar de um objeto de configuração em mãos:
`<EntityFormPanel collection="posts" id={postId}/>` (`path="posts"` também funciona). Sob o `<RebaseCMS>` ou um
`CollectionsProvider` que a registre, isso é tudo de que precisam. Sem nenhum escopo
acima, passe a coleção como um valor, como aqui, e o painel fornecerá o seu
próprio; uma indicada por um caminho que nada registra informará que o registro não foi encontrado.

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário manterá
o que foi digitado e informará que o registro foi excluído em outro lugar. Sua ação "Save as new"
o transforma em um formulário que cria um novo registro com esses valores;
`onSaved` relata então o novo registro.

<span class="since-badge" data-since="0.29">A partir da 0.29</span> O formulário pode exibir
parte de um registro ou organizá-lo do seu jeito. `fields` exibe apenas os campos que
nomeia, nessa ordem; seções e o painel lateral mantêm seu agrupamento. Elementos filhos (children)
substituem os campos gerados pelo seu próprio JSX, no qual
`<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras que o
formulário gerado atribui a ele:

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

`compact` é o formulário denso para um card lateral ou um painel de 350–700px: sem barra lateral
ao lado dos campos (o que ela contém se dobra na coluna), sem metadados do registro,
controles de altura média e preenchimento mais compacto:
`<EntityFormPanel collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De qualquer forma, o formulário valida apenas os campos que exibe; o servidor ainda
verifica o registro inteiro. Um formulário que cria um registro e omite um
campo obrigatório sem valor padrão avisa isso ao abrir: um erro nomeia o
campo e o botão Salvar permanece bloqueado até que o campo seja exibido ou receba um valor padrão.
`collectionOverrides` altera a coleção apenas para este formulário, assim como faz para o
`CollectionPanel`.

Cada formulário delimita seus IDs de DOM (escopo), portanto dois formulários podem compartilhar uma mesma página. Para encontrar um campo
a partir de um teste, selecione `[data-form-field="title"]` dentro do
`[data-form-path="posts"]` do formulário.

<span class="since-badge" data-since="0.29">A partir da 0.29</span>
O `<RecordDetail>` é o gêmeo somente leitura do `EntityFormPanel`. Ele carrega o
registro por `id` e o renderiza da mesma forma que a página de registro do admin faz: as mesmas
seções e rótulos, com cada valor em sua pré-visualização, de modo que um enum é exibido como seu
chip, uma data em seu fuso horário e uma relação como o título do seu destino. Ele aceita
`fields` e `collectionOverrides` da mesma forma que o formulário, e omite os campos
que o formulário omite: aqueles que uma regra `conditions.hidden` oculta para este registro e
aqueles que o usuário autenticado não tem permissão para ler.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

O `<FieldValue>` renderiza um valor da mesma maneira, dentro do seu próprio JSX: passe a ele o
valor como o servidor o envia. Uma relação belongsTo chega como sua chave estrangeira
(`order.customerId`), portanto `field="customer" value={order.customerId}` renderiza o
título do registro relacionado; nomear a própria chave estrangeira, `field="customerId"`,
faz o mesmo. Ele precisa que a coleção esteja registrada acima dele, pelo `<RebaseCMS>`
ou por um `CollectionsProvider`. Uma coleção ou campo desconhecido lança um erro
nomeando-o.

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

Os três painéis trazem seu próprio `CollectionsProvider` quando nenhum está acima deles. Essa é
a camada subjacente, e você mesmo pode montá-la para compartilhar um escopo entre
vários painéis ou para usar as partes de nível mais baixo (`CollectionViewBinding`,
`useSidePanel`) sob ela. Dentro dela, um painel pode indicar sua coleção por `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

O `CollectionsProvider` mantém um registro das coleções passadas a ele, com o
`modifyCollection` e `injectCollections` dos seus plugins aplicados como no
admin, além dos painéis laterais e diálogos em que os registros se abrem, e a
proteção contra alterações não salvas. Mantenha o array `collections` estável: uma constante de módulo
ou `useMemo`.

## Próximos passos

- [Personalizando o admin](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que esses painéis e o `FieldValue` leem.
- [Substituições de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário que um painel renderiza.
