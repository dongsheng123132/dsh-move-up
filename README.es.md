# Move Up

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

![Move Up: the Move to top row in the workspace menu](https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/docs/promo-en.png)

Añade **Mover arriba** al menú `…` de un espacio de trabajo de DeepSeek Harness. Un clic realiza un único reordenamiento mediante la API oficial `workspaceRegistry.insertBefore`; es la misma escritura duradera que un arrastre manual largo.

- **Una sola acción.** Sin estrellas, favoritos, categorías fijadas, reordenamiento al iniciar ni tareas en segundo plano. Si no lo pulsas, no ocurre nada.
- **Sin estado, sin dependencias, sin recopilación de datos.** No escribe ningún archivo.
- **El arrastre manual sigue siendo tuyo.** Mover una vez no interfiere con un arrastre posterior.

## Instalación

DSH de escritorio: **Ajustes → Complementos → Añadir complemento**.

```text
dsh-move-up@0.4.3
```

Por CLI:

```sh
dsh plugin --profile <profile> add dsh-move-up@0.4.3
```

## Qué está verificado

Se comprobó el reordenamiento y la escritura duradera en la versión web de macOS y en la app de escritorio de Windows. Linux y la app de escritorio de macOS no están verificados; consulta [COMPATIBILITY.md](COMPATIBILITY.md).

## Licencia

MIT. Documentación completa en [README.md](README.md) (inglés) y [CHANGELOG.md](CHANGELOG.md).
