# cyy-pi

我的 Pi coding agent 全局配置备份（`~/.pi/agent`）。

## 内容

| 路径 | 说明 |
|---|---|
| `settings.json` | 全局设置：主题、已安装包、UI 选项 |
| `models.json` | 自定义 model provider（**API key 已脱敏为环境变量**） |
| `mcp.json` | MCP 服务器配置（playwright） |
| `themes/ghostty.json` | 自定义主题 |
| `extensions/statusline.ts` | 状态栏扩展：TPS、token 用量、上下文窗口 |

有意排除：`sessions/`（会话历史）、`models-store.json`（远程模型目录缓存）、`git/`（包缓存）、`auth.json`（凭证）。

## 还原

```bash
git clone https://github.com/chenyuyang712/cyy-pi ~/cyy-pi
cd ~/cyy-pi

# 1. 配置文件
cp settings.json mcp.json models.json ~/.pi/agent/
cp -r themes extensions ~/.pi/agent/

# 2. 设置 API key（models.json 里以 $VAR 形式引用）
export CYY_A2API_API_KEY='sk-a2a-...'
export OPENCODE_GO_API_KEY='oc_sk_...'
```

Pi 的 `apiKey` 字段支持 `"$ENV_NAME"` 形式的环境变量插值，所以还原后无需把明文 key 写回文件。
长期使用可把这两个变量写进 shell profile（`~/.zshrc`）。

```bash
# 3. 还原扩展包
pi install git:github.com/obra/superpowers

# 4. 验证
pi list          # 应显示 superpowers
pi mcp list      # 应显示 playwright
```

启动后在 `/settings` 里确认 Theme 为 `ghostty`，`/model` 里确认 provider 可用。

## 备注

- 本仓库为 **public**，因此 `models.json` 中的真实密钥已被替换为占位符。切勿把明文 key 提交进来。
- `models-store.json` 不入库：Pi 启动时会向 `https://pi.dev/api/models/providers/<id>` 重新拉取模型目录，属可再生缓存。
- `sessions/` 不入库：包含完整对话历史与敏感内容，且体积持续增长。
