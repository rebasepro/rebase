---
sourceHash: 2def12479d23f2a9
title: Ferramentas do Studio
sidebar_label: Studio
description: O Rebase Studio oferece ferramentas de desenvolvedor para consultas SQL, scripts JavaScript, gerenciamento de políticas RLS, diagrama de esquema e navegação de armazenamento.
---

## Visão Geral

O Studio é a metade voltada para desenvolvedores do painel de administração. O mesmo aplicativo que sua equipe de conteúdo usa para editar linhas também traz um console SQL, um scratchpad JavaScript, um editor de políticas RLS, um diagrama de esquema e um navegador de armazenamento — e o Studio é o modo que os desbloqueia. Nada para instalar e nada para implantar: já está no painel, atrás da alternância no drawer.

Ele existe porque a alternativa é um segundo conjunto de credenciais. Editar uma tabela, verificar o que uma política realmente permite ou executar uma consulta em produção caso contrário significa um cliente de banco de dados, uma cópia da string de conexão e uma trilha de auditoria que termina em "alguém com psql". O Studio faz tudo isso como o administrador conectado, por meio da mesma autorização que a API usa.

## Os dois modos

O painel tem dois modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de conteúdo e equipes de operações. Mostra as tabelas e o gerenciamento de dados. Este é o padrão.
- **Studio** (`"studio"`) — Para desenvolvedores. Desbloqueia as ferramentas abaixo.

Alterne entre eles com o controlador de modo de administração ou a alternância no drawer. O modo escolhido é persistido no `localStorage` sob `rebase-admin-mode`; um navegador que usou o painel antes da versão 0.17.0 mantém o valor antigo `"content"` e é migrado para `"cms"` na leitura.

## Ferramentas Integradas do Studio

O esquema de uma tabela é código: `defineTable` em `backend/schema` ou — para um projeto que não declara nenhum — o que o banco de dados contiver, alterado com SQL ou uma migração. O Studio não tem editor visual de tabelas; a ferramenta Collections que funcionava como tal foi removida, porque as colunas de uma tabela e sua apresentação no painel foram desacopladas e um único formulário editando ambos não correspondia mais a nenhum dos dois. O editor RLS ainda salva políticas em `backend/schema` em desenvolvimento, por meio da mesma etapa de planejar → confirmar → aplicar que a [edição de esquema ao vivo](/docs/backend/live-schema-editing/).

### Ferramentas integradas

Toda ferramenta que conhece o esquema lê as tabelas fornecidas pelo servidor, a partir de `GET /api/schema/tables`, com ou sem o CMS na página — assim, o Studio funciona como o console de um backend sem painel de administração. Contra um runtime anterior ao 0.31, que não possui essa rota, as ferramentas com suporte a esquema informam que o runtime precisa de atualização em vez de tentar adivinhar; contra um backend sem autenticação, ou quando a requisição falha, cada uma indica o motivo. O console SQL, logs, armazenamento e as outras ferramentas que não leem o esquema funcionam independentemente disso.

Elas vêm com o Studio e são **carregadas sob demanda (lazy-loaded) pelo `RebaseStudio`** — cada uma é um chunk separado, buscado na primeira vez em que você a abre. Elas não são importáveis separadamente: `@rebasepro/studio` exporta deliberadamente apenas o orquestrador, de modo que um console que você nunca abre não consome recursos.

| Aba | Slug | Grupo | O que faz |
|-----|------|-------|-----------|
| Tabelas | `tables` | Banco de dados | Cada tabela e view do esquema. Para a selecionada: **Dados** lê suas linhas como dono do banco de dados via `/api/admin/db` (inclusive tabelas não servidas e views) com paginação, ordenação e filtros no servidor, células de chave estrangeira que abrem a linha para a qual apontam, um visualizador de valores, edições em linha e em lote e importação e exportação CSV, e **Ler como** um usuário da API mostra as linhas que a segurança em nível de linha dele devolve; **Estrutura** edita colunas (nome, tipo, nulabilidade, padrão), índices (com tamanho e varreduras), restrições (chave estrangeira, única, verificação) e triggers; **Políticas** é o editor da ferramenta Políticas para essa tabela, com suas permissões; **Relações** lista as chaves estrangeiras nos dois sentidos e desenha a vizinhança da tabela; **Estatísticas** mostra tamanhos, a estimativa de linhas, varreduras, linhas mortas e o último vacuum e analyze, com **Analisar** e **Vacuum**; **Configurações** contém os metadados da tabela (`rebase.table_meta`), renomear e excluir. **Ver SQL** mostra a definição da tabela como um único script. Um seletor acima da lista desenha o esquema inteiro como **Diagrama**. Cada mudança de esquema mostra antes o SQL que vai executar. A seleção fica na URL (`?table=schema.name&tableTab=…`), então outras views apontam direto para uma tabela Na tabela de autenticação, cada linha também redefine a senha ou a verificação em duas etapas da conta e desativa ou reativa a conta, como faz a coleção de usuários no painel de administração. |
| Editor SQL | `sql` | Banco de dados | Execute SQL puro contra seu banco de dados PostgreSQL e leia os resultados em uma tabela. Cada instrução de uma execução tem sua própria aba de resultado, com seu comando e número de linhas, e as instruções dividem um orçamento de 10.000 linhas ou 32 MB de valores; um resultado mais longo informa quantas linhas existiam, e a cópia e exportação incluem apenas as linhas exibidas. Tal resultado também oferece **Download full result as CSV**: o servidor faz o streaming de todo o resultado por meio de um cursor somente leitura (`POST /api/admin/sql/csv`), uma consulta por vez, em um servidor Postgres próprio em vez do banco de dados de desenvolvimento em processo. Os valores são o texto do banco de dados, como o psql os exibe, e **Export JSON** os grava dessa forma; **Export typed JSON** grava cada valor lido de acordo com o tipo de sua coluna — inteiros e numéricos que um número JSON suporta exatamente, booleanos, `json`/`jsonb` como JSON — e mantém todos os outros valores como texto. Em todo CSV (exportação, cópia e download completo), um valor que uma planilha executaria como fórmula (que comece com `=`, `+`, `-`, `@`, um tab ou um retorno de carro, que não seja um número com sinal) é gravado com um `'` inicial, assim como a exportação de coleções grava. Enquanto uma execução está em andamento, **Cancel run** devolve o console imediatamente; um servidor que aceita o frame `CANCEL_SQL` do socket (ele lista `cancel_sql` no `hello` com o qual responde ao socket) também interrompe a instrução com `pg_cancel_backend`. O banco de dados de desenvolvimento em processo não pode ser interrompido, e um servidor mais antigo é deixado para concluir a instrução dentro de seu `statement_timeout`. **Explain analyze** executa uma instrução dentro de uma transação que desfaz e mostra para cada passo o tempo real, as linhas, os loops e os buffers. Um placeholder `:name` ganha um campo acima do editor. Os snippets são salvos no projeto, compartilhados ou pessoais, e um resultado pode ser desenhado como gráfico de barras ou de linhas. |
| Políticas | `rls` | Banco de dados | Inspecione e gerencie políticas de Row Level Security para suas tabelas. O lado declarado é o que o servidor compilou do `rls` de cada tabela (servido a chamadores com `schema:read`), comparado com `pg_policies` da maneira que o `rebase doctor` avalia divergências: uma política é listada conforme o banco de dados a armazena, com o selo **Differs from code** onde isso não corresponde ao que o projeto declara, e uma regra declarada que o banco de dados não possui é listada como não aplicada. Uma política gerada pelo Rebase não pode ser editada diretamente no banco de dados, e em uma tabela gerenciada pelo Rebase um banner informa que cada inicialização do servidor e `rebase db push` reaplicam as políticas declaradas. Um chamador sem `schema:read` vê o que o banco de dados contém e é informado do motivo pelo qual a declaração não é exibida |
| Esquema | `schema-visualizer` | Banco de dados | Diagrama de entidades das suas tabelas e suas relações: os descritores servidos (nomes SQL, tipos do Postgres, chaves, valores enum, chaves estrangeiras, junções) e, num backend que serve `/api/admin/db`, o catálogo do banco de dados — tabelas que o servidor não serve, desenhadas como não servidas, e chaves estrangeiras que o código não declara. Onde a ferramenta Tabelas está registrada, o diagrama é o seu modo **Diagrama**, e esta ferramenta fica fora da navegação enquanto sua rota continua funcionando. O layout é executado em um web worker, para que a página continue responsiva enquanto um diagrama grande é organizado. Um esquema com mais de 300 tabelas é desenhado uma vizinhança por vez — as tabelas a uma ou duas relações — começando pela tabela mais conectada |
| Ramos | `branches` | Banco de dados | Crie e gerencie [branches de banco de dados](/docs/backend/branching) e revise uma branch como um pull request: suas alterações de esquema e política RLS lado a lado, as linhas inseridas, atualizadas e excluídas, e uma mesclagem no banco de dados do qual ela foi criada indicando o que prevalece primeiro — consulte [Revisando e mesclando uma branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Cópias de segurança | `backups` | Banco de dados | Navegue e baixe backups de banco de dados |
| Banco de dados | `database` | Banco de dados | O banco de dados como um todo. **Advisors** lista achados de segurança do [`rls-check`](/docs/rls-check) e de desempenho — índices sem uso e duplicados, chaves estrangeiras sem índice, tabelas sem chave primária, tabelas grandes lidas por varreduras completas, tabelas cheias de linhas mortas e buscas que leem uma tabela grande inteira —, cada um com o SQL que o corrige, para abrir no editor SQL. **Query performance** mostra as principais instruções do `pg_stat_statements` por tempo total, tempo médio ou chamadas, e instala a extensão onde o servidor a inclui. **Activity** lista as sessões deste banco de dados que estão fazendo algo, atualizadas a cada cinco segundos enquanto está aberta, com o que cada uma espera e qual sessão a bloqueia; uma consulta pode ser cancelada e uma sessão encerrada. **Functions**, **Triggers**, **Types** e **Extensions** listam esses objetos, removem uma função, adicionam um valor a um enum e instalam ou removem uma extensão, cada um mostrando antes seu SQL. Quando o backend serve mais de um banco de dados (o padrão e cada um declarado com `database("…")`), um seletor no cabeçalho escolhe qual cada seção lê e altera. O banco de dados de desenvolvimento integrado não coleta estatísticas de consultas nem tem outras sessões |
| Consola JS | `js` | Computação | Escreva e execute JavaScript por meio do Rebase SDK. Um script recebe `context.tables`, os descritores servidos (anteriormente `context.collections`), e acessa uma tabela como `client.data.<slug>` ou `client.data.table("<slug>")` |
| Tarefas agendadas | `cron` | Computação | Inspecione e gerencie [tarefas agendadas](/docs/backend/cron-jobs), incluindo tarefas cron SQL e HTTP sem código |
| Armazenamento | `storage` | Armazenamento | Navegue, faça upload e gerencie arquivos em seus backends de armazenamento, e configure políticas declarativas de acesso ao armazenamento |
| API | `api` | API | Documentação interativa da API, com um executor de requisições |
| Webhooks | `webhooks` | API | Configure e teste webhooks de banco de dados disparados em inserções, atualizações e exclusões de linhas |
| Registos | `logs` | API | Registro de requisições em tempo real, além de tudo que o servidor relata como warn ou error — veja abaixo |
| Papéis | `roles` | Controle de acesso | Os papéis que os usuários têm e os escopos que cada um concede: os declarados no código, somente leitura, e os criados em tempo de execução, que ele cria, edita e exclui. Qual usuário tem qual papel é editado na coleção de usuários. `users`, o nome antigo de quando também listava as contas, ainda funciona |
| Chaves de API | `api-keys` | Controle de acesso | Crie e gerencie chaves de API de serviço com escopo; os alvos de um escopo `data:*` são as tabelas servidas |

### O que a visualização de Logs mostra

Dois fluxos em um único buffer circular em memória, mantido no processo do servidor:

- **Cada requisição** — método, caminho, status, duração, o `X-Request-ID`, a
  tabela quando a requisição envolvia uma e, quando a requisição falha, o
  `code` de erro e a mensagem recebida pelo cliente. Uma requisição com falha é registrada em
  `warn` (4xx) ou `error` (5xx), para que o filtro de nível a encontre.
  Sua `source` vem do caminho: `/api/auth/*` e `/api/oauth/*` são
  `auth`, `/api/storage/*` é `storage` e todo o resto é `api`, permitindo que o
  filtro Source encontre logins em Auth e uploads em Storage.
- **Tudo o que o servidor relata em warn ou error** — um aviso de esquema, uma
  recusa de autenticação, um diagnóstico de driver, uma falha de inicialização. A `source` vem do
  próprio prefixo da mensagem (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), e
  qualquer coisa não reconhecida é `system`.

O tráfego rotineiro de `info` é deliberadamente deixado de fora. O buffer circular comporta 10.000 entradas
e uma enxurrada de status `200` descartaria aquilo que você abriu o painel para encontrar.

Uma função personalizada que lança um erro, portanto, mostra sua própria mensagem aqui, associada à
requisição que a chamou — o caso de uso para o qual isso existe.

O buffer circular é por processo e por inicialização: não é persistente, não é compartilhado
entre réplicas e uma reinicialização o esvazia. Para qualquer coisa que você precise manter, leia
o stdout do processo, que contém as mesmas linhas e mais.

O explorador indica isso. Ele mostra o log da instância de servidor específica que o
está servindo e nomeia essa instância: o evento `snapshot` de
`GET /api/admin/logs/stream` carrega `instance`, o `HOSTNAME` do processo (o
nome do pod no Kubernetes, o id do container no Docker) ou então `pid-<n>`. Não
há visualização entre réplicas, nem dos processos `functions` e `worker` de um
[split deployment](/docs/deployment/split-processes/). Uma reconexão que caia em
outra instância substitui a janela em vez de misturar os dois logs.

## Ativando o Studio

Um único componente, em qualquer lugar dentro de `<Rebase>`. Ele não renderiza nada — apenas registra
as ferramentas, e o `<RebaseShell>` as desenha:

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

As ferramentas aparecem no drawer enquanto o modo Studio estiver ativo. Deixe
o `<RebaseStudio>` completamente de fora e você entregará um CMS apenas de conteúdo: sem modo Studio,
sem alternância, nada carregado sob demanda.

## Adicionando sua própria ferramenta

`devViews` coloca suas próprias visualizações ao lado das integradas. Elas são
[`AppView`](/docs/frontend#custom-views)s normais — a única coisa que torna uma delas uma
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
| `<RebaseStudio devViews>` | modo Studio | coisas que você usa para executar o backend |

Uma visualização vai exatamente em um deles — o drawer classifica de acordo com quem a
registrou, portanto, listar um slug em ambos o oculta do modo de conteúdo.

Assim como `tools`, a lista é lida pelo seu *conteúdo*: escrevê-la inline é seguro, e
uma nova renderização do host não remonta a ferramenta que estiver na tela. Renomear uma
visualização ou alterar seu grupo a registra novamente.

### Escolhendo quais ferramentas aparecem

Omita `tools` e todas as ferramentas acima serão registradas. Passe-o para registrar um subconjunto —
um console hospedado que já tenha seu próprio navegador de armazenamento, por exemplo, pode deixar esse de fora:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, a ferramenta Collections, não é mais aceita: a ferramenta foi removida.

A lista é lida pelo *conteúdo*, não pela identidade, portanto escrevê-la inline é seguro: uma
nova renderização do host não desmonta e remonta a ferramenta que estiver na tela.

## Próximos Passos

- **[Plugins](/docs/plugins)** — Estenda o framework com plugins
- **[Tabelas](/docs/schema/)** — Declarando as tabelas que o Studio lê
- **[Personalizando uma tabela](/docs/frontend/customize-table/)** — Como o painel as exibe
