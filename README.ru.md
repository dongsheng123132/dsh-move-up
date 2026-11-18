# Move Up

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Русский** · [Português](README.pt.md)

![Move Up: the Move to top row in the workspace menu](https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/docs/promo-en.png)

Добавляет **«Переместить наверх»** в меню `…` рабочего пространства DeepSeek Harness. Один клик выполняет одно переупорядочивание через официальный API `workspaceRegistry.insertBefore` — та же долговременная запись, что и при длинном ручном перетаскивании.

- **Только одно действие.** Без звёздочек, избранного, закреплённых категорий, сортировки при запуске и фоновых задач. Если не нажать — ничего не произойдёт.
- **Без состояния, зависимостей и сбора данных.** Ни один файл не записывается.
- **Ручное перетаскивание остаётся вашим.** Однократное перемещение не конфликтует с последующим перетаскиванием.

## Установка

DSH для компьютера: **Настройки → Плагины → Добавить плагин**.

```text
dsh-move-up@0.4.3
```

Через CLI:

```sh
dsh plugin --profile <profile> add dsh-move-up@0.4.3
```

## Что проверено

Переупорядочивание и долговременная запись проверены в веб-версии macOS и в приложении для Windows. Linux и приложение для macOS не проверялись; см. [COMPATIBILITY.md](COMPATIBILITY.md).

## Лицензия

MIT. Полная документация в [README.md](README.md) (английский) и [CHANGELOG.md](CHANGELOG.md).
