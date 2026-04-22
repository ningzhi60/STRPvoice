# VoiceRP - SillyTavern 语气朗读扩展

在角色扮演对话中，自动识别角色台词（「对话」和 "dialogue"），为每句话添加朗读按钮 🔊。

点击按钮后，会先用当前连接的 AI 分析语气情绪，再通过 TTS 以对应的情感语调朗读出来。

## ✨ 功能

- **对话识别**：自动识别 `「…」` 和 `"…"` 中的台词
- **情绪分析**：利用 ST 当前连接的 API 判断语气（冷淡/温柔/愤怒/悲伤等 14 种）
- **情感朗读**：根据情绪动态调整 TTS 参数（语调、稳定性、表现力）
- **多 TTS 支持**：ElevenLabs / fish.audio / 浏览器内置 TTS
- **自动朗读**：可选开启，角色每条新消息自动朗读第一句对话
- **只读角色**：只处理角色消息，玩家（user）消息不会出现按钮

## 📦 安装

### 方法一：手动安装

1. 将整个 `ST-VoiceRP` 文件夹复制到：
   ```
   SillyTavern/public/scripts/extensions/third-party/ST-VoiceRP/
   ```
2. 重启 SillyTavern
3. 在 Extensions 面板中找到 **VoiceRP - 语气朗读**

### 方法二：通过 Git

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone <仓库地址> ST-VoiceRP
```

## ⚙️ 配置

安装后，在 ST 的 **Extensions** 面板展开 **VoiceRP - 语气朗读**：

### TTS 供应商

#### ElevenLabs（推荐）
1. 在 [ElevenLabs](https://elevenlabs.io) 注册账号
2. 获取 API Key（Profile → API Keys）
3. 选择或创建一个声音，复制 Voice ID
4. 填入设置面板
5. 推荐使用 **Multilingual v2** 模型（中文效果最好）

#### fish.audio
1. 在 [fish.audio](https://fish.audio) 注册账号
2. 获取 API Key
3. 在音色广场选一个喜欢的声音，复制 Reference ID
4. 填入设置面板

#### 浏览器内置 TTS（备用）
- 免费，无需配置
- 效果有限，情绪表达主要靠音调和语速变化

### 情绪分析

开启后，每次点击朗读按钮会先调用 ST 当前连接的 AI（比如 Claude、GPT 等）分析这句话的情绪，然后根据结果调整朗读参数。

支持的情绪类型：

| 情绪 | 英文 | TTS 表现 |
|------|------|---------|
| 冷淡 | cold | 高稳定性、低表现力 |
| 疲惫 | tired | 高稳定性、低语调 |
| 温柔 | gentle | 中等稳定性、柔和 |
| 愤怒 | angry | 低稳定性、高表现力 |
| 悲伤 | sad | 高稳定性、低语调 |
| 心疼 | tender | 中等、温暖 |
| 平静 | neutral | 默认参数 |
| 担心 | worried | 稍不稳定 |
| 倔强 | stubborn | 中高稳定性 |
| 俏皮 | playful | 低稳定性、高表现力 |
| 讽刺 | sarcastic | 中等稳定性、高表现力 |
| 开心 | happy | 低稳定性、活泼 |
| 恐惧 | fearful | 低稳定性 |
| 魅惑 | seductive | 中高稳定性、高表现力 |

## 🎮 使用

1. 正常和角色 RP 聊天
2. 角色回复中，所有 `「对话」` 和 `"dialogue"` 旁边会出现一个小喇叭图标
3. 点击小喇叭 → AI 分析语气 → TTS 朗读
4. 再次点击可停止播放
5. 情绪标签会短暂显示在对话旁边

## ❓ FAQ

**Q: 为什么旁白文字（星号内的描写）没有朗读按钮？**
A: 设计如此。旁白/叙述部分不是角色说出来的话，只有引号内的台词才会添加按钮。

**Q: ElevenLabs 免费额度够用吗？**
A: ElevenLabs 免费账户每月有 10,000 字符额度，RP 对话通常够用。付费方案额度更多。

**Q: 情绪分析会消耗 API token 吗？**
A: 会，每次朗读会发一个很短的分析请求。如果不想消耗 token，可以在设置中关闭情绪分析。

**Q: 支持英文 RP 吗？**
A: 支持。英文双引号 `"..."` 也会被识别。TTS 语音取决于你选择的声音。
