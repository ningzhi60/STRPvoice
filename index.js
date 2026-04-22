/**
 * VoiceRP - SillyTavern 语气朗读扩展
 *
 * 功能：识别角色对话（「」 / ""），在每句旁边添加朗读按钮。
 * 点击后用 ST 当前 API 分析情绪，再调用外部 TTS（ElevenLabs / fish.audio）朗读。
 */

import { extension_settings, getContext } from '../../../extensions.js';
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    generateQuietPrompt,
} from '../../../../script.js';

/* ───────────── 常量 ───────────── */

const EXT_NAME  = 'voice-rp';
const LOG_TAG   = '[VoiceRP]';

// 匹配「…」和 "…"（非贪婪，避免跨段匹配）
const DIALOGUE_REGEX = /(「[^」]+?」|"[^"]+?")/g;

const DEFAULT_SETTINGS = {
    enabled: true,

    // TTS 供应商: 'elevenlabs' | 'fish_audio' | 'browser'
    tts_provider: 'elevenlabs',

    // ElevenLabs
    el_api_key: '',
    el_voice_id: '',
    el_model_id: 'eleven_multilingual_v2',

    // fish.audio
    fish_api_key: '',
    fish_reference_id: '',

    // 情绪分析
    emotion_enabled: true,

    // 自动朗读新消息（仅角色消息）
    auto_speak: false,
};

// 情绪 → ElevenLabs voice_settings 映射
const EMOTION_EL_MAP = {
    cold:      { stability: 0.75, similarity_boost: 0.80, style: 0.15 },
    tired:     { stability: 0.80, similarity_boost: 0.70, style: 0.10 },
    gentle:    { stability: 0.55, similarity_boost: 0.80, style: 0.45 },
    angry:     { stability: 0.25, similarity_boost: 0.90, style: 0.85 },
    sad:       { stability: 0.70, similarity_boost: 0.75, style: 0.25 },
    tender:    { stability: 0.50, similarity_boost: 0.80, style: 0.50 },
    neutral:   { stability: 0.50, similarity_boost: 0.75, style: 0.30 },
    worried:   { stability: 0.40, similarity_boost: 0.80, style: 0.50 },
    stubborn:  { stability: 0.60, similarity_boost: 0.85, style: 0.35 },
    playful:   { stability: 0.35, similarity_boost: 0.70, style: 0.75 },
    sarcastic: { stability: 0.45, similarity_boost: 0.80, style: 0.60 },
    happy:     { stability: 0.35, similarity_boost: 0.75, style: 0.70 },
    fearful:   { stability: 0.30, similarity_boost: 0.80, style: 0.55 },
    seductive: { stability: 0.60, similarity_boost: 0.85, style: 0.65 },
};

const EMOTION_LABELS = {
    cold: '冷淡', tired: '疲惫', gentle: '温柔', angry: '愤怒',
    sad: '悲伤', tender: '心疼', neutral: '平静', worried: '担心',
    stubborn: '倔强', playful: '俏皮', sarcastic: '讽刺', happy: '开心',
    fearful: '恐惧', seductive: '魅惑',
};

const VALID_EMOTIONS = Object.keys(EMOTION_LABELS);

/* ───────────── 状态 ───────────── */

let currentAudio   = null;   // 当前播放的 Audio 对象
let playingBtnEl   = null;   // 当前高亮的按钮
let idCounter      = 0;      // 对话片段唯一 ID
let emotionCache   = {};     // { text: emotion } 缓存

/* ───────────── 设置 ───────────── */

function settings() {
    return extension_settings[EXT_NAME];
}

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    // 用默认值填充缺失项
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXT_NAME][k] === undefined) {
            extension_settings[EXT_NAME][k] = v;
        }
    }
}

function saveSettings() {
    saveSettingsDebounced();
}

/* ───────────── 设置面板 UI ───────────── */

function buildSettingsHtml() {
    return `
    <div id="vrp-settings" class="vrp-settings-panel">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>VoiceRP - 语气朗读</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <!-- 总开关 -->
                <div class="vrp-row">
                    <label class="checkbox_label">
                        <input type="checkbox" id="vrp_enabled" />
                        <span>启用 VoiceRP</span>
                    </label>
                </div>

                <hr class="vrp-hr" />

                <!-- TTS 供应商 -->
                <div class="vrp-row">
                    <label>TTS 供应商</label>
                    <select id="vrp_tts_provider">
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="fish_audio">fish.audio</option>
                        <option value="browser">浏览器内置 TTS</option>
                    </select>
                </div>

                <!-- ElevenLabs 设置 -->
                <div id="vrp_el_settings" class="vrp-provider-settings">
                    <div class="vrp-row">
                        <label>ElevenLabs API Key</label>
                        <input type="password" id="vrp_el_api_key" placeholder="xi-..." />
                    </div>
                    <div class="vrp-row">
                        <label>Voice ID</label>
                        <input type="text" id="vrp_el_voice_id" placeholder="voice ID" />
                        <small class="vrp-hint">在 ElevenLabs 控制台 → Voices 里复制</small>
                    </div>
                    <div class="vrp-row">
                        <label>Model</label>
                        <select id="vrp_el_model_id">
                            <option value="eleven_multilingual_v2">Multilingual v2</option>
                            <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                            <option value="eleven_turbo_v2">Turbo v2</option>
                        </select>
                    </div>
                </div>

                <!-- fish.audio 设置 -->
                <div id="vrp_fish_settings" class="vrp-provider-settings" style="display:none;">
                    <div class="vrp-row">
                        <label>fish.audio API Key</label>
                        <input type="password" id="vrp_fish_api_key" placeholder="sk-..." />
                    </div>
                    <div class="vrp-row">
                        <label>Reference ID (音色)</label>
                        <input type="text" id="vrp_fish_reference_id" placeholder="参考音色 ID" />
                        <small class="vrp-hint">在 fish.audio 音色广场复制</small>
                    </div>
                </div>

                <hr class="vrp-hr" />

                <!-- 情绪分析 -->
                <div class="vrp-row">
                    <label class="checkbox_label">
                        <input type="checkbox" id="vrp_emotion_enabled" />
                        <span>情绪分析（用当前 API 判断语气）</span>
                    </label>
                </div>

                <!-- 自动朗读 -->
                <div class="vrp-row">
                    <label class="checkbox_label">
                        <input type="checkbox" id="vrp_auto_speak" />
                        <span>自动朗读角色新消息的对话</span>
                    </label>
                </div>

                <!-- 测试按钮 -->
                <div class="vrp-row">
                    <button id="vrp_test_btn" class="menu_button">
                        <i class="fa-solid fa-volume-high"></i> 测试朗读
                    </button>
                </div>

            </div>
        </div>
    </div>`;
}

function initSettingsUI() {
    const html = buildSettingsHtml();
    $('#extensions_settings2').append(html);

    const s = settings();

    // 绑定值
    $('#vrp_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = this.checked;
        saveSettings();
        if (s.enabled) processAllMessages();
    });

    $('#vrp_tts_provider').val(s.tts_provider).on('change', function () {
        s.tts_provider = this.value;
        saveSettings();
        toggleProviderUI();
    });

    $('#vrp_el_api_key').val(s.el_api_key).on('input', function () {
        s.el_api_key = this.value.trim();
        saveSettings();
    });

    $('#vrp_el_voice_id').val(s.el_voice_id).on('input', function () {
        s.el_voice_id = this.value.trim();
        saveSettings();
    });

    $('#vrp_el_model_id').val(s.el_model_id).on('change', function () {
        s.el_model_id = this.value;
        saveSettings();
    });

    $('#vrp_fish_api_key').val(s.fish_api_key).on('input', function () {
        s.fish_api_key = this.value.trim();
        saveSettings();
    });

    $('#vrp_fish_reference_id').val(s.fish_reference_id).on('input', function () {
        s.fish_reference_id = this.value.trim();
        saveSettings();
    });

    $('#vrp_emotion_enabled').prop('checked', s.emotion_enabled).on('change', function () {
        s.emotion_enabled = this.checked;
        saveSettings();
    });

    $('#vrp_auto_speak').prop('checked', s.auto_speak).on('change', function () {
        s.auto_speak = this.checked;
        saveSettings();
    });

    $('#vrp_test_btn').on('click', () => testSpeak());

    toggleProviderUI();
}

function toggleProviderUI() {
    const provider = settings().tts_provider;
    $('#vrp_el_settings').toggle(provider === 'elevenlabs');
    $('#vrp_fish_settings').toggle(provider === 'fish_audio');
}

/* ───────────── 情绪分析 ───────────── */

async function analyzeEmotion(text) {
    if (!settings().emotion_enabled) return 'neutral';
    if (emotionCache[text]) return emotionCache[text];

    try {
        const prompt = [
            '分析以下角色对话的语气情绪，只回复一个英文单词。',
            `可选项：${VALID_EMOTIONS.join(', ')}`,
            '',
            `对话："${text}"`,
            '',
            '只回复一个英文单词，不要解释。',
        ].join('\n');

        const result = await generateQuietPrompt(prompt, false);
        const word = (result || '').trim().toLowerCase().replace(/[^a-z]/g, '');
        const emotion = VALID_EMOTIONS.includes(word) ? word : 'neutral';

        emotionCache[text] = emotion;
        console.log(LOG_TAG, `情绪分析: "${text.slice(0, 20)}..." → ${emotion} (${EMOTION_LABELS[emotion]})`);
        return emotion;
    } catch (err) {
        console.error(LOG_TAG, '情绪分析失败:', err);
        return 'neutral';
    }
}

/* ───────────── TTS 引擎 ───────────── */

function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio = null;
    }
    if (playingBtnEl) {
        playingBtnEl.classList.remove('vrp-playing');
        playingBtnEl = null;
    }
}

async function speakText(text, btnEl) {
    const s = settings();

    // 如果点击的是正在播放的按钮 → 停止
    if (playingBtnEl === btnEl && currentAudio) {
        stopCurrentAudio();
        return;
    }
    stopCurrentAudio();

    // 分析情绪
    const emotion = await analyzeEmotion(text);

    // 如果有情绪标签，显示在按钮旁
    if (btnEl && emotion !== 'neutral') {
        showEmotionTag(btnEl, emotion);
    }

    // 设置按钮播放状态
    if (btnEl) {
        btnEl.classList.add('vrp-playing');
        playingBtnEl = btnEl;
    }

    try {
        switch (s.tts_provider) {
            case 'elevenlabs':
                await speakElevenLabs(text, emotion);
                break;
            case 'fish_audio':
                await speakFishAudio(text, emotion);
                break;
            case 'browser':
                await speakBrowser(text, emotion);
                break;
        }
    } catch (err) {
        console.error(LOG_TAG, 'TTS 错误:', err);
        toastr.error(`朗读失败: ${err.message}`, 'VoiceRP');
    } finally {
        if (playingBtnEl === btnEl) {
            stopCurrentAudio();
        }
    }
}

/* --- ElevenLabs --- */

async function speakElevenLabs(text, emotion) {
    const s = settings();
    if (!s.el_api_key || !s.el_voice_id) {
        toastr.warning('请先在设置中填写 ElevenLabs API Key 和 Voice ID', 'VoiceRP');
        return;
    }

    const voiceSettings = EMOTION_EL_MAP[emotion] || EMOTION_EL_MAP.neutral;

    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${s.el_voice_id}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': s.el_api_key,
            },
            body: JSON.stringify({
                text: text,
                model_id: s.el_model_id,
                voice_settings: {
                    stability: voiceSettings.stability,
                    similarity_boost: voiceSettings.similarity_boost,
                    style: voiceSettings.style,
                    use_speaker_boost: true,
                },
            }),
        },
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`ElevenLabs API 错误 (${response.status}): ${err}`);
    }

    const blob = await response.blob();
    await playAudioBlob(blob);
}

/* --- fish.audio --- */

async function speakFishAudio(text, emotion) {
    const s = settings();
    if (!s.fish_api_key || !s.fish_reference_id) {
        toastr.warning('请先在设置中填写 fish.audio API Key 和 Reference ID', 'VoiceRP');
        return;
    }

    const response = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${s.fish_api_key}`,
        },
        body: JSON.stringify({
            text: text,
            reference_id: s.fish_reference_id,
            format: 'mp3',
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`fish.audio API 错误 (${response.status}): ${err}`);
    }

    const blob = await response.blob();
    await playAudioBlob(blob);
}

/* --- 浏览器内置 TTS（备用） --- */

function speakBrowser(text, emotion) {
    return new Promise((resolve, reject) => {
        if (!window.speechSynthesis) {
            reject(new Error('浏览器不支持 Speech Synthesis'));
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);

        // 根据情绪微调
        const pitchMap  = { cold: 0.85, tired: 0.8, angry: 1.3, sad: 0.75, happy: 1.15, playful: 1.15, sarcastic: 1.1 };
        const rateMap   = { cold: 0.8, tired: 0.7, angry: 1.1, sad: 0.7, happy: 1.05, playful: 1.0, sarcastic: 0.95 };
        utterance.pitch = pitchMap[emotion] || 1.0;
        utterance.rate  = rateMap[emotion]  || 0.9;

        // 尝试用中文声音
        const voices = window.speechSynthesis.getVoices();
        const zhVoice = voices.find(v => v.lang.startsWith('zh'));
        if (zhVoice) utterance.voice = zhVoice;

        utterance.onend   = resolve;
        utterance.onerror = (e) => reject(new Error(e.error));
        window.speechSynthesis.speak(utterance);
    });
}

/* --- 通用音频播放 --- */

function playAudioBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;

        audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
        };
        audio.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(new Error('音频播放失败'));
        };
        audio.play().catch(reject);
    });
}

/* ───────────── 消息处理 & DOM 注入 ───────────── */

/**
 * 从 .mes_text 的 HTML 中找出所有对话，包裹 span 并注入朗读按钮。
 * 只处理角色消息（is_user === false）。
 */
function processMessageElement(mesEl) {
    if (!settings().enabled) return;

    // 只处理角色消息
    const isUser = mesEl.getAttribute('is_user') === 'true';
    if (isUser) return;

    const mesText = mesEl.querySelector('.mes_text');
    if (!mesText || mesText.dataset.vrpProcessed === '1') return;

    let html = mesText.innerHTML;
    let hasMatch = false;

    html = html.replace(DIALOGUE_REGEX, (match) => {
        hasMatch = true;
        const rawText = stripQuotes(match);
        const uid = `vrp-${++idCounter}`;
        // 用 data 属性存储纯文本，按钮点击时读取
        const escaped = escapeAttr(rawText);
        return (
            `<span class="vrp-dialogue-wrap" data-vrp-uid="${uid}">` +
                `${match}` +
                `<button class="vrp-speak-btn" data-vrp-uid="${uid}" data-vrp-text="${escaped}" title="朗读这句">` +
                    `<i class="fa-solid fa-volume-high"></i>` +
                `</button>` +
            `</span>`
        );
    });

    if (hasMatch) {
        mesText.innerHTML = html;
    }
    mesText.dataset.vrpProcessed = '1';
}

function stripQuotes(s) {
    return s.replace(/^[「"]/,'').replace(/[」"]$/,'');
}

function escapeAttr(s) {
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showEmotionTag(btnEl, emotion) {
    // 移除旧标签
    const wrap = btnEl.closest('.vrp-dialogue-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.vrp-emotion-tag').forEach(el => el.remove());

    const tag = document.createElement('span');
    tag.className = 'vrp-emotion-tag';
    tag.textContent = EMOTION_LABELS[emotion] || emotion;
    tag.dataset.emotion = emotion;
    wrap.appendChild(tag);

    // 3 秒后淡出
    setTimeout(() => {
        tag.classList.add('vrp-fade-out');
        setTimeout(() => tag.remove(), 500);
    }, 3000);
}

/** 处理聊天区域中所有已有消息 */
function processAllMessages() {
    if (!settings().enabled) return;
    document.querySelectorAll('#chat .mes').forEach(processMessageElement);
}

/** 新消息到达时处理 + 可选自动朗读 */
async function onMessageReceived(messageIndex) {
    if (!settings().enabled) return;

    // 等待 DOM 渲染完成
    await new Promise(r => setTimeout(r, 300));

    const mesEl = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
    if (!mesEl) return;

    processMessageElement(mesEl);

    // 自动朗读：读取第一句对话
    if (settings().auto_speak) {
        const firstBtn = mesEl.querySelector('.vrp-speak-btn');
        if (firstBtn) {
            const text = firstBtn.dataset.vrpText;
            if (text) {
                await speakText(text, firstBtn);
            }
        }
    }
}

/* ───────────── 事件代理（按钮点击） ───────────── */

function initClickHandler() {
    $(document).on('click', '.vrp-speak-btn', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const text = this.dataset.vrpText;
        if (text) {
            speakText(text, this);
        }
    });
}

/* ───────────── 测试朗读 ───────────── */

async function testSpeak() {
    const testText = '你好，这是 VoiceRP 的语音测试。';
    toastr.info('正在测试朗读...', 'VoiceRP');
    try {
        await speakText(testText, null);
        toastr.success('测试完成！', 'VoiceRP');
    } catch (err) {
        toastr.error(`测试失败: ${err.message}`, 'VoiceRP');
    }
}

/* ───────────── 初始化 ───────────── */

jQuery(async () => {
    loadSettings();
    initSettingsUI();
    initClickHandler();

    // 监听事件
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        emotionCache = {};
        setTimeout(processAllMessages, 500);
    });

    // 用 MutationObserver 补漏（流式输出完成后可能需要重新处理）
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver((mutations) => {
            if (!settings().enabled) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && node.classList?.contains('mes')) {
                        setTimeout(() => processMessageElement(node), 200);
                    }
                }
            }
        });
        observer.observe(chatEl, { childList: true });
    }

    // 处理已有消息
    setTimeout(processAllMessages, 1000);

    console.log(LOG_TAG, '扩展已加载');
});
