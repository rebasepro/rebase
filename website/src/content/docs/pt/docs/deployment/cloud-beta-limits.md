---
sourceHash: 77b432f86f85bc82
title: O que a versão beta do Rebase Cloud não inclui
sidebar_label: Limites da Beta do Cloud
description: O que a versão beta privada do Rebase Cloud ainda não faz — regiões, acesso self-service, um SLA, deploys de branch, identidades de máquina, um endpoint de banco de dados público — e o que significa fazer deploy com segredos de produção.
---

O [Rebase Cloud](/docs/deployment/cloud/) está em versão beta privada. Explicado claramente, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região hoje. O modelo de
  posicionamento existe na plataforma, mas um projeto não pode escolher uma região.
  `projects create --provider` e `--region` não são a exceção que parecem ser:
  eles registram a qual dos alvos de deploy registrados no plano de controle um
  projeto pertence, e há apenas um, portanto ambos assumem o valor padrão dele e
  nenhum deles move um projeto para outro lugar. `rebase cloud projects create --help`
  diz o mesmo.
- **Sem self-service.** O acesso é concedido em lotes; não existe um fluxo de
  cadastro e pagamento imediato.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de algum dos dois, informe
  ao solicitar o acesso em vez de assumir que existe.
- **Sem deploys de branch** e sem GitHub App nativo. Deploy hooks — URLs secretas
  para as quais você aponta um webhook do repositório — são a automação suportada.
  Os [deploys de preview](/docs/deployment/cloud/#preview-a-change) estão sendo
  lançados e são iniciados a partir da CLI.
- **Tokens agem como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é
  gerado por uma conta e age como ela; ainda não existe uma identidade de máquina
  pertencente à organização. Se você fizer login via CI, passe `REBASE_CLOUD_EMAIL`
  e `REBASE_CLOUD_PASSWORD` a partir de um gerenciador de segredos — `--password`
  coloca a senha no histórico do seu shell e na tabela de processos, e avisa sobre
  isso antes de autenticar. Se o `.rebase/cloud.json` do repositório especificar um
  plano de controle diferente do próprio da plataforma, passe-o como `--url` também:
  sem um terminal, o comando `login` se recusa a enviar uma senha para um host
  nomeado apenas pelo arquivo obtido no checkout.
- **Sem endpoint de banco de dados público.** Um banco de dados gerenciado não fica
  exposto à internet; portanto, o host exibido no console é o endereço que o seu
  backend usa para acessá-lo e não resolve para nada na sua máquina. `rebase cloud db connect`
  abre uma porta local que representa esse banco de dados, tunelado através do plano
  de controle, enquanto você o mantiver em execução — mas não existe um hostname
  permanente ao qual um serviço de terceiros possa se conectar. Para executar SQL
  sem um cliente Postgres local, `rebase cloud db query "<sql>"` ou
  `rebase cloud db query --file file.sql` abre o mesmo túnel para uma consulta,
  executa o texto como um script único (interrompendo no primeiro erro) e imprime a
  resposta de cada instrução (`--json` para scripts). Esse túnel e a senha por trás
  de `rebase cloud db info --reveal` exigem a função de proprietário (owner) ou
  administrador (admin) da organização: a mesma exigida pelo editor SQL do Studio,
  pois todos os três resultam em uma sessão nos seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente do
  aplicativo contém `REBASE_SERVICE_KEY` (admin em sua própria API), `DATABASE_URL`
  e `JWT_SECRET`, de modo que o código que um membro implanta pode lê-los, embora
  apenas proprietários e administradores possam revelá-los no console. Convide como
  membro apenas alguém em quem você confiaria esses valores.
- **A chave de serviço pode ser substituída.** As **Configurações** (Settings) do
  projeto (ou `rebase cloud service-key rotate`) emitem uma nova `REBASE_SERVICE_KEY`
  e reiniciam o aplicativo com ela. A chave antiga funciona até que o reinício
  seja concluído, e nada após isso; portanto, qualquer coisa que a tenha copiado
  será recusada a partir de então. Reivindicar um projeto faz o mesmo.

## Próximos passos

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy e o restante dos recursos.
- [Self-hosting](/docs/deployment/self-hosting/): a mesma imagem e pacote, executados por você.
