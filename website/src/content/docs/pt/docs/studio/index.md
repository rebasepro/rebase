---
sourceHash: 7f137cdb15196a3e
title: Ferramentas do Studio
sidebar_label: Studio
description: O Rebase Studio oferece ferramentas de desenvolvedor para edição visual de esquemas, consultas SQL, scripts JavaScript, gerenciamento de políticas RLS e navegação de armazenamento.
---

## Visão Geral

O Studio é a metade do desenvolvedor no painel de administração. A mesma aplicação
que sua equipe de conteúdo usa para editar linhas também traz um editor de esquemas,
um console SQL, um scratchpad JavaScript, um navegador de políticas RLS e um navegador
de armazenamento — e o Studio é o modo que os desbloqueia. Nada para instalar e nada
para fazer deploy: já está no painel, atrás do seletor na gaveta lateral (drawer).

![O editor de coleções, a ferramenta principal do Studio: um editor visual de esquemas que escreve de volta no seu TypeScript](/img/collection_editor.png)

Ele existe porque a alternativa é um segundo conjunto de credenciais. Editar uma
tabela, verificar o que uma política realmente permite ou executar uma consulta
em produção normalmente significa um cliente de banco de dados, uma cópia da string
de conexão e uma trilha de auditoria que termina em "alguém com psql". O Studio faz
tudo isso como o administrador conectado, por meio da mesma autorização usada pela API.

## Os dois modos

O painel possui dois modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de conteúdo e equipes operacionais. Mostra as tabelas e o gerenciamento de dados. Este é o padrão.
- **Studio** (`"studio"`) — Para desenvolvedores. Desbloqueia as ferramentas abaixo.

Alterne entre eles com o controlador de modo de administração ou o seletor na gaveta lateral. O
modo escolhido é mantido no `localStorage` sob `rebase-admin-mode`; um navegador
que usou o painel antes da versão 0.17.0 mantém o valor antigo `"content"` e é
migrado para `"cms"` durante a leitura.

## Ferramentas Nativas do Studio

### Editor de Coleções (Collection Editor)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um editor visual para uma tabela e como o painel a exibe. Um salvamento é dividido em dois:

- **Fatos do esquema** — o tipo de uma coluna, nulidade, padrão, validação, valores
  de enum, armazenamento, relações, regras, descrição, histórico — tornam-se edições
  `TablePatch` que o editor de esquemas do servidor grava em `backend/schema/<table>.ts`
  com o [ts-morph](https://ts-morph.com/), alterando apenas o código especificado por uma
  edição e mantendo o restante do arquivo como estava: importações, comentários, formatação,
  hooks, colunas compartilhadas. Uma edição que interfere no código — uma coluna criada por
  uma função auxiliar, regras armazenadas em uma variável — é recusada, indicando o local onde
  deve ser feita. Uma regra não modificada é devolvida exatamente como foi servida, para que o
  nome de sua política nunca mude. Consulte [Edição de esquemas em tempo real](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Apresentação** — rótulos, ícone, modos de exibição, ordem das colunas, colunas ocultas,
  larguras, rótulos e cores de enum, kanban, padrões de consulta — é uma preferência de UI,
  nunca uma edição de esquema. As de um administrador são as do workspace: onde o servidor pode
  gravar o código-fonte do projeto, elas vão para `frontend/src/cms/ui-config.json`, e
  em um deploy, para a tabela `rebase.ui_preferences`, via
  `/api/admin/ui-config`. Os redimensionamentos e mudanças de visualização do próprio usuário pertencem a ele.

Uma alteração de slug, tabela SQL ou banco de dados é recusada como uma migração. Uma tabela cujas
regras vêm de `defaultRls` solicita confirmação antes de assumir regras próprias. Um solicitante
que receber regras ocultadas obtém um editor somente leitura. Um salvamento que o servidor não
consegue compilar lista cada problema junto ao campo correspondente, e nada é gravado.
Um arquivo modificado no disco desde que o editor o leu oferece a opção de recarregar em vez de
sobrescrever a alteração (`SCHEMA_EDIT_STALE_FILE`). Um campo cuja definição é gerada em código — um helper,
uma variável compartilhada — é exibido como somente leitura, com o motivo. A ordem das colunas é
apenas de apresentação: a reordenação nunca move uma coluna na tabela. Esta é a
captura de tela no topo desta página.

**Importar uma tabela existente.** Uma tabela presente no banco de dados que não
esteja declarada em `backend/schema` é listada em "Import an existing table"; selecionar uma grava
seu arquivo `defineTable` exatamente como o banco de dados a descreve — colunas, chaves,
índices, row-level security — por meio da edição `adoptTable`. A adoção não altera
nada no banco de dados: ela não planeja DDL, e a primeira etapa de política recria
uma política idêntica uma vez para validá-la. A postura de row-level security nunca é
rebaixada: uma tabela com RLS desativado, ou sem políticas, é adotada como
`rls: "admin-only"`, e o diálogo informa isso. Uma tabela sem chave primária não pode
ser adotada. As rotas são `GET /api/admin/schema-editor/unmapped-tables` e
`GET /api/admin/schema-editor/unmapped-tables/:schema/:table`.

**Coleções do Firestore.** Em desenvolvimento, o editor de coleções também edita
coleções do Firestore: um salvamento reescreve a chamada
`defineFirestoreCollection({...})` da coleção em `frontend/src/cms` diretamente no local, alterando
apenas o que você editou. Funções, componentes customizados, comentários e importações permanecem
como foram escritos; campos definidos em código aparecem como somente leitura. Em produção, as
coleções do Firestore são somente leitura no editor. Criar uma, ou alterar seu slug,
é feito no código; para excluir uma, remova seu arquivo e sua entrada
em `externalCollections`.

O editor está ativo onde quer que o Studio esteja montado — o `<RebaseStudio/>` de um
scaffold é suficiente, e não há nenhuma prop a ser adicionada. `collectionEditor` serve para ajustá-lo,
não para ativá-lo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// O Studio está montado, então o Collection Editor está disponível. Nada mais
// é necessário para ele.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` serve para ajustes finos — um editor somente leitura, um token
// diferente — não para ativá-lo.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

A confirmação de um *salvamento* cabe ao servidor, não ao painel: o editor
reescreve `backend/schema`, portanto fica desativado sob `NODE_ENV=production` (a menos que
a [edição de esquemas em tempo real](/docs/backend/live-schema-editing/) especifique um repositório),
no modo `baas`, e em um servidor sem `schemaDir`. O painel consulta
`GET /api/admin/schema-editor/status` e exibe o motivo retornado ao lado do
botão desativado.

### Ferramentas integradas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Toda ferramenta que reconhece o esquema lê as tabelas fornecidas pelo servidor, a partir de
`GET /api/schema/tables`, com ou sem o CMS na página — assim o Studio funciona
como o console de um backend sem painel de administração. Diante de um runtime anterior ao
0.31, que não possui essa rota, as ferramentas com suporte a esquema informam que o runtime precisa
ser atualizado, em vez de tentar adivinhar; diante de um backend sem autenticação, ou
quando a requisição falha, cada uma informa o motivo. O console SQL, logs, armazenamento e
as outras ferramentas que não leem o esquema funcionam de qualquer maneira.

Elas acompanham o Studio e são **carregadas sob demanda (lazy-loaded) pelo `RebaseStudio`** — cada uma é um
chunk separado, buscado na primeira vez em que você a abre. Elas não podem ser importadas individualmente:
`@rebasepro/studio` exporta deliberadamente apenas o orquestrador, para que um console que você nunca
abre não custe nada.

| Aba | Slug | Grupo | O que faz |
|-----|------|-------|-----------|
| SQL Console | `sql` | Database | Execute SQL puro contra seu banco de dados PostgreSQL e leia os resultados em uma tabela. A tabela mostra o resultado da última instrução, até suas primeiras 10.000 linhas ou 32 MB de valores; um resultado mais longo informa quantas linhas existiam, e a cópia e exportação incluem apenas as linhas exibidas. Esse resultado também oferece **Download full result as CSV**: o servidor faz o streaming de tudo por meio de um cursor somente leitura (`POST /api/admin/sql/csv`), uma consulta por vez, em um servidor Postgres próprio em vez do banco de dados de desenvolvimento em processo. Os valores são o texto do banco de dados, como o psql os exibe, e **Export JSON** grava dessa forma; **Export typed JSON** grava cada valor interpretado pelo tipo de sua coluna — inteiros e numéricos que um número JSON suporta com precisão, booleanos, `json`/`jsonb` como JSON — e mantém qualquer outro valor como texto. Em todos os CSVs (exportação, cópia e download completo), um valor que uma planilha executaria como fórmula (iniciado com `=`, `+`, `-`, `@`, tabulação ou retorno de carro, exceto um número assinado) é gravado com um `'` no início, da mesma forma que a exportação de coleções grava. Enquanto uma execução estiver em andamento, **Cancel run** libera o console imediatamente; um servidor que aceite o frame `CANCEL_SQL` do socket (ele lista `cancel_sql` no `hello` com o qual responde ao socket) também interrompe a instrução com `pg_cancel_backend`. O banco de dados de desenvolvimento em processo não pode ser interrompido, e um servidor mais antigo é deixado para concluir a instrução dentro de seu `statement_timeout` |
| RLS Policies | `rls` | Database | Inspecione e gerencie políticas de Row Level Security para suas tabelas. O lado declarado é o que o servidor compilou a partir do `rls` de cada tabela (disponibilizado para solicitantes com `schema:read`), comparado com `pg_policies` da forma como o `rebase doctor` avalia inconsistências (drift): uma política é listada como o banco de dados a armazena, com a tag **Differs from code** onde ela não coincidir com o que o projeto declara, e uma regra declarada ausente no banco de dados é listada como não aplicada. Uma política gerada pelo Rebase não pode ser editada diretamente no banco de dados, e em uma tabela gerenciada pelo Rebase um banner informa que cada inicialização do servidor e `rebase db push` reaplicam as políticas declaradas. Um solicitante sem `schema:read` vê o que o banco de dados armazena e é informado do motivo pelo qual a declaração não é exibida |
| Schema Visualizer | `schema-visualizer` | Database | Diagrama de entidades de suas tabelas e suas relações, desenhado a partir dos descritores fornecidos: nomes SQL, tipos Postgres, nulidade, chaves, valores de enum, chaves estrangeiras e junções são conforme declarados pelas tabelas. Apenas os marcadores de RLS são lidos do banco de dados. O layout é executado em um web worker, mantendo a página responsiva enquanto um diagrama grande é organizado. Um esquema com mais de 300 tabelas é desenhado considerando a vizinhança de uma tabela por vez — as tabelas a uma ou duas relações de distância — a partir da tabela mais conectada; selecione outra tabela na lista para navegar |
| Branches | `branches` | Database | Crie e gerencie [branches de banco de dados](/docs/backend/branching), e revise uma branch como um pull request: suas alterações de esquema e política RLS lado a lado, as linhas que ela inseriu, atualizou e deletou, e uma mesclagem no banco de dados original indicando a precedência — consulte [Revisando e mesclando uma branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Navegue e faça download de backups do banco de dados |
| Logs Explorer | `logs` | Database | Log de requisições em tempo real, além de tudo o que o servidor reporta como warn ou error — veja abaixo |
| JS Console | `js` | Compute | Escreva e execute JavaScript através do SDK do Rebase. Um script recebe `context.tables`, os descritores fornecidos (anteriormente `context.collections`), e acessa uma tabela como `client.data.<slug>` ou `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Inspecione e gerencie [tarefas agendadas](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Navegue, faça upload e gerencie arquivos em seus backends de armazenamento |
| API Explorer | `api` | API | Documentação interativa da API, com um executor de requisições |
| API Keys | `api-keys` | Access Control | Crie e gerencie chaves de API de serviço com escopo restrito; os alvos de um escopo `data:*` são as tabelas servidas |

### O que o Logs Explorer exibe

Dois fluxos em um buffer circular (ring) na memória, mantido no processo do servidor:

- **Todas as requisições** — método, caminho, status, duração, o `X-Request-ID`, a
  tabela quando a requisição se referia a uma e, em caso de falha, o
  `code` de erro e a mensagem que o cliente recebeu. Uma requisição com falha é registrada como
  `warn` (4xx) ou `error` (5xx), permitindo que o filtro de nível a localize.
  Sua `source` é derivada do caminho: `/api/auth/*` e `/api/oauth/*` são
  `auth`, `/api/storage/*` é `storage`, e tudo mais é `api`, permitindo que o
  filtro de Origem encontre logins sob Auth e uploads sob Storage.
- **Tudo o que o servidor reporta como warn ou error** — um aviso de esquema, uma
  recusa de autorização, um diagnóstico de driver, uma falha de inicialização. A `source` provém do
  próprio prefixo da mensagem (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), e
  qualquer coisa não reconhecida torna-se `system`.

Mensagens rotineiras de nível `info` são omitidas intencionalmente. O buffer retém 10.000 entradas
e um volume excessivo de status `200` acabaria removendo aquilo que você abriu o painel para encontrar.

Portanto, uma função customizada que lance um erro exibe sua própria mensagem aqui, associada à
requisição que a executou — exatamente o propósito para o qual isso existe.

O buffer é por processo e por inicialização: não é persistente, não é compartilhado
entre réplicas e uma reinicialização o limpa. Para qualquer dado que precise manter, leia
o stdout do processo, que contém essas mesmas linhas e muito mais.

O explorer deixa isso claro. Ele mostra o log da instância única de servidor que o está
atendendo e nomeia essa instância: o evento `snapshot` de
`GET /api/admin/logs/stream` traz `instance`, o `HOSTNAME` do processo (o
nome do pod no Kubernetes, o id do contêiner no Docker) ou, alternativamente, `pid-<n>`. Não
há visualização consolidada entre réplicas, nem dos processos `functions` e `worker` de uma
[implantação dividida (split deployment)](/docs/deployment/split-processes/). Uma reconexão que caia em
outra instância substitui a janela em vez de misturar os dois logs.

O **Collection Editor** também é uma ferramenta do Studio, mas não está nesta lista porque
é registrado de forma diferente: o `RebaseStudio` não o carrega sob demanda. O painel o monta
onde quer que o Studio e o CMS estejam registrados, pois, diferentemente das ferramentas acima,
ele edita a apresentação desenhada pelo CMS bem como o esquema. Essa é uma diferença na forma como
ele é montado, não no que ele é — ele edita esquemas e pertence ao mesmo espaço dos editores de SQL e
RLS.

## Ativando o Studio

Um único componente, em qualquer lugar dentro de `<Rebase>`. Ele não renderiza nada — ele registra
as ferramentas, e o `<RebaseShell>` as exibe:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

As ferramentas aparecem na gaveta lateral enquanto o modo Studio estiver ativo. Deixe
o `<RebaseStudio>` de fora completamente e você entregará um CMS apenas de conteúdo: sem modo Studio,
sem seletor, sem nada carregado sob demanda.

## Adicionando sua própria ferramenta

`devViews` posiciona suas próprias visualizações ao lado das nativas. Elas são
[`AppView`](/docs/frontend#custom-views)s comuns — a única coisa que torna uma delas uma
ferramenta do Studio em vez de uma visualização do CMS é em qual componente ela é registrada:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registrado em | Aparece em | Destinado a |
|---|---|---|
| `<RebaseCMS views>` | modo de conteúdo | recursos que as pessoas que editam conteúdo utilizam |
| `<RebaseStudio devViews>` | modo Studio | recursos que você utiliza para operar o backend |

Uma visualização vai para exatamente um deles — a gaveta lateral organiza os itens de acordo com quem
os registrou, portanto listar um slug em ambos oculta-o do modo de conteúdo.

Assim como `tools`, a lista é lida pelo seu *conteúdo*: defini-la inline é seguro, e
uma nova renderização do host não remonta a ferramenta que estiver na tela. Renomear uma
visualização ou alterar seu grupo causa um novo registro.

### Escolhendo quais ferramentas exibir

Omita `tools` e todas as ferramentas acima serão registradas. Passe a propriedade para registrar um subconjunto —
um console hospedado que possui seu próprio navegador de armazenamento, por exemplo, pode deixar essa ferramenta de fora:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

A visualização do Collection Editor no Studio corresponde à ferramenta `"schema"`. Omita `tools` e ela
estará presente; forneça uma lista sem `"schema"`, como acima, e ela ficará de fora.

A lista é lida por seu *conteúdo*, não por identidade, então escrevê-la inline é seguro: uma
nova renderização do componente host não desmonta nem remonta a ferramenta que estiver aberta.

## Próximos Passos

- **[Plugins](/docs/plugins)** — Estenda o framework com plugins
- **[Tabelas](/docs/schema/)** — Declarando as tabelas que o Studio lê
- **[Personalizando uma tabela](/docs/frontend/customize-table/)** — Como o painel as exibe
