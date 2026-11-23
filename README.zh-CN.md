[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文**

# discord

Discord 聊天提供方 `bmo-discord`。它通过基础库 `bmo-chat` 的聊天协议,在聊天 receiver 面前充当 Discord:声明自己的
读取模式、能做的事以及房间所用的方言(dialect),通过机器人账号读取房间,发送它所声明的动词,并把房间里的发言交给
receiver。所有者本人的账号在 gateway 确认之后,以 `human-reader` 和 `human-avatar` 两种身份发送。由于 Discord 的
条款禁止自动化用户账号,这里不运行任何为智能体创建的账号。

## 测试与测试账号

- **大部分行为测试暂缓。** 测试集包含针对替身 gateway 的声明、房间模式、监听、health、文档发送和成员测试,以及针对
  替身 Discord 的 gateway 机器人令牌、所有者账号、输入中与在线状态、成员测试。
- **声明测试**确认:无论设置了哪些令牌、gateway 对所有者账号如何作答,服务所声明的模式和能力都保持不变。
- **监听测试**确认:`peopleTyping` 和 `presence` 按 gateway 回答它能否听到各自来声明;服务只针对 receiver 一侧正在
  监听的房间通知输入中标记或在线状态变化。
- **health 测试**确认:没有 Discord 应用时服务处于就绪状态,但原因中指出缺少的设置,且所有模式都处于停用;设置了令牌
  且 gateway 回答就绪时服务就绪;gateway 无应答,或回答 Discord 拒绝了令牌时,服务未就绪。
- **文档发送测试**确认:保存在磁盘上的文件以内联方式发送给 gateway;超过方言文件上限的文件按大小直接拒绝,不询问
  gateway。
- **成员测试**确认:房间成员按 gateway 的列表原样返回;gateway 的 `not-found` 视为未持有成员;未配置的提供方不询问
  gateway,也不持有任何成员。
- **机器人令牌测试**(`gateway/tests/`)确认:未设置令牌时 gateway 的 health 为就绪并说明令牌未设置;Discord 接受
  令牌后就绪;Discord 拒绝时未就绪,并说明拒绝原因。
- **输入中与在线状态测试**(`gateway/tests/`)确认:输入开始在已编号的房间中以十秒标记通知,但不通知机器人账号的
  输入,也不通知提供方经由所有者账号进行的输入;为其他账号发送输入中会被拒绝;identify 的 intents;新会话的服务器
  (guild)以一份完整列表通知,并映射 Discord 的状态;每个人连同其所在的房间一起通知。
- **所有者账号测试**(`gateway/tests/`)确认:gateway 对所有者账号的确认,以及 `human-avatar` 发送会带上、
  `human-reader` 发送不会带上的前缀。
- **gateway 的成员测试**(`gateway/tests/`)确认:私信(DM)的成员是其接收者和机器人账号;服务器频道的成员是机器人
  账号和 Discord 仍然保有的发言者;每个人以昵称、显示名或用户名称呼。
- **testbed 的 `personal-data` 检查会读取所有被跟踪的文件**,查找邮件地址、主目录路径、电话号码、令牌和私有网络
  地址,并对每处发现给出文件、行号和类别(`PERSONAL-DATA.md`)。
- **没有连接 Discord 测试账号**,因此这里的一切都尚未在真实的 Discord 服务器上试过。

## 目录结构

| 目录 | 内容 |
|---|---|
| `src/` | 服务自身的包:声明、`discord-markdown` 方言、协议路由、与 receiver 的连接,以及生成的 gateway 客户端(`seam.rs`) |
| `gateway/` | gateway,一个 bun 包,持有机器人账号的套接字、所有者账号的令牌、REST 调用、提供方的编号存储以及生成的服务客户端(`seam.ts`),其测试位于 `gateway/tests/` |
| `policy/` | 提供方的固定值:能力、声明 `own-account` 模式不受支持时引用的条款文字、所有者账号的发送节奏、编号所在的范围,以及方言的上限和写作说明 |
| `lang/` | 该提供方呈现给人阅读的文字:平台标签,以及转交消息时附带的标记 |
| `tools/` | `generate.ts`,根据 `docs/openapi.json` 生成两个客户端 |
| `deploy/` | 部署时链接的两个服务单元:Rust 服务和 bun gateway |
| `tests/` | 服务唯一的测试入口 `tests/main.rs` 及其模块:针对替身 gateway(`stand_in.rs`)的声明、房间模式、监听、health、文档发送和成员测试 |
| `docs/` | 关于提供方所做之事的权威说明 |

根目录下有服务唯一一个包的 Cargo 清单、记录在 `VERSION` 中的版本号、`testbed.toml`(testbed 关于本仓库如何测试、
检查、构建和部署的声明)、testbed 检查所读取的韩语台账、`settings.example.env`(两个进程读取的全部设置及中性的示例
值)、`PERSONAL-DATA.md`(绝不能出现在这里的个人数据)、`install.toml`(在新机器上安装所需内容的声明，由 `bmo install` 读取)、`rustfmt.toml` 和 `CLAUDE.md`。

## 文档

| 文档 | 内容 |
|---|---|
| `docs/api.md` | 提供方的固定 API:传输格式、资源、路由和代码 |
| `docs/openapi.json` | 以 OpenAPI 3.1 描述的同一 API,两个客户端均由它生成 |
| `docs/boundary-api.md` | 边界:提供的路由、对 receiver 一侧的调用、服务与 gateway 之间的接缝、配置和客户端 |
| `docs/discord.md` | 提供方本身:声明、套接字、由哪个账号回应房间、动词、方言、编号和拒绝 |
| `PERSONAL-DATA.md` | 绝不能出现在这里的个人数据,以及守住这一点的检查 |

## 版本

- **整个仓库只有一个版本号。** 它保存在 `VERSION` 中,包的版本与之相同,gateway 的 `package.json` 也使用同一版本。
- **版本只在所有者宣布的发布时变动**,如 bmo-chat 的 `docs/conventions.md`「Versions」所述。提交、部署、修复或契约
  变更都不会改变版本,部署以提交来区分。

## 构建检查

Cargo 通过 testbed 的 Cargo 动词运行,在唯一的共享构建目录中构建;若已安装的 testbed 没有自己的 Cargo 动词,则由
`bmo cargo` 执行同一动词:

```sh
bmo cargo check --all-targets
bmo cargo clippy --all-targets -- -D warnings
bmo cargo fmt --check
```

gateway 的类型在 `gateway/` 中检查:

```sh
bun install
./node_modules/.bin/tsc --noEmit
```

两个接缝客户端由 `docs/openapi.json` 生成;修改该文档后需重新生成:

```sh
bun tools/generate.ts
```
