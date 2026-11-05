---
sourceHash: e1c04397c988a38d
title: Conecte o Claude ao Rebase Cloud
sidebar_label: Conector do Rebase Cloud
description: Um só conector MCP para todos os seus projetos do Rebase Cloud — adicione-o uma vez no Claude, entre com sua conta Rebase, e leia, implante e altere seus projetos com o acesso que você tem no console, com cada alteração confirmada antes.
---

O conector do Rebase é um único servidor MCP para tudo o que você executa no
Rebase Cloud. Você o adiciona uma vez no Claude, entra com sua conta Rebase, e o
Claude pode ver seus projetos, ler os logs deles, implantá-los e revertê-los,
definir suas variáveis de ambiente, e ler e alterar seus dados. Funciona no
Claude na web, no app para desktop e no celular.

Ele age **como você**, com o acesso que sua conta tem no console: os projetos
das organizações das quais você faz parte, o papel que você tem em cada uma, e o
acesso a dados que o Studio do console lhe dá. Ele não guarda nenhuma chave
própria.

## Adicione

No Claude, abra **Configurações → Conectores → Adicionar conector
personalizado** e informe:

```text
https://app.rebase.pro/mcp
```

O Claude abre a tela de consentimento do Rebase. Se você estiver conectado ao
console no mesmo navegador, ela oferece essa conta: pressione **Permitir**.
Caso contrário, entre por ali. A tela lista o que você concede; você pode se
conectar de novo depois para conceder menos.

## O que o Claude pode fazer com ele

<span class="since-badge" data-since="0.28">Since 0.28</span>

Dez ferramentas. As seis primeiras só leem:

| Ferramenta | O que faz |
|---|---|
| `projects` | Lista seus projetos, o status deles e seu papel em cada um |
| `project_status` | O status e a implantação mais recente de um projeto; opcionalmente suas implantações recentes, os **nomes** das variáveis de ambiente, seus cron jobs |
| `logs` | A saída do app em execução, o log de build de uma implantação, ou as execuções de um cron job |
| `schema` | As coleções de um projeto, ou os campos de uma coleção |
| `query` | Lê linhas: uma por id, uma página filtrada, ou uma contagem |
| `show_collection` | Mostra linhas como uma tabela na conversa, onde você pode paginar e editar células |

As outras quatro alteram a produção, e cada uma pergunta antes:

| Ferramenta | O que faz |
|---|---|
| `write` | Cria, atualiza ou exclui uma linha (inclusive usuários: são linhas da sua coleção de usuários) |
| `deploy` | Implanta um branch do git, reverte para uma implantação anterior, ou cancela uma em andamento |
| `env` | Define ou remove variáveis de ambiente; uma alteração vale a partir da próxima implantação |
| `cron` | Executa um cron job agora, ou o liga ou desliga |

Implantar código da sua máquina continua sendo tarefa da CLI
(`rebase cloud deploy`) e do [servidor MCP local](/docs/ai/mcp/), que também
cobre o desenvolvimento local, a geração do esquema e os branches de banco de
dados.

## Toda alteração é confirmada

Uma ferramenta que altera algo precisa de duas chamadas. A primeira não altera
nada: responde com um plano, como "Reverter shop para a implantação d_81f2", e
um token de confirmação. O Claude mostra o plano a você e chama de novo com o
token só se você concordar. O token vale por cinco minutos, uma vez, exatamente
para os argumentos para os quais foi criado: se algo for diferente, nada é
executado.

O Claude também pede sua permissão antes de chamar qualquer uma dessas quatro
ferramentas, porque elas estão marcadas como destrutivas. Na visualização em
tabela, uma célula editada mostra o plano e espera você pressionar **Salvar**.

Os valores das variáveis de ambiente nunca são mostrados de volta: um plano
mostra o tamanho deles, e `project_status` lista só os nomes. Um valor que você
define, porém, passa pela conversa.

## Até onde ele chega

- **Projetos e operações na nuvem**: o que o console permite a você. Um membro
  de uma organização pode ler o status e os logs e, como no console, implantar e
  definir variáveis.
- **Dados, esquemas e cron jobs**: o que o Studio permite a você no console. Ou
  seja, um owner ou admin da organização, em um projeto com o acesso do Studio
  ligado. As chamadas são executadas dentro do projeto, sob a segurança em nível
  de linha dele, com o papel de admin que o Studio tem. Desligar o acesso do
  Studio para um projeto também desliga isto.
- **O que você concedeu.** Você pode conceder ao conector menos do que sua conta
  tem: só leitura, ou um só projeto. Ele nunca pede backups, restaurações,
  credenciais do banco de dados nem configurações do projeto.

Um projeto deixa seus dados acessíveis pelo conector assim que executa um
runtime que aceita as chamadas do conector. Até a próxima implantação dele ou a
próxima atualização da plataforma, essas ferramentas avisam isso.

## Desconectar

Remova o conector nas configurações do Claude. O token de acesso dele para de
funcionar em até uma hora. Excluir sua conta Rebase, ou sair de todas as
sessões, o interrompe na chamada seguinte.

O conector é para quem constrói no Rebase Cloud. Para que as pessoas que
**usam** o seu app conectem o Claude a ele em nome próprio, sirva o
[endpoint MCP remoto](/docs/ai/remote-mcp/) a partir do seu próprio backend.
