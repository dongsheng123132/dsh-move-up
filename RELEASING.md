# 发版手册（维护者用）

针对 `dsh-move-up` 的发布流程。发布是**不可回滚的公开动作**，下面每一步都有判据，不看命令输出就宣布成功是违规的。

## 0. 环境前提

```sh
export npm_config_cache=/tmp/npmcache-repo   # 系统 ~/.npm 有 root 属主文件，会用 EPERM 挡住 npm
npm whoami --registry=https://registry.npmjs.org   # 应为 hfshfg
```

- registry 一律显式写 `https://registry.npmjs.org`（本机全局配置可能指向镜像）。
- 发布写操作可能要求 OTP；用 npm 恢复码时 `--otp=<码>`，每次消耗一个。

## 1. 改版本、跑门禁

```sh
# package.json: version 0.4.0 → 0.4.1（修 bug）或 0.5.0（改契约/行为）
npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm run check            # 类型检查 + 构建 + 全部测试，必须 0 fail
npm run compat:matrix    # 真装多个宿主版本重跑组合测试，一张表一行一个宿主
```

`compat:matrix` 失败时**不要发布**：它证明的是插件在真实宿主包上的激活与排序行为。

## 2. 本地打包自检

```sh
npm pack
tar tzf dsh-move-up-<version>.tgz | sort
```

必须满足：

- 有 `client/client.js`、`lib/index.js`、`cordis.patch.yml`、`package.json`；
- 没有 `node_modules/`、没有 `*.tgz` 自身；
- `tar xzOf ... package/package.json` 里的 `engines.dsh`、`peerDependencies` 是预期值（`engines.dsh` 只在顶层 `engines` 下，写进 `dsh.engines` 是无效的）。

## 3. 发布

```sh
npm publish --registry=https://registry.npmjs.org
```

判据（三步都要）：

```sh
npm view dsh-move-up dist-tags.latest            # 等于新版本号
npm view dsh-move-up@<version> dist.tarball      # 拉下来
tar tzf <拉下来的 tarball>                        # 内容与第 2 步一致
```

**CDN 有 2–3 分钟传播延迟**：刚发布就查 registry 看到旧版本是正常的，不要因为这个重复发布。
首发的 staged publish 会让 `latest` 停在 `0.0.0-stage`，需要去 npmjs 包页面用 2FA 批准。

## 4. 与旧包名对齐

同功能旧包只做 **deprecate**（不删、不 unpublish，已装用户不受影响）：

```sh
npm deprecate dsh-plugin-workspace-move-top@'<=0.2.2' \
  'Renamed: install dsh-move-up@>=0.4.0 (same one-shot move-to-top, tested across DSH 0.2.1-rc.5–0.2.2).' \
  --registry=https://registry.npmjs.org

npm deprecate dsh-plugin-workspace-favorites@'<=0.2.1' \
  'Misleading name: this package never had favorites or pins — it only moves a workspace to the top. Install dsh-move-up@>=0.4.0.' \
  --registry=https://registry.npmjs.org
```

判据：`npm view <old> deprecated` 返回文案；`npm view <old> version` 仍是原版本（没有改动内容）。

## 5. Git 与 Discover 索引

```sh
# plugin-index.json 里的 versions[].publishTimestamp 换成真实发布时刻
git add -A && git commit -m "release: dsh-move-up <version>"
git tag v<version> && git push origin main --tags
```

Discover 索引源是仓库里的 `plugin-index.json`（`https://raw.githubusercontent.com/dongsheng123132/dsh-move-up/main/plugin-index.json`），推完 main 即生效；索引里只保留当前版本与必要的兼容说明。

## 6. 新 DSH 版本出现时

不需要改声明（`engines.dsh` 只有下界），要做的是**验证**：

```sh
npm run compat:matrix -- --hosts <新版本>,<旧版本1>,<旧版本2>
```

- 全绿 → 在 `COMPATIBILITY.md` 加一行证据，补个 patch 版本发布。
- 有红 → 看报告里失败的 host 与步骤，通常是客户端后端或注册表 API 变了；修完再发，必要时在 `COMPATIBILITY.md` 写明降级行为。
