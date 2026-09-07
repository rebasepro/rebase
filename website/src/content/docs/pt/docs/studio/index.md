---
sourceHash: c9634d9fe5d4bd79
title: Ferramentas do Studio
sidebar_label: Studio
description: O Rebase Studio oferece ferramentas para desenvolvedores para edição visual de esquemas, consultas SQL, scripting JavaScript, gerenciamento de políticas RLS e navegação de armazenamento.
---

## Visão Geral

O Studio é a metade de desenvolvimento do painel de administração. O mesmo
aplicativo que sua equipe de conteúdo usa para editar linhas também traz um
editor de esquemas, um console SQL, um rascunho JavaScript, um navegador de
políticas RLS e um navegador de armazenamento — e o Studio é o modo que os
libera. Nada para instalar e nada para implantar: já está no painel, atrás do
seletor da gaveta.

![O editor de coleções, a ferramenta principal do Studio: um editor visual de esquemas que reescreve o seu TypeScript](/img/collection_editor.png)

Ele existe porque a alternativa é um segundo conjunto de credenciais. Editar uma
coleção, verificar o que uma política realmente permite ou rodar uma única
consulta contra a produção significa, do contrário, um cliente de banco de dados,
uma cópia da string de conexão e uma trilha de auditoria que termina em «alguém
com psql». O Studio faz tudo isso como o admin autenticado, através da mesma
autorização que a API usa.

## Os dois modos

O painel tem dois modos — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Para editores de conteúdo e equipes de operações. Mostra coleções e gerenciamento de dados. É o padrão.
- **Studio** (`"studio"`) — Para desenvolvedores. Libera as ferramentas abaixo.

Alterne entre eles com o controlador de modo admin ou com o seletor da gaveta. O
modo escolhido é persistido no `localStorage` sob `rebase-admin-mode`; um
navegador que usou o painel antes da 0.17.0 guarda o valor antigo `"content"` e é
migrado para `"cms"` na leitura.

## Ferramentas do Studio Integradas

### Editor de Coleções

Um editor visual de esquemas que permite criar e modificar coleções através de uma interface de arrastar e soltar. Ao salvar as alterações, ele usa [ts-morph](https://ts-morph.com/) para atualizar seus arquivos-fonte TypeScript via manipulação de AST — preservando todo o código existente e lógica personalizada. É a captura de tela no topo desta página.

O editor está ativo onde quer que o Studio esteja montado — o `<RebaseStudio/>` de um scaffold é suficiente, e não há nenhuma prop a acrescentar. `collectionEditor` afina-o, não o ativa:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// O Studio está montado, por isso o editor de coleções está disponível.
// Não é preciso mais nada.
<Rebase>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` serve para afinação — um editor só de leitura,
// outro token — não para ativar.
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Se um *guardar* chega a aplicar-se é decisão do servidor, não do painel: o editor reescreve os ficheiros de origem das coleções, por isso está desativado com `NODE_ENV=production`, em modo `baas` e num servidor sem `collectionsDir`. O painel consulta `GET /api/schema-editor/status` e mostra o motivo que recebe junto ao botão desativado.

### Ferramentas incorporadas

Vêm com o Studio e são **carregadas de forma diferida pelo `RebaseStudio`** — cada uma é um chunk separado, obtido na primeira vez que a abres. Não são importáveis isoladamente: o `@rebasepro/studio` exporta deliberadamente apenas o orquestrador, por isso uma consola que nunca abres não custa nada.

| Separador | Slug | Grupo | O que faz |
|-----------|------|-------|-----------|
| Consola SQL | `sql` | Base de dados | Executar SQL direto na tua base de dados PostgreSQL e ler os resultados numa tabela |
| Políticas RLS | `rls` | Base de dados | Inspecionar e gerir as políticas de Row Level Security das tuas tabelas |
| Visualizador de esquema | `schema-visualizer` | Base de dados | ERD interativo de tabelas e relações |
| Ramos | `branches` | Base de dados | Criar e gerir [ramos da base de dados](/docs/backend/branching) |
| Cópias de segurança | `backups` | Base de dados | Navegar e descarregar as cópias de segurança da base de dados |
| Explorador de logs | `logs` | Base de dados | Registo de pedidos em tempo real, mais tudo o que o servidor reporta em warn ou error — ver abaixo |
| Consola JS | `js` | Compute | Escrever e executar JavaScript através do SDK do Rebase |
| Tarefas cron | `cron` | Compute | Inspecionar e gerir [tarefas agendadas](/docs/backend/cron-jobs) |
| Armazenamento | `storage` | Storage | Navegar, carregar e gerir ficheiros nos teus backends de armazenamento |
| Explorador de API | `api` | API | Documentação de API interativa, com um executor de pedidos |
| Chaves de API | `api-keys` | Controlo de acesso | Criar e gerir chaves de API de serviço com âmbitos |

### O que o explorador de logs mostra

Dois fluxos num único anel em memória, mantido no processo do servidor:

- **Cada pedido** — método, caminho, estado, duração, o `X-Request-ID`, a coleção
  quando o pedido dizia respeito a uma e, quando o pedido falhou, o `code` de
  erro e a mensagem que o cliente recebeu. Um pedido falhado é registado em
  `warn` (4xx) ou `error` (5xx), para que o filtro de nível o encontre.
- **Tudo o que o servidor reporta em warn ou error** — um aviso de esquema, uma
  recusa de autenticação, um diagnóstico do driver, uma falha de arranque. O
  `source` vem do próprio prefixo da mensagem (`[API]`, `[Auth]`, `[storage]`,
  `[realtime]`), e tudo o que não for reconhecido fica `system`.

A conversa de rotina em `info` fica deliberadamente de fora. O anel guarda 10.000
entradas e um muro de `200` expulsa justamente aquilo que abriste o painel para
encontrar.

Uma função personalizada que lança uma exceção mostra por isso a sua própria
mensagem aqui, junto ao pedido que a chamou — o caso para o qual isto existe.

O anel é por processo e por arranque: não é durável, não é partilhado entre
réplicas e um reinício esvazia-o. Para tudo o que precises de guardar, lê o stdout
do processo, que leva as mesmas linhas e mais.

O **editor de coleções** também é uma ferramenta do Studio, mas não está nesta
lista porque é registado de outra forma: o `RebaseStudio` não o carrega de forma
diferida. O painel monta-o onde quer que o Studio esteja registado, porque, ao
contrário das ferramentas acima, precisa do código-fonte das coleções do projeto à
mão para lhe escrever de volta. É uma diferença na forma como é montado, não no
que é — edita esquema, e o seu lugar é ao lado dos editores de SQL e RLS.

## Ligar o Studio

Um componente, em qualquer lugar dentro de `<Rebase>`. Não renderiza nada —
regista as ferramentas, e o `<RebaseShell>` desenha-as:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

As ferramentas aparecem na gaveta enquanto o modo Studio estiver ativo. Deixa
`<RebaseStudio>` totalmente de fora e entregas um CMS só de conteúdo: sem modo
Studio, sem seletor, sem nada carregado de forma diferida.

## Adicionar a tua própria ferramenta

`devViews` coloca as tuas próprias vistas ao lado das integradas. São
[`AppView`](/docs/frontend#custom-views)s comuns — a única coisa que torna uma
delas uma ferramenta do Studio em vez de uma vista do CMS é o componente em que é
registada:

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

| Registada em | Aparece em | Para |
|---|---|---|
| `<RebaseCMS views>` | modo conteúdo | coisas que as pessoas que editam conteúdo usam |
| `<RebaseStudio devViews>` | modo Studio | coisas que tu usas para operar o backend |

Uma vista vai em exatamente um dos dois — a gaveta ordena por quem a registou, por
isso listar um slug em ambos esconde-a do modo conteúdo.

Tal como `tools`, a lista é lida pelo seu *conteúdo*: escrevê-la inline é seguro, e
uma nova renderização do host não volta a montar a ferramenta que está no ecrã.
Renomear uma vista ou mudar o seu grupo volta, esse sim, a registá-la.

### Escolher que ferramentas aparecem

Omite `tools` e todas as ferramentas acima são registadas. Passa-o para registar
um subconjunto — uma consola alojada que já tem o seu próprio navegador de
armazenamento, por exemplo, pode deixar essa de fora:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

A lista é lida pelo seu *conteúdo*, não pela sua identidade, por isso escrevê-la
inline é seguro: uma nova renderização do host não desmonta nem volta a montar a
ferramenta que está no ecrã.

## Próximos Passos

- **[Plugins](/docs/plugins)** — Estenda o framework com plugins
- **[Coleções](/docs/collections)** — Configuração de coleções
