# Move Up

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

![Move Up: the Move to top row in the workspace menu](https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/docs/promo-en.png)

Ajoute **Déplacer en haut** au menu `…` d'un espace de travail de DeepSeek Harness. Un clic effectue un seul réordonnancement via l'API officielle `workspaceRegistry.insertBefore` — la même écriture durable qu'un long glisser-déposer manuel.

- **Une seule action.** Pas d'étoiles, de favoris, de catégories épinglées, de tri au démarrage ni de tâche en arrière-plan. Si vous ne cliquez pas, rien ne se passe.
- **Sans état, sans dépendance, sans collecte de données.** Aucun fichier n'est écrit.
- **Le glisser-déposer manuel reste le vôtre.** Un déplacement ne contredit pas un glisser ultérieur.

## Installation

DSH bureau : **Réglages → Extensions → Ajouter une extension**.

```text
dsh-move-up@0.4.3
```

En CLI :

```sh
dsh plugin --profile <profile> add dsh-move-up@0.4.3
```

## Ce qui est vérifié

Le réordonnancement et l'écriture durable ont été vérifiés sur la version web macOS et l'application de bureau Windows. Linux et l'application de bureau macOS ne sont pas vérifiés ; voir [COMPATIBILITY.md](COMPATIBILITY.md).

## Licence

MIT. Documentation complète dans [README.md](README.md) (anglais) et [CHANGELOG.md](CHANGELOG.md).
