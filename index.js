/**
 * VoiceRP - SillyTavern 语气朗读扩展
 * 支持 TTS：MiniMax / ElevenLabs / fish.audio / 浏览器内置
 * 支持自定义对话符号抓取
 * 双按钮：重听缓存 + 重新生成
 */

import { extension_settings, getContext } from '../../../extensions.js';
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    generateQuietPrompt,
} from '../../../../script.js';

const EXT_NAME = 'voice-rp';
const LOG_TAG = '[VoiceRP]';

const DEFAULT_SETTINGS = {
    enabled: true,
    tts_provider: 'minimax',
    mm_api_key: '',
    mm_group_id: '',
    mm_voice_id: '',
    mm_model: 'speech-02-hd',
    el_api_key: '',
    el_voice_id: '',
    el_model_id: 'eleven_multilingual_v2',
    fish_api_key: '',
    fish_reference_id: '',
    emotion_enabled: true,
    auto_speak: false,
    quote_pairs: '\u300c,\u300d\n\u201c,\u201d\n","\n\u300e,\u300f',
};

const DEFAULT_QUOTE_PAIRS = [
    ['\u300c', '\u300d'],
    ['\u201c', '\u201d'],
    ['"', '"'],
    ['\u300e', '\u300f'],
];

const EMOTION_TO_MM = {
    cold:'neutral', tired:'sad', gentle:'neutral', angry:'angry',
    sad:'sad', tender:'neutral', neutral:'neutral', worried:'fearful',
    stubborn:'angry', playful:'happy', sarcastic:'disgusted', happy:'happy',
    fearful:'fearful', seductive:'neutral',
};

const EMOTION_EL_MAP = {
    cold:{stability:0.75,similarity_boost:0.80,style:0.15},
    tired:{stability:0.80,similarity_boost:0.70,style:0.10},
    gentle:{stability:0.55,similarity_boost:0.80,style:0.45},
    angry:{stability:0.25,similarity_boost:0.90,style:0.85},
    sad:{stability:0.70,similarity_boost:0.75,style:0.25},
    tender:{stability:0.50,similarity_boost:0.80,style:0.50},
    neutral:{stability:0.50,similarity_boost:0.75,style:0.30},
    worried:{stability:0.40,similarity_boost:0.80,style:0.50},
    stubborn:{stability:0.60,similarity_boost:0.85,style:0.35},
    playful:{stability:0.35,similarity_boost:0.70,style:0.75},
    sarcastic:{stability:0.45,similarity_boost:0.80,style:0.60},
    happy:{stability:0.35,similarity_boost:0.75,style:0.70},
    fearful:{stability:0.30,similarity_boost:0.80,style:0.55},
    seductive:{stability:0.60,similarity_boost:0.85,style:0.65},
};

const EMOTION_LABELS = {
    cold:'\u51b7\u6de1',tired:'\u75b2\u60eb',gentle:'\u6e29\u67d4',angry:'\u6124\u6012',
    sad:'\u60b2\u4f24',tender:'\u5fc3\u75bc',neutral:'\u5e73\u9759',worried:'\u62c5\u5fc3',
    stubborn:'\u5014\u5f3a',playful:'\u4fcf\u76ae',sarcastic:'\u8bbd\u523a',happy:'\u5f00\u5fc3',
    fearful:'\u6050\u60e7',seductive:'\u9b45\u60d1',
};

const VALID_EMOTIONS = Object.keys(EMOTION_LABELS);

let currentAudio = null;
let playingBtnEl = null;
let isProcessing = false;
let idCounter = 0;
let emotionCache = {};
let audioCache = {};  // uid -> Blob 缓存已生成的音频

function settings() { return extension_settings[EXT_NAME]; }

function loadSettings() {
    if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXT_NAME][k] === undefined) extension_settings[EXT_NAME][k] = v;
    }
}

function saveSettings() { saveSettingsDebounced(); }

function parseQuotePairs() {
    const raw = settings().quote_pairs || '';
    const pairs = [];
    for (const line of raw.split('\n').map(l => l.trim()).filter(Boolean)) {
        const parts = line.split(/[,\uff0c]/).map(s => s.trim()).filter(Boolean);
        if (parts.length === 2) pairs.push([parts[0], parts[1]]);
    }
    return pairs.length > 0 ? pairs : DEFAULT_QUOTE_PAIRS;
}

function buildDialogueRegex() {
    const pairs = parseQuotePairs();
    const patterns = pairs.map(([o, c]) => {
        const oe = escapeRegex(o), ce = escapeRegex(c);
        return oe + '[^' + ce + ']+?' + ce;
    });
    return new RegExp('(' + patterns.join('|') + ')', 'g');
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function stripQuotes(s) {
    for (const [o, c] of parseQuotePairs()) {
        if (s.startsWith(o) && s.endsWith(c)) return s.slice(o.length, -c.length);
    }
    return s;
}

/* ---- Settings UI ---- */

function buildSettingsHtml() {
    return `
    <div id="vrp-settings" class="vrp-settings-panel">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>VoiceRP - \u8bed\u6c14\u6717\u8bfb</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="vrp-row">
                    <label class="checkbox_label"><input type="checkbox" id="vrp_enabled" /><span>\u542f\u7528 VoiceRP</span></label>
                </div>
                <hr class="vrp-hr" />
                <div class="vrp-row">
                    <label>\u5bf9\u8bdd\u62d3\u53d6\u7b26\u53f7\uff08\u6bcf\u884c\u4e00\u5bf9\uff0c\u9017\u53f7\u5206\u9694\u5de6\u53f3\uff09</label>
                    <textarea id="vrp_quote_pairs" rows="4" class="vrp-textarea"></textarea>
                    <small class="vrp-hint">\u4f8b: \u300c,\u300d \u8868\u793a\u62d3\u53d6 \u300c\u5bf9\u8bdd\u300d\u3002\u6bcf\u884c\u4e00\u5bf9\u3002\u4fee\u6539\u540e\u70b9\u201c\u91cd\u65b0\u626b\u63cf\u201d\u5237\u65b0\u65e7\u6d88\u606f</small>
                    <button id="vrp_rescan_btn" class="menu_button vrp-small-btn"><i class="fa-solid fa-rotate"></i> \u91cd\u65b0\u626b\u63cf\u6240\u6709\u6d88\u606f</button>
                </div>
                <hr class="vrp-hr" />
                <div class="vrp-row">
                    <label>TTS \u4f9b\u5e94\u5546</label>
                    <select id="vrp_tts_provider">
                        <option value="minimax">MiniMax</option>
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="fish_audio">fish.audio</option>
                        <option value="browser">\u6d4f\u89c8\u5668\u5185\u7f6e TTS</option>
                    </select>
                </div>
                <div id="vrp_mm_settings" class="vrp-provider-settings">
                    <div class="vrp-row"><label>MiniMax API Key</label><input type="text" id="vrp_mm_api_key" placeholder="sk-api-..." /></div>
                    <div class="vrp-row"><label>Group ID</label><input type="text" id="vrp_mm_group_id" placeholder="17xxxxxxxx" /><small class="vrp-hint">MiniMax \u5f00\u653e\u5e73\u53f0 \u2192 \u8d26\u6237\u7ba1\u7406</small></div>
                    <div class="vrp-row"><label>Voice ID\uff08\u514b\u9686\u58f0\u97f3 / \u9884\u8bbe\u58f0\u97f3\uff09</label><input type="text" id="vrp_mm_voice_id" placeholder="CustomVoice123 \u6216 male-qn-qingse" /></div>
                    <div class="vrp-row"><label>\u6a21\u578b</label><select id="vrp_mm_model">
                        <option value="speech-02-hd">speech-02-hd\uff08\u63a8\u8350\uff09</option>
                        <option value="speech-02-turbo">speech-02-turbo\uff08\u5feb\u901f\uff09</option>
                        <option value="speech-2.6-hd">speech-2.6-hd</option>
                        <option value="speech-2.6-turbo">speech-2.6-turbo</option>
                        <option value="speech-2.8-hd">speech-2.8-hd\uff08\u6700\u65b0\uff09</option>
                        <option value="speech-2.8-turbo">speech-2.8-turbo</option>
                    </select></div>
                </div>
                <div id="vrp_el_settings" class="vrp-provider-settings" style="display:none;">
                    <div class="vrp-row"><label>ElevenLabs API Key</label><input type="text" id="vrp_el_api_key" placeholder="xi-..." /></div>
                    <div class="vrp-row"><label>Voice ID</label><input type="text" id="vrp_el_voice_id" placeholder="voice ID" /></div>
                    <div class="vrp-row"><label>Model</label><select id="vrp_el_model_id">
                        <option value="eleven_multilingual_v2">Multilingual v2</option>
                        <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                        <option value="eleven_turbo_v2">Turbo v2</option>
                    </select></div>
                </div>
                <div id="vrp_fish_settings" class="vrp-provider-settings" style="display:none;">
                    <div class="vrp-row"><label>fish.audio API Key</label><input type="text" id="vrp_fish_api_key" placeholder="sk-..." /></div>
                    <div class="vrp-row"><label>Reference ID (\u97f3\u8272)</label><input type="text" id="vrp_fish_reference_id" placeholder="\u53c2\u8003\u97f3\u8272 ID" /></div>
                </div>
                <hr class="vrp-hr" />
                <div class="vrp-row"><label class="checkbox_label"><input type="checkbox" id="vrp_emotion_enabled" /><span>\u60c5\u7eea\u5206\u6790\uff08\u7528\u5f53\u524d API \u5224\u65ad\u8bed\u6c14\uff09</span></label></div>
                <div class="vrp-row"><label class="checkbox_label"><input type="checkbox" id="vrp_auto_speak" /><span>\u81ea\u52a8\u6717\u8bfb\u89d2\u8272\u65b0\u6d88\u606f\u7684\u5bf9\u8bdd</span></label></div>
                <div class="vrp-row"><button id="vrp_test_btn" class="menu_button"><i class="fa-solid fa-volume-high"></i> \u6d4b\u8bd5\u6717\u8bfb</button></div>
            </div>
        </div>
    </div>`;
}

function initSettingsUI() {
    $('#extensions_settings2').append(buildSettingsHtml());
    const s = settings();

    $('#vrp_enabled').prop('checked', s.enabled).on('change', function(){ s.enabled=this.checked; saveSettings(); if(s.enabled) processAllMessages(); });
    $('#vrp_quote_pairs').val(s.quote_pairs).on('input', function(){ s.quote_pairs=this.value; saveSettings(); });

    $('#vrp_rescan_btn').on('click', () => {
        document.querySelectorAll('#chat .mes .mes_text').forEach(el => {
            delete el.dataset.vrpProcessed;
            el.querySelectorAll('.vrp-speak-btn, .vrp-regen-btn, .vrp-emotion-tag').forEach(n => n.remove());
            el.querySelectorAll('.vrp-dialogue-wrap').forEach(w => w.replaceWith(...w.childNodes));
        });
        audioCache = {};
        processAllMessages();
        toastr.success('\u5df2\u91cd\u65b0\u626b\u63cf\u6240\u6709\u6d88\u606f', 'VoiceRP');
    });

    $('#vrp_tts_provider').val(s.tts_provider).on('change', function(){ s.tts_provider=this.value; saveSettings(); toggleProviderUI(); });

    $('#vrp_mm_api_key').val(s.mm_api_key).on('input', function(){ s.mm_api_key=this.value.trim(); saveSettings(); });
    $('#vrp_mm_group_id').val(s.mm_group_id).on('input', function(){ s.mm_group_id=this.value.trim(); saveSettings(); });
    $('#vrp_mm_voice_id').val(s.mm_voice_id).on('input', function(){ s.mm_voice_id=this.value.trim(); saveSettings(); });
    $('#vrp_mm_model').val(s.mm_model).on('change', function(){ s.mm_model=this.value; saveSettings(); });

    $('#vrp_el_api_key').val(s.el_api_key).on('input', function(){ s.el_api_key=this.value.trim(); saveSettings(); });
    $('#vrp_el_voice_id').val(s.el_voice_id).on('input', function(){ s.el_voice_id=this.value.trim(); saveSettings(); });
    $('#vrp_el_model_id').val(s.el_model_id).on('change', function(){ s.el_model_id=this.value; saveSettings(); });

    $('#vrp_fish_api_key').val(s.fish_api_key).on('input', function(){ s.fish_api_key=this.value.trim(); saveSettings(); });
    $('#vrp_fish_reference_id').val(s.fish_reference_id).on('input', function(){ s.fish_reference_id=this.value.trim(); saveSettings(); });

    $('#vrp_emotion_enabled').prop('checked', s.emotion_enabled).on('change', function(){ s.emotion_enabled=this.checked; saveSettings(); });
    $('#vrp_auto_speak').prop('checked', s.auto_speak).on('change', function(){ s.auto_speak=this.checked; saveSettings(); });
    $('#vrp_test_btn').on('click', () => testSpeak());

    toggleProviderUI();
}

function toggleProviderUI() {
    const p = settings().tts_provider;
    $('#vrp_mm_settings').toggle(p === 'minimax');
    $('#vrp_el_settings').toggle(p === 'elevenlabs');
    $('#vrp_fish_settings').toggle(p === 'fish_audio');
}

/* ---- Emotion Analysis ---- */

async function analyzeEmotion(text) {
    if (!settings().emotion_enabled) return 'neutral';
    if (emotionCache[text]) return emotionCache[text];
    try {
        const prompt = '\u5206\u6790\u4ee5\u4e0b\u89d2\u8272\u5bf9\u8bdd\u7684\u8bed\u6c14\u60c5\u7eea\uff0c\u53ea\u56de\u590d\u4e00\u4e2a\u82f1\u6587\u5355\u8bcd\u3002\n\u53ef\u9009\u9879\uff1a' + VALID_EMOTIONS.join(', ') + '\n\n\u5bf9\u8bdd\uff1a\u201c' + text + '\u201d\n\n\u53ea\u56de\u590d\u4e00\u4e2a\u82f1\u6587\u5355\u8bcd\uff0c\u4e0d\u8981\u89e3\u91ca\u3002';
        const result = await generateQuietPrompt(prompt, false);
        const word = (result || '').trim().toLowerCase().replace(/[^a-z]/g, '');
        const emotion = VALID_EMOTIONS.includes(word) ? word : 'neutral';
        emotionCache[text] = emotion;
        console.log(LOG_TAG, 'Emotion:', text.slice(0, 20), '->', emotion);
        return emotion;
    } catch (err) {
        console.error(LOG_TAG, 'Emotion analysis failed:', err);
        return 'neutral';
    }
}

/* ---- TTS Engines ---- */

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
    isProcessing = false;
}

/**
 * 生成语音（调用 API），结果缓存到 audioCache
 */
async function generateAndSpeak(text, uid, btnEl) {
    if (isProcessing) return;
    stopCurrentAudio();
    isProcessing = true;

    if (btnEl) { btnEl.classList.add('vrp-playing'); playingBtnEl = btnEl; }

    try {
        const emotion = await analyzeEmotion(text);
        if (btnEl && emotion !== 'neutral') showEmotionTag(btnEl, emotion);

        const blob = await generateTTSBlob(text, emotion);

        // 缓存音频
        if (uid) {
            audioCache[uid] = blob;
            // 显示重新生成按钮
            showRegenButton(uid);
        }

        await playAudioBlob(blob);
    } catch (err) {
        console.error(LOG_TAG, 'TTS error:', err);
        toastr.error('\u6717\u8bfb\u5931\u8d25: ' + err.message, 'VoiceRP');
    } finally {
        isProcessing = false;
        if (btnEl) btnEl.classList.remove('vrp-playing');
        if (playingBtnEl === btnEl) playingBtnEl = null;
    }
}

/**
 * 重听缓存的音频（不调用 API）
 */
async function replayAudio(uid, btnEl) {
    if (!audioCache[uid]) {
        // 没有缓存，当作首次生成
        const text = btnEl ? btnEl.dataset.vrpText : null;
        if (text) return generateAndSpeak(text, uid, btnEl);
        return;
    }

    // 如果正在播放，点击停止
    if (playingBtnEl === btnEl && currentAudio && !currentAudio.paused) {
        stopCurrentAudio();
        return;
    }

    stopCurrentAudio();
    if (btnEl) { btnEl.classList.add('vrp-playing'); playingBtnEl = btnEl; }

    try {
        await playAudioBlob(audioCache[uid]);
    } catch (err) {
        console.error(LOG_TAG, 'Replay error:', err);
    } finally {
        if (btnEl) btnEl.classList.remove('vrp-playing');
        if (playingBtnEl === btnEl) playingBtnEl = null;
    }
}

/**
 * 调用 TTS API 返回 Blob（不播放）
 */
async function generateTTSBlob(text, emotion) {
    const s = settings();
    if (s.tts_provider === 'minimax') return await genMiniMax(text, emotion);
    else if (s.tts_provider === 'elevenlabs') return await genElevenLabs(text, emotion);
    else if (s.tts_provider === 'fish_audio') return await genFishAudio(text, emotion);
    else return await genBrowser(text, emotion);
}

async function genMiniMax(text, emotion) {
    const s = settings();
    if (!s.mm_api_key) throw new Error('\u8bf7\u586b\u5199 MiniMax API Key');
    if (!s.mm_voice_id) throw new Error('\u8bf7\u586b\u5199 MiniMax Voice ID');

    const mmEmotion = EMOTION_TO_MM[emotion] || 'neutral';
    const body = {
        model: s.mm_model,
        text: text,
        voice_setting: { voice_id: s.mm_voice_id, speed: 1.0, vol: 1.0, pitch: 0, emotion: mmEmotion },
        audio_sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
    };

    let url = 'https://api.minimaxi.com/v1/t2a_v2';
    if (s.mm_group_id) url = 'https://api.minimaxi.com/v1/t2a_v2?GroupId=' + s.mm_group_id;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.mm_api_key },
        body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error('MiniMax API ' + resp.status + ': ' + await resp.text());
    const data = await resp.json();
    if (data.base_resp && data.base_resp.status_code !== 0) throw new Error('MiniMax: ' + data.base_resp.status_msg);

    const audioHex = data.data && data.data.audio;
    if (!audioHex) throw new Error('MiniMax \u672a\u8fd4\u56de\u97f3\u9891');

    const bytes = new Uint8Array(audioHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    return new Blob([bytes], { type: 'audio/mpeg' });
}

async function genElevenLabs(text, emotion) {
    const s = settings();
    if (!s.el_api_key || !s.el_voice_id) throw new Error('\u8bf7\u586b\u5199 ElevenLabs API Key \u548c Voice ID');
    const vs = EMOTION_EL_MAP[emotion] || EMOTION_EL_MAP.neutral;
    const resp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + s.el_voice_id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': s.el_api_key },
        body: JSON.stringify({ text, model_id: s.el_model_id, voice_settings: { stability: vs.stability, similarity_boost: vs.similarity_boost, style: vs.style, use_speaker_boost: true } }),
    });
    if (!resp.ok) throw new Error('ElevenLabs ' + resp.status + ': ' + await resp.text());
    return await resp.blob();
}

async function genFishAudio(text, emotion) {
    const s = settings();
    if (!s.fish_api_key || !s.fish_reference_id) throw new Error('\u8bf7\u586b\u5199 fish.audio API Key \u548c Reference ID');
    const resp = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.fish_api_key },
        body: JSON.stringify({ text, reference_id: s.fish_reference_id, format: 'mp3' }),
    });
    if (!resp.ok) throw new Error('fish.audio ' + resp.status + ': ' + await resp.text());
    return await resp.blob();
}

function genBrowser(text, emotion) {
    // 浏览器 TTS 没有 blob，返回一个特殊标记
    return new Promise((resolve, reject) => {
        if (!window.speechSynthesis) { reject(new Error('Browser TTS not supported')); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const pm = { cold:0.85,tired:0.8,angry:1.3,sad:0.75,happy:1.15,playful:1.15,sarcastic:1.1 };
        const rm = { cold:0.8,tired:0.7,angry:1.1,sad:0.7,happy:1.05,playful:1.0,sarcastic:0.95 };
        u.pitch = pm[emotion] || 1.0;
        u.rate = rm[emotion] || 0.9;
        const v = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('zh'));
        if (v) u.voice = v;
        u.onend = () => resolve(new Blob([], { type: 'audio/browser-tts' }));
        u.onerror = (e) => reject(new Error(e.error));
        window.speechSynthesis.speak(u);
    });
}

function playAudioBlob(blob) {
    // 浏览器 TTS 的特殊 blob 不需要播放
    if (blob.type === 'audio/browser-tts') return Promise.resolve();

    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio playback failed')); };
        audio.play().catch(reject);
    });
}

/* ---- Message Processing ---- */

function processMessageElement(mesEl) {
    if (!settings().enabled) return;
    if (mesEl.getAttribute('is_user') === 'true') return;
    const mesText = mesEl.querySelector('.mes_text');
    if (!mesText || mesText.dataset.vrpProcessed === '1') return;

    const regex = buildDialogueRegex();
    let html = mesText.innerHTML;
    let hasMatch = false;

    html = html.replace(regex, (match) => {
        hasMatch = true;
        const raw = stripQuotes(match);
        const uid = 'vrp-' + (++idCounter);
        const esc = escapeAttr(raw);
        return '<span class="vrp-dialogue-wrap" data-vrp-uid="' + uid + '">' +
            match +
            '<span class="vrp-btn-group">' +
                '<button class="vrp-speak-btn" data-vrp-uid="' + uid + '" data-vrp-text="' + esc + '" title="\u6717\u8bfb / \u91cd\u542c">' +
                    '<i class="fa-solid fa-volume-high"></i>' +
                '</button>' +
                '<button class="vrp-regen-btn vrp-hidden" data-vrp-uid="' + uid + '" data-vrp-text="' + esc + '" title="\u91cd\u65b0\u751f\u6210\uff08\u6d88\u8017\u989d\u5ea6\uff09">' +
                    '<i class="fa-solid fa-rotate"></i>' +
                '</button>' +
            '</span>' +
            '</span>';
    });

    if (hasMatch) mesText.innerHTML = html;
    mesText.dataset.vrpProcessed = '1';
}

/** 首次生成成功后，显示重新生成按钮 */
function showRegenButton(uid) {
    const regenBtn = document.querySelector('.vrp-regen-btn[data-vrp-uid="' + uid + '"]');
    if (regenBtn) regenBtn.classList.remove('vrp-hidden');
}

function showEmotionTag(btnEl, emotion) {
    const wrap = btnEl.closest('.vrp-dialogue-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.vrp-emotion-tag').forEach(el => el.remove());
    const tag = document.createElement('span');
    tag.className = 'vrp-emotion-tag';
    tag.textContent = EMOTION_LABELS[emotion] || emotion;
    tag.dataset.emotion = emotion;
    wrap.appendChild(tag);
    setTimeout(() => { tag.classList.add('vrp-fade-out'); setTimeout(() => tag.remove(), 500); }, 3000);
}

function processAllMessages() {
    if (!settings().enabled) return;
    document.querySelectorAll('#chat .mes').forEach(processMessageElement);
}

async function onMessageReceived(messageIndex) {
    if (!settings().enabled) return;
    await new Promise(r => setTimeout(r, 300));
    const mesEl = document.querySelector('#chat .mes[mesid="' + messageIndex + '"]');
    if (!mesEl) return;
    processMessageElement(mesEl);
    if (settings().auto_speak) {
        const btn = mesEl.querySelector('.vrp-speak-btn');
        if (btn && btn.dataset.vrpText) {
            await generateAndSpeak(btn.dataset.vrpText, btn.dataset.vrpUid, btn);
        }
    }
}

/* ---- Click Handlers ---- */

function initClickHandler() {
    // 喇叭按钮：首次=生成+播放，之后=重听缓存
    $(document).on('click', '.vrp-speak-btn', function(e) {
        e.preventDefault(); e.stopPropagation();
        const uid = this.dataset.vrpUid;
        const text = this.dataset.vrpText;
        if (!text) return;

        if (audioCache[uid]) {
            // 有缓存 -> 重听
            replayAudio(uid, this);
        } else {
            // 无缓存 -> 首次生成
            generateAndSpeak(text, uid, this);
        }
    });

    // 刷新按钮：重新生成（清除缓存，重新调 API）
    $(document).on('click', '.vrp-regen-btn', function(e) {
        e.preventDefault(); e.stopPropagation();
        const uid = this.dataset.vrpUid;
        const text = this.dataset.vrpText;
        if (!text) return;

        // 清除这句的缓存和情绪缓存
        delete audioCache[uid];
        delete emotionCache[text];

        // 找到对应的喇叭按钮来显示播放状态
        const speakBtn = document.querySelector('.vrp-speak-btn[data-vrp-uid="' + uid + '"]');
        generateAndSpeak(text, uid, speakBtn || this);
    });
}

async function testSpeak() {
    toastr.info('\u6b63\u5728\u6d4b\u8bd5\u6717\u8bfb...', 'VoiceRP');
    try {
        const blob = await generateTTSBlob('\u4f60\u597d\uff0c\u8fd9\u662fVoiceRP\u7684\u8bed\u97f3\u6d4b\u8bd5\u3002', 'neutral');
        await playAudioBlob(blob);
        toastr.success('\u6d4b\u8bd5\u5b8c\u6210\uff01', 'VoiceRP');
    }
    catch (err) { toastr.error('\u6d4b\u8bd5\u5931\u8d25: ' + err.message, 'VoiceRP'); }
}

/* ---- Toggle Button ---- */

function initToggleButton() {
    const toggleBtn = $('<div id="vrp_toggle_btn" class="vrp-toggle-btn list-group-item flex-container flexGap5" title="VoiceRP"><i class="fa-solid fa-volume-high"></i></div>');
    if ($('#data_bank_wand_container').length) $('#data_bank_wand_container').after(toggleBtn);
    else if ($('#rightSendForm').length) $('#rightSendForm').prepend(toggleBtn);
    else if ($('#send_form').length) $('#send_form').prepend(toggleBtn);

    updateToggleBtnState();
    toggleBtn.on('click', () => {
        const s = settings();
        s.enabled = !s.enabled; saveSettings();
        $('#vrp_enabled').prop('checked', s.enabled);
        updateToggleBtnState();
        if (s.enabled) { processAllMessages(); toastr.success('VoiceRP \u5df2\u5f00\u542f', 'VoiceRP', {timeOut:1500}); }
        else { hideAllSpeakButtons(); stopCurrentAudio(); toastr.info('VoiceRP \u5df2\u5173\u95ed', 'VoiceRP', {timeOut:1500}); }
    });
}

function updateToggleBtnState() {
    const btn = $('#vrp_toggle_btn');
    if (!btn.length) return;
    const on = settings().enabled;
    btn.toggleClass('vrp-toggle-active', on);
    btn.attr('title', on ? 'VoiceRP ON' : 'VoiceRP OFF');
    btn.find('i').attr('class', on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark');
}

function hideAllSpeakButtons() { document.querySelectorAll('.vrp-speak-btn, .vrp-regen-btn').forEach(b => b.style.display='none'); }
function showAllSpeakButtons() { document.querySelectorAll('.vrp-speak-btn').forEach(b => b.style.display=''); }

/* ---- Init ---- */

jQuery(async () => {
    loadSettings();
    initSettingsUI();
    initClickHandler();
    initToggleButton();

    $('#vrp_enabled').on('change', function() {
        updateToggleBtnState();
        if (!this.checked) { hideAllSpeakButtons(); stopCurrentAudio(); }
        else { showAllSpeakButtons(); processAllMessages(); }
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, () => { emotionCache = {}; audioCache = {}; setTimeout(processAllMessages, 500); });

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        new MutationObserver((muts) => {
            if (!settings().enabled) return;
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType === 1 && n.classList && n.classList.contains('mes')) setTimeout(() => processMessageElement(n), 200);
            }
        }).observe(chatEl, { childList: true });
    }

    setTimeout(processAllMessages, 1000);
    console.log(LOG_TAG, 'Extension loaded');
});
