---
原文链接: https://linux.do/t/topic/1147571
保存时间: 2025-12-04 10:16:07
---

[![title](https://linux.do/uploads/default/optimized/4X/c/d/9/cd905cb68252469b611562abb2c20500282554e0_2_690x112.jpeg)

title1906×311 170 KB

](https://linux.do/uploads/default/original/4X/c/d/9/cd905cb68252469b611562abb2c20500282554e0.jpeg "title")

---

**如何使用? gemini版本？**

> [【自己动手，丰衣足食 02】人生苦短，我全都要，一个 CLAUDE.md 实现的三位一体协同办公 - 开发调优 - LINUX DO](https://linux.do/t/topic/1231037)  
> [【自己动手，丰衣足食 01】 写了个Gemini-MCP，因为我实在受不了Gemini CLI的"API Error: "，也让我看到了agents已来 - 开发调优 - LINUX DO](https://linux.do/t/topic/1211767)
---

**有问题怎么办？**

> Important
> 
> 请确保您的**claude code**版本在**v2.0.56**以上；**codex cli**版本在**v0.61.0**以上！

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png)[【自己动手，丰衣足食 02】人生苦短，我全都要，一个 CLAUDE.md 实现的三位一体协同办公](https://linux.do/t/topic/1231037/109)

> 按如下步骤排查问题，然后一一截图回复我来看看：
> 
> 1.  命令行输出`claude mcp list`查看是否安装成功
> 2.  命令行输出`codex exec --sandbox read-only --json -- '你是谁？'`查看是否codex命令行模式下是否可以正常运行
> 3.  换一个非根目录下的新项目，启动cc，开始聊天内测试，输入`使用两次连续的对话，测试codex mcp的连通性和多轮对话`；当仍旧有错误返回时，提醒cc`使用return_all_messages 查看具体错误`

---

**正文开始！**

简单来说， Claude和CodeX协同办公实在太香，但codex官方提供的mcp实在过于难用，那我只好自己来了，所以这个项目实现了以下几个事情：

1.  官方MCP由于有conversationId问题，**无法进行多轮对话**，那么OK，我来！
2.  官方MCP无法让claude**自由选择是否查看codex的推理详情**（比如工具调用也是在推理信息里），这点确实比较蛋疼，如果一些流水账式的思考和工具调用记录仍返回给cc，那也太浪费我的200k上下文了…所以OK，我来！
3.  为了解决1.中的问题，可以告知cc采用bash命令 `codex exec "YOUR_PROMPT" resume --last` 继续进行对话，但`--last`参数的存在造成**无法并行工作**，那么OK，我来！

[github.com](https://github.com/GuDaStudio/codexmcp)

![](https://linux.do/uploads/default/optimized/4X/4/2/5/4256abb902d38f0283ccefcae58256237ede9b70_2_690x344.png)

### [GitHub - GuDaStudio/codexmcp: Enable seamless collaboration between Claude Code...](https://github.com/GuDaStudio/codexmcp)

Enable seamless collaboration between Claude Code and Codex, transforming from a single agent to multiple agents for significantly enhanced productivity!

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png) 锦衣夜行孙大侠:

[](/t/topic/1147571/28 "转到引用的帖子")

> 如果cursor同环境下配置好了codex，可以直接加进去试一试 ![:tieba_091:](https://linux.do/uploads/default/original/3X/f/c/fcb760df48754f55cd9030370300880cddc30aeb.png?v=15 ":tieba_091:")
> 
> [![image](https://linux.do/uploads/default/optimized/4X/2/6/f/26f9e47d974868810cedfd663b8244b51862c618_2_690x445.png)
> 
> image1007×650 22.1 KB
> 
> ](https://linux.do/uploads/default/original/4X/2/6/f/26f9e47d974868810cedfd663b8244b51862c618.png "image")

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png) 锦衣夜行孙大侠:

[](/t/topic/1147571/202 "转到引用的帖子")

> 可以在settings.json里设置一下这个参数哈
> 
> [![image](https://linux.do/uploads/default/optimized/4X/f/a/d/fadbadeec27e5ec8ce2119e11fc360c9063cd9bb_2_690x498.png)
> 
> image1348×973 143 KB
> 
> ](https://linux.do/uploads/default/original/4X/f/a/d/fadbadeec27e5ec8ce2119e11fc360c9063cd9bb.png "image")

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png) 锦衣夜行孙大侠:

[](/t/topic/1147571/279 "转到引用的帖子")

> windows要在CMD里安装哈，powershell有bug

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png) 锦衣夜行孙大侠:

[](/t/topic/1147571/107 "转到引用的帖子")

> ### 2025/11/10 12:50
> 
> 更新Windows下codex编码问题，解决了空回问题。

![](https://linux.do/user_avatar/linux.do/daisun/48/733149_2.png) 锦衣夜行孙大侠:

[](/t/topic/1147571/131 "转到引用的帖子")

> ### 2025/11/10 18:45
> 
> 修复Windows下长文本命令解析问题

---

**前情提要：**[【求助】cc与codex协同办公之codex mcp不返回conversationId - 开发调优 - LINUX DO](https://linux.do/t/topic/1036474)。自从学会了claude和codex协同办公，我是腰也不疼了腿也不酸了，每次做实验就直接一个描述完需求、调到 `⏵⏵ accept edits on`，然后就相约好厚米瑞幸见了 ![:tieba_003:](https://linux.do/uploads/default/original/3X/2/7/27a55a1370c41f0736ba094bdc8866c6c2878c16.png?v=15 ":tieba_003:") 我日常的编程任务比较杂，基本覆盖了开发和算法，所以在开始前可以谈一谈自己的使用体验。

**我日常的观察：** codex确实十分擅长代码定位任务，即使你的描述只是一句“我的数据库怎么突然用不了了？？”，他也能精准定位到你刚写的屎山代码中造成逻辑错误的那几行。但问题是，codex压根不会说人话，这玩意输出的代码真的只能ai能看懂吧？？简直毫无可读性和维护性可言！ ![:bili_001:](https://linux.do/uploads/default/original/3X/4/7/47438f4f7b27b13d4ec57b37ec7b7dcf5217de69.png?v=15 ":bili_001:") 当然，与之相对的就是cc的懒和优美的代码风格。是的，cc确实不会一个个文件翻找，总要走一些投机取巧的路，比如用"git diff"等工具而非老实看代码，那这准确率和受限情况自然不言而喻。哦对了，不知道站内做算法的佬友多不多，我发现了一个神奇的事情是：**同样交给cc和codex同一个算法项目，cc的理解似乎更加高屋建瓴，总能抽象出更高维度的概念**，不知道是不是跟claude优秀的创意写作能力相关？

**百花齐放的必然趋势：** 结合我的日常体验，想必大伙也能体会到当下LLM在优势性上存在严重的归纳偏置（当然这完全有可能是训练集引发的），所以我跟身边好友达成的一个共识是：作为普通开发者，**一定要在同一需求上尝试不同的AI工具，这样才能让不确定性极高的AI群策群力，让花的钱真正反哺到个人效率提升上。**

**CodeX-MCP的使用方法非常简单：** 相信大多数佬友都已经安装并配置好cc和codex了，那么接下来我们只需移除官方 Codex MCP（如果已安装）：`claude mcp remove codex`，然后使用下面的命令，一键为cc配置即可（运行前请确认安装了uv [Installation | uv](https://docs.astral.sh/uv/getting-started/installation/)）：

```csharp
claude mcp add codex -s user --transport stdio -- uvx --from git+https://github.com/GuDaStudio/codexmcp.git codexmcp

```

配置完成后， 记得在 **终端** 中运行 `claude mcp list` 看看有没有安装成功哦~ ![:tieba_003:](https://linux.do/uploads/default/original/3X/2/7/27a55a1370c41f0736ba094bdc8866c6c2878c16.png?v=15 ":tieba_003:")

最后，我**极力推荐**把以下提示词放入 `~/.claude/CLAUDE.md`中，作为cc与codex协同的全局提示词使用：

```auto
## Core Instruction for CodeX MCP

在任何时刻，你必须思考当前过程可以如何与codex进行协作，如何调用Codex 为你提供的MCP工具作为你客观全面分析的保障。
其中你**务必执行**以下几个步骤：
**1** 在你对用户需求形成初步分析后，将用户需求、初始思路告知codex，并要求其完善需求分析和实施计划。
**2** 在实施具体编码任务前，**必须向codex索要代码实现原型（要求codex仅给出unified diff patch，严禁对代码做任何真实修改）**。在获取代码原型后，你**只能以此为逻辑参考，再次对代码修改进行重写**，形成企业生产级别、可读性极高、可维护性极高的代码后，才能实施具体编程修改任务。
**3** 无论何时，只要完成切实编码行为后，**必须立即使用codex review代码改动和对应需求完成程度**。
**4** codex只能给出参考，你**必须有自己的思考，甚至需要对codex的回答提出置疑**。尽信书则不如无书，你与codex的最终使命都是达成统一、全面、精准的意见，所以你们必须不断争辩已找到通向真理的唯一途径。

## Codex Tool Invocation Specification

 1. 工具概述

  codex MCP 提供了一个工具 `codex`，用于执行 AI 辅助的编码任务。该工具**通过 MCP 协议调用**，无需使用命令行。

  2. 工具参数

  **必选**参数：
  - PROMPT (string): 发送给 codex 的任务指令
  - cd (Path): codex 执行任务的工作目录根路径

  可选参数：
  - sandbox (string): 沙箱策略，可选值：
    - "read-only" (默认): 只读模式，最安全
    - "workspace-write": 允许在工作区写入
    - "danger-full-access": 完全访问权限
  - SESSION_ID (UUID | null): 用于继续之前的会话以与codex进行多轮交互，默认为 None（开启新会话）
  - skip_git_repo_check (boolean): 是否允许在非 Git 仓库中运行，默认 False
  - return_all_messages (boolean): 是否返回所有消息（包括推理、工具调用等），默认 False

  返回值：
  {
    "success": true,
    "SESSION_ID": "uuid-string",
    "agent_messages": "agent回复的文本内容",
    "all_messages": []  // 仅当 return_all_messages=True 时包含
  }
  或失败时：
  {
    "success": false,
    "error": "错误信息"
  }

  3. 使用方式

  开启新对话：
  - 不传 SESSION_ID 参数（或传 None）
  - 工具会返回新的 SESSION_ID 用于后续对话

  继续之前的对话：
  - 将之前返回的 SESSION_ID 作为参数传入
  - 同一会话的上下文会被保留

  4. 调用规范

  **必须遵守**：
  - 每次调用 codex 工具时，必须保存返回的 SESSION_ID，以便后续继续对话
  - cd 参数必须指向存在的目录，否则工具会静默失败
  - 严禁codex对代码进行实际修改，使用 sandbox="read-only" 以避免意外，并要求codex仅给出unified diff patch即可

  推荐用法：
  - 如需详细追踪 codex 的推理过程和工具调用，设置 return_all_messages=True
  - 对于精准定位、debug、代码原型快速编写等任务，优先使用 codex 工具

  5. 注意事项

  - 会话管理：始终追踪 SESSION_ID，避免会话混乱
  - 工作目录：确保 cd 参数指向正确且存在的目录
  - 错误处理：检查返回值的 success 字段，处理可能的错误

```

当然，**最关键最重要的一步**是，你有帮助我点击[那个诱人的star](https://github.com/GuDaStudio/codexmcp)嘛？~ ![:lark_171:](https://linux.do/uploads/default/original/3X/0/9/09e62c8a42a037debbc986a6ffcf4e5f22e0e153.png?v=15 ":lark_171:")