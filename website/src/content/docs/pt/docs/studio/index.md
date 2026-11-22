---
sourceHash: 042c679d9fdfa2aa
title: Ferramentas do Studio
sidebar_label: Studio
description: O Rebase Studio oferece ferramentas de desenvolvedor para consultas SQL, scripts JavaScript, gerenciamento de políticas RLS, diagrama de esquema e navegação de armazenamento.
---

## Visão geral

O Studio é a metade voltada para desenvolvedores do painel de administração. O mesmo aplicativo que sua
equipe de conteúdo usa para editar linhas também inclui um console SQL, um
scratchpad JavaScript, um editor de políticas RLS, um diagrama de esquema e
um navegador de armazenamento — e o Studio é o modo que os desbloqueia. Nada para instalar e nada para implantar:
ele já está no painel, atrás do alternador na gaveta (drawer).

Ele existe porque a alternativa é um segundo conjunto de credenciais. Editar uma
tabela, verificar o que uma política realmente permite ou executar uma consulta
em produção, de outra forma, significa um cliente de banco de dados, uma cópia da string de conexão
e uma trilha de auditoria que termina em "alguém com psql". O Studio faz tudo isso como
o administrador conectado, por meio da mesma autorização que a API usa.

## Os dois modos

O painel tem dois modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de conteúdo e equipes de operações. Mostra as tabelas e o gerenciamento de dados. Este é o padrão.
- **Studio** (`"studio"`) — Para desenvolvedores. Desbloqueia as ferramentas abaixo.

Alterne entre eles com o controlador de modo de administração ou o alternador da gaveta. O
modo escolhido é persistido no `localStorage` sob `rebase-admin-mode`; um navegador
que usou o painel antes da versão 0.17.0 mantém o valor antigo `"content"` e é
migrado para `"cms"` na leitura.

## Ferramentas integradas do Studio

O esquema de uma tabela é código: `defineTable` em `backend/schema`, ou — para um
projeto que não declara nenhum — o que quer que o banco de dados contenha, alterado com SQL ou uma
migração. O Studio não tem um editor visual de tabelas; a ferramenta Collections, que era um,
foi removida porque as colunas de uma tabela e sua apresentação no painel
foram desacopladas e um único formulário editando ambos não atendia mais a nenhum dos dois. O editor de RLS
ainda salva políticas em `backend/schema` em desenvolvimento, por meio do
mesmo passo planejar → confirmar → aplicar que a
[edição de esquema ao vivo](/docs/backend/live-schema-editing/).

### Ferramentas integradas

Cada ferramenta que reconhece o esquema lê as tabelas fornecidas pelo servidor, a partir de
`GET /api/schema/tables`, com ou sem o CMS na página — assim o Studio funciona
como o console de um backend sem painel de administração. Em relação a um runtime anterior à
versão 0.31, que não possui essa rota, as ferramentas com suporte ao esquema informam que o runtime precisa de
atualização em vez de tentar adivinhar; em um backend sem autenticação ou
quando a requisição falha, cada uma informa o motivo. O console SQL, logs, armazenamento e
as outras ferramentas que não leem o esquema funcionam independentemente disso.

Elas são fornecidas com o Studio e são **carregadas sob demanda (lazy-loaded) pelo `RebaseStudio`** — cada uma é um
chunk separado, buscado na primeira vez em que você a abre. Elas não podem ser importadas individualmente:
o `@rebasepro/studio` exporta deliberadamente apenas o orquestrador, para que um console que você nunca
abre não tenha custo algum.

| Aba | Slug | Grupo | O que faz |
|-----|------|-------|-----------|
| Tabelas | `tables` | Banco de Dados | Cria e altera tabelas, colunas, índices e metadados de tabelas (`rebase.table_meta`) do PostgreSQL, edita linhas diretamente e expõe tabelas via REST, Realtime, OpenAPI e MCP sem código |
| Console SQL | `sql` | Banco de Dados | Executa SQL bruto no seu banco de dados PostgreSQL e lê os resultados em uma tabela. A tabela mostra o resultado da última instrução, até suas primeiras 10.000 linhas ou 32 MB de valores; um resultado mais longo informa quantas linhas existiam, e a cópia e exportação incluem apenas as linhas exibidas. Esse resultado também oferece **Download full result as CSV**: o servidor transmite todo o conteúdo por meio de um cursor somente leitura (`POST /api/admin/sql/csv`), uma consulta por vez, em um servidor Postgres próprio em vez do banco de dados de desenvolvimento em processo. Os valores são o texto do banco de dados, como o psql os exibe, e **Export JSON** os grava dessa forma; **Export typed JSON** grava cada valor lido pelo tipo da coluna — inteiros e numéricos que um número JSON armazena exatamente, booleanos, `json`/`jsonb` como JSON — e mantém todos os outros valores como texto. Em todos os CSVs (exportação, cópia e download completo), um valor que uma planilha executaria como fórmula (que começa com `=`, `+`, `-`, `@`, uma tabulação ou retorno de carro, exceto um número com sinal) é gravado com um `'` inicial, como a exportação de coleções grava. Enquanto uma execução está em andamento, **Cancel run** devolve o controle do console imediatamente; um servidor que aceita o frame `CANCEL_SQL` do socket (ele lista `cancel_sql` no `hello` com o qual responde ao socket) também interrompe a instrução com `pg_cancel_backend`. O banco de dados de desenvolvimento em processo não pode ser interrompido, e um servidor mais antigo é deixado para concluir a instrução dentro do seu `statement_timeout` |
| Políticas RLS | `rls` | Banco de Dados | Inspeciona e gerencia políticas de Row Level Security para suas tabelas. O lado declarado é o que o servidor compilou do `rls` de cada tabela (servido para chamadores com `schema:read`), comparado com `pg_policies` da maneira como o `rebase doctor` avalia divergências: uma política é listada conforme o banco de dados a armazena, marcada com **Differs from code** onde não corresponder ao declarado pelo projeto, e uma regra declarada ausente no banco de dados é listada como não aplicada. Uma política gerada pelo Rebase não pode ser editada diretamente no banco de dados, e em uma tabela gerenciada pelo Rebase um banner avisa que cada inicialização do servidor e `rebase db push` reaplicam as políticas declaradas. Um chamador sem `schema:read` vê o que o banco de dados contém e é informado do motivo pelo qual a declaração não é mostrada |
| Visualizador de Esquema | `schema-visualizer` | Banco de Dados | Diagrama de entidades das suas tabelas e suas relações, desenhado a partir dos descritores fornecidos: nomes SQL, tipos Postgres, nulabilidade, chaves, valores de enum, chaves estrangeiras e junções conforme declarados pelas tabelas. Apenas os marcadores de RLS são lidos do banco de dados. O layout é executado em um web worker, para que a página permaneça responsiva enquanto um diagrama grande é organizado. Um esquema com mais de 300 tabelas é desenhado considerando a vizinhança de uma tabela por vez — as tabelas a uma ou duas relações de distância — começando pela tabela com mais conexões; escolha outra tabela na lista para navegar |
| Branches | `branches` | Banco de Dados | Cria e gerencia [branches de banco de dados](/docs/backend/branching), e analisa um branch como um pull request: suas alterações de esquema e de políticas RLS lado a lado, as linhas inseridas, atualizadas e excluídas, e uma mesclagem no banco de dados a partir do qual foi criado que define o que prevalece primeiro — consulte [Revisando e mesclando um branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Banco de Dados | Navega e faz download de backups de banco de dados |
| Explorador de Logs | `logs` | Banco de Dados | Log de requisições ao vivo, além de tudo o que o servidor relata como aviso (warn) ou erro — veja abaixo |
| Console JS | `js` | Computação | Escreva e execute JavaScript por meio do Rebase SDK. Um script recebe `context.tables`, os descritores servidos (anteriormente `context.collections`), e acessa uma tabela como `client.data.<slug>` ou `client.data.table("<slug>")` |
| Tarefas Cron | `cron` | Computação | Inspeciona e gerencia [tarefas agendadas](/docs/backend/cron-jobs), incluindo tarefas cron SQL e HTTP sem código |
| Armazenamento | `storage` | Armazenamento | Navega, faz upload e gerencia arquivos nos seus backends de armazenamento, além de configurar políticas declarativas de acesso ao armazenamento |
| Explorador de API | `api` | API | Documentação interativa da API, com um executor de requisições |
| Webhooks | `webhooks` | API | Configura e testa webhooks de banco de dados acionados em inserções, atualizações e exclusões de linhas |
| Usuários e Funções | `users` | Controle de Acesso | Gerencia contas de usuários, atribuições de funções e escopos de funções RBAC sem código |
| Chaves de API | `api-keys` | Controle de Acesso | Cria e gerencia chaves de API com escopo de serviço; os alvos de um escopo `data:*` são as tabelas servidas |

### O que o Explorador de Logs mostra

Dois fluxos em um ring buffer na memória, mantido no processo do servidor:

- **Cada requisição** — método, caminho, status, duração, o `X-Request-ID`, a
  tabela quando a requisição se referia a uma e, quando a requisição falha, o
  `code` de erro e a mensagem recebida pelo cliente. Uma requisição com falha é registrada em
  `warn` (4xx) ou `error` (5xx), para que o filtro de nível a localize.
  Sua `source` vem do caminho: `/api/auth/*` e `/api/oauth/*` são
  `auth`, `/api/storage/*` é `storage`, e todo o restante é `api`, de modo que o
  filtro de Origem encontra logins sob Auth e uploads sob Storage.
- **Tudo o que o servidor relata como warn ou error** — um aviso de esquema, uma
  recusa de autenticação, um diagnóstico de driver, uma falha de inicialização. A `source` vem do
  próprio prefixo da mensagem (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), e
  qualquer coisa não reconhecida é `system`.

Comunicações rotineiras de `info` são deliberadamente deixadas de fora. O ring buffer armazena 10.000 entradas
e uma enxurrada de respostas `200` expulsaria aquilo que você abriu o painel para encontrar.

Uma função personalizada que lança um erro, portanto, mostra sua própria mensagem aqui, associada à
requisição que a chamou — o caso para o qual isso existe.

O ring buffer é por processo e por inicialização: ele não é durável, não é compartilhado
entre réplicas e uma reinicialização o esvazia. Para qualquer coisa que você precise manter, leia
a stdout do processo, que contém as mesmas linhas e mais.

O explorador indica isso. Ele mostra o log da instância do servidor específica que o
está servindo e nomeia essa instância: o evento `snapshot` de
`GET /api/admin/logs/stream` carrega `instance`, o `HOSTNAME` do processo (o
nome do pod no Kubernetes, o id do contêiner no Docker) ou, caso contrário, `pid-<n>`. Não
há visualização entre réplicas, nem dos processos de `functions` e `worker` de uma
[implantação dividida (split deployment)](/docs/deployment/split-processes/). Uma reconexão que caia em
outra instância substitui a janela em vez de misturar os dois logs.

## Ativando o Studio

Um componente, em qualquer lugar dentro de `<Rebase>`. Ele não renderiza nada — registra
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

As ferramentas aparecem na gaveta enquanto o modo Studio estiver ativo. Deixe o
`<RebaseStudio>` totalmente de fora e você entregará um CMS apenas de conteúdo: sem modo Studio,
sem alternador, nada carregado sob demanda.

## Adicionando sua própria ferramenta

`devViews` coloca suas próprias visualizações ao lado das integradas. Elas são
[`AppView`](/docs/frontend#custom-views)s comuns — a única coisa que torna uma delas uma
ferramenta do Studio em vez de uma visualização do CMS é em qual componente ela está registrada:

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

| Registrado em | Aparece em | Para |
|---|---|---|
| `<RebaseCMS views>` | modo de conteúdo | coisas que as pessoas que editam conteúdo usam |
| `<RebaseStudio devViews>` | modo Studio | coisas que você usa para operar o backend |

Uma visualização vai para exatamente um deles — a gaveta classifica de acordo com quem a
registrou, portanto, listar um slug em ambos a oculta do modo de conteúdo.

Assim como `tools`, a lista é lida por seu *conteúdo*: escrevê-la inline é seguro, e
uma nova renderização do host não remonta a ferramenta que estiver na tela. Renomear uma
visualização ou alterar seu grupo a registra novamente.

### Escolhendo quais ferramentas aparecem

Omita `tools` e todas as ferramentas acima serão registradas. Passe-o para registrar um subconjunto —
um console hospedado que tem seu próprio navegador de armazenamento, por exemplo, pode omitir essa ferramenta:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, a ferramenta Collections, não é mais aceita: a ferramenta foi removida.

A lista é lida por seu *conteúdo*, não pela identidade, portanto, escrevê-la inline é seguro: uma
nova renderização do host não desmonta e remonta a ferramenta que estiver na tela.

## Próximos passos

- **[Plugins](/docs/plugins)** — Estenda o framework com plugins
- **[Tabelas](/docs/schema/)** — Declarando as tabelas que o Studio lê
- **[Personalizando uma tabela](/docs/frontend/customize-table/)** — Como o painel as exibe
