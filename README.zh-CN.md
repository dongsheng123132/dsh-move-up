# 移到最上面

[English](README.md)

在 DSH 工作区 `…` 菜单中增加「移到最上面」。点击一次，通过官方 `workspaceRegistry.insertBefore` 接口完成一次排序，相当于替你完成一次长距离拖动。

- 只做一件事：没有星标、收藏区、固定置顶或自动归位。
- npm 包 7 KB，无运行时依赖，不存状态，不跑后台任务。不点它，什么都不会发生。
- 仍可自由拖动；启动与同步时不恢复旧顺序。

## 安装

```sh
dsh plugin --profile desktop add dsh-move-up@0.2.1
```

## 加进 DSH Discover（可选）

DSH 0.2.2 带一个实验性的插件市场（Discover 标签页）。它没有官方总目录，只显示用户自己添加的索引源。本仓库就是一个索引源：

```text
https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/plugin-index.json
```

打开 **Plugins → Discover → Add index source**，粘贴上面的地址，然后搜 `move-top`。从 Discover 安装仍走正常的插件确认与 npm。

## 兼容性与限制

已在 **macOS + DSH 0.2.1-rc.5** 验证，本版本精确对应该宿主。菜单根据浏览器语言显示中文或英文。

宿主没有工作区菜单扩展位，因此客户端使用当前工作区行和菜单 DOM。宿主改变该结构后，菜单项可能消失；插件不会因此自行排序。Windows 真机与非空会话菜单的浏览器行为尚未验证。

## 验证

```sh
npm ci
npm run check
```

## 许可证

MIT
