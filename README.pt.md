# Move Up

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · **Português**

![Move Up: the Move to top row in the workspace menu](https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/docs/promo-en.png)

Adiciona **Mover para o topo** ao menu `…` de um espaço de trabalho do DeepSeek Harness. Um clique faz uma única reordenação através da API oficial `workspaceRegistry.insertBefore` — a mesma gravação durável de um arrasto manual longo.

- **Apenas uma ação.** Sem estrelas, favoritos, categorias fixadas, reordenação na inicialização ou tarefas em segundo plano. Se você não clicar, nada acontece.
- **Sem estado, sem dependências, sem coleta de dados.** Nenhum arquivo é gravado.
- **O arrasto manual continua seu.** Mover uma vez não interfere em um arrasto posterior.

## Instalação

DSH desktop: **Configurações → Plugins → Adicionar plugin**.

```text
dsh-move-up@0.4.3
```

Via CLI:

```sh
dsh plugin --profile <profile> add dsh-move-up@0.4.3
```

## O que foi verificado

A reordenação e a gravação durável foram verificadas na versão web do macOS e no aplicativo desktop do Windows. Linux e o aplicativo desktop do macOS não foram verificados; veja [COMPATIBILITY.md](COMPATIBILITY.md).

## Licença

MIT. Documentação completa em [README.md](README.md) (inglês) e [CHANGELOG.md](CHANGELOG.md).
