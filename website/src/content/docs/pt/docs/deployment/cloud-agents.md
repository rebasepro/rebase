---
sourceHash: 582293a88fb2d626
title: CI, Agentes e Backends Reivindicáveis
sidebar_label: CI e Agentes
description: Faça deploy no Rebase Cloud a partir do CI ou de um agente com um token restrito em vez de uma senha, e deixe um agente provisionar um backend no ar, sem conta, que uma pessoa reivindica depois.
---

Um projeto do [Rebase Cloud](/docs/deployment/cloud/) não precisa de uma pessoa em um
terminal para fazer deploy. Um job de CI ou um agente atua com um token restrito a algumas
ações em um projeto, e um agente pode criar um projeto antes de alguém ter uma conta e
depois entregar um link para reivindicá-lo.


## CI e agentes

Um job de CI ou um agente não deve carregar a sua senha. Dê a ele um token em vez disso:
uma chave que age como a sua conta, restrita a algumas ações em um projeto. Crie-o a partir
de um terminal autenticado:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

O token é impresso uma única vez, como uma linha `export REBASE_TOKEN=rk_live_…`. Com
`REBASE_TOKEN` definido, todo comando `rebase cloud` se autentica com ele em vez do seu
login, e nunca lê nem grava a sessão armazenada. No GitHub Actions, guarde-o como um
segredo do repositório e exponha-o com esse nome:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` recebe uma ou mais capacidades, separadas por vírgula ou repetidas:

| Capacidade | O que o token pode fazer |
|---|---|
| `deploy` | Fazer deploy do projeto e acompanhar seus builds: `deploy` (`--preview` incluído), `deployments`, `previews` |
| `logs` | Ler os logs de build e de runtime, o histórico de cron, as métricas ao vivo e o uso: `logs`, `cron`, `metrics`, `usage` |
| `env` | Ler e alterar variáveis de ambiente, segredos inclusive, e as dos próprios previews (`--preview`) |
| `database` | `db list`, `db info` e `db connect`, que inclui a senha do banco de dados |
| `backups` | Listar, criar, inspecionar e baixar backups, e ler a janela de recuperação para um ponto no tempo |

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span> Mais três capacidades atuam sobre uma organização, e não sobre um projeto. Um token
só possui uma quando `--can` a nomeia, na organização que `--org` nomeia (ou,
sem `--org`, a organização do projeto e, depois, a selecionada com
`rebase cloud use`). Um token pode possuí-las sem nenhuma capacidade de projeto:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacidade | O que o token pode fazer |
|---|---|
| `billing` | Ler o cartão cadastrado, as faturas e a próxima fatura, e alterar o e-mail de cobrança: `billing`, `billing invoices`, `billing upcoming`. Apenas owners e admins |
| `audit` | Ler o log de atividade da organização: `activity`. Apenas owners e admins |
| `notifications` | Alterar as escolhas de e-mail do próprio dono e os webhooks de notificação dos projetos da organização: `notifications`. Adicionar, alterar e remover um webhook ainda exige o papel de owner ou admin |

Um token criado antes de
`billing` existir ainda lê o faturamento por mais um release. Cada uma dessas respostas
traz um cabeçalho `Deprecation: true` e uma frase que nomeia o escopo que falta ao token,
e a CLI a imprime uma vez, no stderr, como aviso. Substitua um token assim por um criado
com `--can billing` antes do próximo release, quando o faturamento passar a recusá-lo.

Por baixo dos panos, um token é uma [chave de API pessoal](/docs/backend/api-keys/#personal-keys)
no plano de controle. Cada capacidade se torna alguns
[escopos](/docs/backend/roles-and-scopes/): `deploy` em `shop` possui
`project:deploy:<id>`, com o id do projeto, além dos escopos de dados e de funções
que os comandos de deploy chamam. Uma capacidade de organização possui `org:billing:<id>`,
`org:audit:<id>` ou `org:notifications:<id>`, com o id da organização. O token nunca possui mais do que a sua conta possui no momento
em que é usado, então perde tudo o que a sua conta perde.

Duas coisas continuam com uma pessoa autenticada:

- **Gerenciar tokens.** `rebase cloud tokens list`, `create` e `revoke <id>` exigem
  a sua sessão de `rebase cloud login`. Um token não pode listar, criar nem revogar
  tokens, porque um token capaz de emitir tokens poderia emitir o seu próprio sucessor.
- **Restaurar.** Nenhuma capacidade concede a restauração de um backup nem um `restore` e
  `cutover` para um ponto no tempo. Sobrepor dados antigos a um banco de dados em produção
  continua com um owner ou admin autenticado.

`rebase cloud whoami` com um token definido mostra o que ele pode fazer, e em qual
projeto ou organização. A tela **Access tokens** do console oferece as mesmas
capacidades, e as de organização em **Organization access**. `rebase cloud tokens revoke <id> --yes` o interrompe na hora.

## Um backend sem conta

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

Um agente que construiu um app pode dar a ele um backend no ar antes que alguém tenha se
cadastrado, e entregar à pessoa para quem trabalha um link para ficar com ele:

```bash
rebase cloud init --claim
```

Isso provisiona um projeto no Rebase Cloud, define `REBASE_BASE_URL` no `.env` com o seu
endereço no ar, vincula o diretório e faz deploy das coleções locais com
`rebase cloud deploy --bundle`. Imprime a URL no ar, a URL do painel de administração e uma
**URL de reivindicação**. Quem abrir a URL de reivindicação e se autenticar pode mover o projeto para
uma de suas organizações. O link funciona uma única vez. Um projeto que ninguém reivindica em
72 horas é excluído, banco de dados inclusive. `rebase cloud claim` imprime a URL de
reivindicação de novo com o tempo restante, e `--open` a abre. A ferramenta
`rebase_cloud_provision` do servidor MCP executa o mesmo comando e devolve as mesmas URLs;
as outras ferramentas de cloud dele então verificam, fazem deploy, leem logs, definem variáveis e
revertem o projeto sem um login (veja [Servidor MCP](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` no `.env` também é para onde `rebase api-keys`, `rebase storage`
e `rebase auth reset-password` enviam a chave de serviço local, então, depois de `init
--claim`, eles vão para o projeto na cloud, que não aceita essa chave. Eles avisam isso
quando acontece; defina `REBASE_BASE_URL` no shell para alcançar um backend local
em vez disso.

Até o projeto ser reivindicado, ele não pertence a nenhuma conta. O token dele é restrito a
esse único projeto: faz deploy, lê logs e métricas, define variáveis de ambiente
e executa `db info`. Ele não lê de volta nada secreto: nem o valor de uma variável (a chave
de serviço inclusive), nem a senha do banco de dados, e não consegue abrir
`db connect` nem um preview. Fica guardado em
`~/.rebase/credentials.json`, nunca no repositório, e os comandos `rebase cloud`
no diretório vinculado o usam por conta própria. `REBASE_TOKEN`, quando definido,
ainda prevalece se tiver um escopo nesse projeto, e esses comandos avisam que
ele prevaleceu; quando não tem nenhum (um token de CI criado para outros projetos), o
token do próprio projeto é usado e o primeiro comando diz isso. Um comando com `--project`
para outro projeto mantém o `REBASE_TOKEN`, e o deploy que `init --claim` executa
sempre usa o token do próprio projeto. Ele expira com o projeto. `rebase cloud whoami` nesse diretório mostra o projeto, o que o
token pode fazer, a URL de reivindicação e quando o projeto expira. Um comando que precisa da
sessão de uma pessoa recusa com `session_required` e mantém o token; ele só é
esquecido quando o plano de controle o recusa em todo lugar, depois de uma reivindicação ou
na expiração, e a URL de reivindicação é impressa nesse momento. `rebase cloud status` mostra
a URL de reivindicação e a expiração também (`unclaimed` em `--json`). `rebase cloud unlink`
não exclui um projeto não reivindicado: avisa que o projeto continua rodando
até expirar e imprime a URL de reivindicação, e `init --claim` em um diretório
que já está vinculado a um aponta para a URL de reivindicação dele em vez de provisionar um
segundo. Até a reivindicação, o app alcança a internet apenas nas portas 80 e 443;
as portas de e-mail que todos os outros projetos têm (465, 587 e 993) são abertas quando o projeto
é reivindicado.

Depois que o deploy compila o app, o comando também define `REBASE_API_TOKEN` no
`.env`: uma chave emitida no próprio app, que é o que o servidor MCP e o SDK
enviam a ele. Um `REBASE_API_TOKEN` que já esteja no `.env` é mantido e nenhum é emitido,
e um `.env` que o comando cria é legível apenas por você. Ela lê e grava dados (`data:read`, `data:write`) por meio da
segurança em nível de linha do app, como um chamador que não é nem uma pessoa nem um admin. Ela
não possui nada do plano de administração, e expira com a janela de reivindicação, a menos que o
projeto seja reivindicado antes. Com `--no-deploy`, ou quando esse primeiro deploy falha,
ainda não há chave: o próximo `rebase cloud deploy` bem-sucedido no
diretório pede uma, desde que o projeto não esteja reivindicado e o `.env` não defina
nenhum `REBASE_API_TOKEN` ainda. `init`, `deploy`, `status` e `whoami` imprimem a
data em que ela expira.

A reivindicação entrega a chave: ela remove a expiração, de modo que o `.env` do app
continua funcionando. O agente ainda guarda uma cópia, então a pessoa que reivindicou o
projeto pode substituí-la. `rebase cloud app-key rotate`, ou **Rotate app key** nas
Settings do projeto, emite uma nova chave e revoga na hora todas as chaves anteriores do agente.
O comando grava a nova chave em um `.env` que já define `REBASE_API_TOKEN`,
ou a mostra uma única vez. Owners e admins a rotacionam, autenticados. Uma chave que não pôde ser
entregue mantém a sua expiração, o que acontece quando o app não havia sido implantado ou
não respondia na reivindicação. Rotacionar a substitui por uma que não expira.

A reivindicação também substitui a `REBASE_SERVICE_KEY` do projeto, que é admin na
API do próprio app e que o código implantado pelo agente poderia ler. O app
reinicia uma vez com uma nova chave, e tudo o que o agente guardou deixa de funcionar quando
essa reinicialização termina. Se um deploy estiver em andamento no momento da reivindicação,
o próximo deploy carrega a nova chave.

A reivindicação exige uma sessão de navegador autenticada, não um token, e uma forma de pagamento na
organização para a qual o projeto vai. A partir da reivindicação, o projeto é
cobrado como qualquer outro. Reivindicar também revoga o token do agente: autentique-se com
`rebase cloud login`, ou emita um novo token com `rebase cloud tokens create`.

O provisionamento sem conta é limitado por endereço, por rede (um IPv4
/24) e no total, e um plano de controle que não o tenha ativado recusa com
uma mensagem dizendo isso. O uso anterior à reivindicação não é cobrado de quem
reivindica o projeto.
