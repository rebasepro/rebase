---
sourceHash: 7a427ea4f8f8b272
title: Painéis em uma página própria
sidebar_label: Painéis em suas próprias páginas
description: "Exiba uma tabela, o formulário de um registro, um registro ou um valor em uma página própria: CollectionPanel, RecordForm, RecordDetail, FieldValue e CollectionsProvider, sem nenhuma estrutura de admin em torno deles."
---

Você não precisa de todo o admin para exibir uma tabela. O `<CollectionPanel>` recebe
uma tabela pelo seu slug e funciona em qualquer lugar sob o `<Rebase>` e um
roteador do React Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`:

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

Um registro é aberto sobre a sua página, em um painel lateral ou em um diálogo, e nunca por URL:
nenhuma rota de admin serve a página, então `full_screen` e `split` abrem como um painel
lateral, e `useUrlController().routesMounted` é `false` para os seus próprios
componentes ali. Qualquer roteador funciona: um `<BrowserRouter>` simples, um
`<MemoryRouter>` ou um roteador de dados (data router). Um roteador ainda é obrigatório. Um data router
também permite que um registro com alterações não salvas impeça a navegação dentro do app; sob os
outros, apenas o aviso de saída de página do navegador o protege. Envolva o painel em `<RebaseAuthGate>` se a página
deve exibir o login do Rebase primeiro.

## O que um painel exibe

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um painel renderiza a tabela como o admin faz — a partir do descritor fornecido pelo
servidor, com qualquer `customizeTable` que você tenha registrado. Estas props o restringem ao que
sua página precisa; nenhuma delas altera a página da própria tabela no admin.

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

`collection` recebe o slug da tabela, como aqui, ou uma coleção externa
(`defineFirestoreCollection`) como valor; `path` também a nomeia e endereça uma
coleção aninhada pelo seu caminho completo.

- `fields` — as propriedades que ele exibe, nesta ordem, e nada mais. Na
  tabela, elas são as colunas. Na lista, em um card e em um card de kanban, elas
  são a partir de onde os espaços da linha — título, imagem, subtítulo, status, data,
  chips de relação, as colunas da lista — são preenchidos, com os anteriores primeiro;
  um espaço que nenhum deles preencher permanece vazio. Para este painel, ela tem
  precedência sobre `propertiesOrder`, a ordem de colunas salva por um usuário e `listProperties`.
  As larguras de coluna arrastadas por um usuário ainda persistem; a ordem é sua, portanto as colunas não são arrastadas.
- `toolbar` — `"full"`, o padrão; `"compact"`, que é a busca, a alternância
  de modo de visualização e Novo (onde a pessoa pode criar); `"none"` (ou `null`)
  para nenhuma; ou uma composta por suas partes: `CollectionToolbar` (com `start` e `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Elas leem o painel no qual são renderizadas e lançam erro
  em qualquer outro lugar. Os slots de plugin e a sobreposição `Collection.Actions` residem na
  barra de ferramentas padrão.
- `onRowClick` — chamado com a linha clicada e seu id em vez de o painel
  abri-la, a partir de uma linha, um card, um card de kanban e da ação de edição. A linha é
  aquela enviada pelo servidor, no formato que `useRows`, `useRow` e `<FieldValue>`
  aceitam: exatamente suas colunas, strings de data ISO (`YYYY-MM-DD` para uma
  coluna somente de data) e uma relação belongsTo como sua chave estrangeira (`customerId`). Uma relação cujo destino foi carregado pelo painel chega aninhada sob seu nome, assim como o `include` do REST retorna
  (`order.customer` é a linha do cliente); sua chave estrangeira também está lá. O
  id é a string pela qual o admin endereça o registro — sua chave primária, com as
  partes de uma chave composta unidas por `:::` — que `highlightedIds` e
  `useSidePanel().open` aceitam. `row.id` é a coluna `id` do registro, onde a
  tabela tiver uma, com o tipo dessa coluna: `5` para uma chave inteira, cujo id é
  `"5"`.
- `rowActions` — seu próprio JSX em cada linha, card e card de kanban, recebendo a
  linha e seu id: um "Aprovar", um "Enviar". Na tabela, é a última coluna,
  sempre visível; em uma linha de lista, um card e um card de kanban, ele fica ao lado das
  próprias ações da coleção. Um clique nele não abre o registro, e ele é
  renderizado novamente com o estado do seu componente, portanto uma flag `saving` o desativa.
- `orderBy` — a ordem em que as linhas são abertas, `"placed_at:desc"` ou
  `["placed_at", "desc"]`. A pessoa ainda pode ordenar por outra coluna.
- `highlightedIds` — os ids das linhas renderizadas como selecionadas, como aquela que uma página
  exibe ao lado da lista, por exemplo: `highlightedIds={selected ? [selected] : []}`.
  `[]` não renderiza nenhuma. Sem isso, o painel destaca a última linha aberta. Os ids
  são comparados como strings, de modo que `5` e `"5"` de uma chave inteira correspondem à mesma linha.
- `where` — quais linhas ele contém, da forma como `useRows` aceita:
  `where={{ status: ["==", "pending"] }}`. Os filtros definidos pela pessoa em outros
  campos se combinam com ele, e seus próprios campos não podem ser alterados ou limpos na
  barra de ferramentas. Ele segue a prop, de modo que uma barra de abas ou uma barra de gráfico clicada possa
  controlá-lo a partir do estado. Ele se sobrepõe ao `fixedFilter` da coleção, campo por
  campo.
- `viewMode` — o modo em que ele abre, sobrepondo-se ao da URL e ao que a
  pessoa escolheu por último. Ela ainda pode alternar.
- `title={false}` — nenhum título acima do painel, nem o próprio cabeçalho da visualização de lista.
- `updateUrl` — desativado por padrão: o painel não lê nem grava os parâmetros
  `__view`, de filtro e de ordenação da página.

As `entityActions` da coleção são renderizadas em cada linha, card e card de kanban, como
botões quando declaradas com `collapsed: false` e no menu da linha caso contrário — um
"Aprovar" em cada card é uma ação.

Um painel ajusta seu tamanho às suas linhas. Sem uma altura vinda de seu elemento pai, ou apenas com
um `max-height`, uma coleção curta renderiza sua barra de ferramentas e linhas, e uma longa
rola dentro do espaço disponível, até a altura da janela. Forneça uma altura para
preenchê-la. Ele se posiciona com base na sua própria largura, não na da janela: em uma coluna
estreita, ele usa seu layout compacto, independentemente da tela.

`fieldOrder` no `customizeTable` da tabela reordena e nunca oculta: um campo
deixado de fora é renderizado após os que foram nomeados. Para manter um fora da lista
em todos os lugares, defina `hidden: true` nas opções do campo; para exibir apenas alguns em um
determinado local, passe `fields`.

## O formulário de um único registro

O `<RecordForm>` faz o mesmo para o formulário de um registro (chamava-se `EntityFormPanel`
antes da versão 0.29; esse nome ainda funciona e emite um aviso uma vez). Ele carrega o registro
por `id`, salva-o por meio da camada de dados do `<Rebase>` como o próprio
formulário do admin faz e chama `onSaved` após cada salvamento com o registro salvo da forma como o
servidor envia a linha, `row`, e seu `id`. Omita o `id` para criar um
registro. O `onClose` é chamado quando o formulário solicita o fechamento, por exemplo, após
seu registro ser excluído:

```tsx
<RecordForm
    collection="posts"
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Assim como o `CollectionPanel`, o formulário e o `RecordDetail` recebem uma tabela pelo seu slug
(`path="posts"` também funciona). Cada tabela que o servidor disponibiliza é conhecida por eles,
sob o `<RebaseCMS>`, sob um `CollectionsProvider`, ou sem escopo superior, caso
em que o painel traz o seu próprio. Uma coleção externa é passada
como valor. Uma nomeada por um caminho que nada serve informará que o registro não foi encontrado.

Se outra pessoa excluir o registro enquanto o formulário estiver aberto, o formulário manterá
o que foi digitado e informará que o registro foi excluído em outro lugar. Sua ação "Save as new"
transforma-o em um formulário que cria um novo registro com esses valores;
o `onSaved` reporta o novo registro em seguida.

O formulário pode exibir
parte de um registro ou organizá-lo à sua maneira. `fields` exibe apenas os campos
nomeados, nessa ordem; seções e a barra lateral (rail) mantêm seu agrupamento. Elementos filhos (children)
substituem os campos gerados pelo seu próprio JSX, no qual
`<FormField name="…"/>` renderiza um campo com o rótulo, tamanho e regras que o
formulário gerado fornece:

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

`compact` é o formulário denso para um card lateral ou um painel de 350–700px: sem rail
ao lado dos campos (o que ela contém é recolhido na coluna), sem metadados de registro,
controles de altura média e espaçamento (padding) mais compacto:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

De qualquer forma, o formulário valida apenas os campos que exibe; o servidor ainda
verifica o registro completo. Um formulário que cria um registro e deixa de fora um
campo obrigatório sem valor padrão avisa quando for aberto: um erro cita o
campo, e o Salvamento permanece bloqueado até que o campo seja exibido ou receba um valor padrão.
`collectionOverrides` altera a apresentação apenas para este formulário, assim como faz para
o `CollectionPanel`.

Cada formulário delimita o escopo de seus IDs de DOM, para que dois formulários possam compartilhar uma página. Para encontrar um campo
a partir de um teste, selecione `[data-form-field="title"]` dentro de
`[data-form-path="posts"]` do formulário.

O `<RecordDetail>` é o equivalente somente leitura do `RecordForm`. Ele carrega o
registro por `id` e o renderiza como a página de registro do admin faz: as mesmas
seções e rótulos, com cada valor em sua pré-visualização, de modo que um enum é exibido como seu
chip, uma data no seu fuso horário e uma relação como o título do seu destino. Ele aceita
`fields` e `collectionOverrides` da mesma forma que o formulário, e omite os campos
que o formulário omite: aquele que uma regra de `conditions.hidden` oculta para este registro e
aquele que o usuário autenticado não tem permissão para ler.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

O `<FieldValue>` renderiza um valor da mesma maneira, dentro do seu próprio JSX: passe o
valor conforme o servidor o envia. Um belongsTo chega como sua chave estrangeira
(`order.customerId`), portanto `field="customer" value={order.customerId}` renderiza o título
do registro relacionado; nomear a própria chave estrangeira, `field="customerId"`,
faz o mesmo. Ele precisa que a tabela seja conhecida acima dele, por `<RebaseCMS>` ou por um
`CollectionsProvider`. Uma coleção ou campo desconhecido lança um erro
identificando-o.

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

Os três painéis trazem seu próprio `CollectionsProvider` quando nenhum está acima deles. Essa
é a etapa subjacente, e você mesmo pode montá-lo para compartilhar um escopo entre
vários painéis ou para usar as partes de nível mais baixo (`CollectionViewBinding`,
`useSidePanel`) abaixo dele. Ele aceita as mesmas entradas que o `<RebaseCMS>`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";
import { postsCms } from "./cms/posts";

const tableCustomizations = [postsCms];

<CollectionsProvider tableCustomizations={tableCustomizations}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

O `CollectionsProvider` mantém um registro das tabelas que o servidor fornece, com
suas `tableCustomizations` e quaisquer `externalCollections`, o `modifyCollection`
e o `injectCollections` de seus plugins aplicados como no admin, além dos
painéis laterais e caixas de diálogo nos quais os registros são abertos, e o protetor contra alterações não salvas. Mantenha
os arrays estáveis: uma constante de módulo ou `useMemo`. `tables` substitui as
tabelas fornecidas por descritores que você passar, para incorporação e testes.

## Próximos passos

- [Personalizando o admin](/docs/frontend/customizing): os locais onde um componente
  seu pode ser inserido e as receitas construídas a partir desses painéis.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, as linhas que esses painéis e `FieldValue` leem.
- [Substituições de componentes](/docs/frontend/component-overrides): substitua a visualização
  ou o formulário renderizado por um painel.
