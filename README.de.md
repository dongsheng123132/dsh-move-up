# Move Up

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Русский](README.ru.md) · [Português](README.pt.md)

![Move Up: the Move to top row in the workspace menu](https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/docs/promo-en.png)

Fügt **Nach oben verschieben** zum `…`-Menü eines Arbeitsbereichs in DeepSeek Harness hinzu. Ein Klick führt genau eine Umsortierung über die offizielle `workspaceRegistry.insertBefore`-API aus — derselbe dauerhafte Schreibvorgang wie ein langes manuelles Ziehen.

- **Nur eine Aktion.** Keine Sterne, Favoriten, angehefteten Kategorien, kein Sortieren beim Start, keine Hintergrundarbeit. Ohne Klick passiert nichts.
- **Kein Zustand, keine Abhängigkeiten, keine Datenerfassung.** Es wird keine Datei geschrieben.
- **Manuelles Ziehen bleibt deins.** Ein einmaliges Verschieben widerspricht keinem späteren Ziehen.

## Installation

DSH Desktop: **Einstellungen → Plugins → Plugin hinzufügen**.

```text
dsh-move-up@0.4.3
```

Per CLI:

```sh
dsh plugin --profile <profile> add dsh-move-up@0.4.3
```

## Was geprüft ist

Umsortierung und dauerhafte Speicherung wurden in der macOS-Webversion und der Windows-Desktop-App geprüft. Linux und die macOS-Desktop-App sind ungeprüft; siehe [COMPATIBILITY.md](COMPATIBILITY.md).

## Lizenz

MIT. Vollständige Dokumentation in [README.md](README.md) (Englisch) und [CHANGELOG.md](CHANGELOG.md).
