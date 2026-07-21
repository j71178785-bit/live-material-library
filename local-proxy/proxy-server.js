/**
 * 本地 AI 代理服务器 — 素材库 AI 功能
 * 前端 → 本服务器 → 阿里云百练 DashScope API
 * API Key 存在 .env 文件中，前端看不到
 *
 * 启动方式：
 *   1. 把 API Key 填入 .env 文件
 *   2. node proxy-server.js
 *   3. 前端 AI 设置里填 http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// 读取 .env 文件
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        process.env[key] = value;
      }
    }
  }
}
loadEnv();

const PORT = 3000;
const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_NATIVE = "https://dashscope.aliyuncs.com/api/v1";

// CORS 头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调用阿里云百练 DashScope API（OpenAI 兼容模式）
 */
async function callDashScope(messages, apiKey, jsonMode = false) {
  const requestBody = {
    model: "qwen-plus",
    messages,
    temperature: 0.7,
  };

  if (jsonMode) {
    requestBody.response_format = { type: "json_object" };
  }

  const resp = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    let errMsg = `API 调用失败 (${resp.status})`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errMsg;
    } catch (e) {}
    throw new Error(errMsg);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";

  let parsed = null;
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?\n?/, "").replace(/```\s*$/, "");
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parsed = { rawResponse: content };
  }

  return { success: true, data: parsed, usage: data.usage || null };
}

/**
 * 功能1：分析素材内容
 */
async function analyzeContent(body, apiKey) {
  const { name, cat, note, transcript } = body;
  const catLabels = {
    live: "直播大场视频",
    scene: "直播场景",
    ref: "短视频对标",
    other: "其他素材",
  };

  const userContent = [
    transcript ? `【转写文本】\n${transcript}` : "",
    note ? `【备注】\n${note}` : "",
    name ? `【素材名称】${name}` : "",
  ].filter(Boolean).join("\n\n");

  if (!userContent.trim()) {
    return { error: "没有可分析的内容，请先填写备注或转写文本" };
  }

  const systemPrompt = `你是一位资深直播运营专家，擅长分析直播内容和短视频结构。
请对以下素材进行分析，返回 JSON 格式结果，包含：
1. summary：一句话总结素材核心内容（50字以内）
2. framework：如果是直播/视频内容，拆解出框架节奏（数组，每个元素含 phase 阶段名称 + detail 具体内容）
3. tags：推荐 3-5 个标签关键词

分类背景：该素材属于「${catLabels[cat] || "未分类"}」

只返回纯 JSON，不要 markdown 代码块标记。`;

  return await callDashScope(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    apiKey,
    true
  );
}

/**
 * 功能2：智能标签建议
 */
async function suggestTags(body, apiKey) {
  const { name, note, cat, transcript } = body;
  const content = [
    name ? `素材名称：${name}` : "",
    note ? `备注：${note}` : "",
    transcript ? `内容：${transcript.slice(0, 500)}` : "",
  ].filter(Boolean).join("\n");

  if (!content.trim()) {
    return { error: "没有可分析的内容" };
  }

  const systemPrompt = `你是一位直播运营素材管理助手。根据素材信息推荐 3-5 个简短标签（每个2-4个字）。
只返回 JSON：{"tags": ["标签1", "标签2", ...]}
不要 markdown 标记，不要解释。`;

  return await callDashScope(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    apiKey,
    true
  );
}

/**
 * 功能3：框架节奏拆解
 */
async function breakdownFramework(body, apiKey) {
  const { transcript, name, note } = body;

  if (!transcript || transcript.trim().length < 20) {
    return { error: "转写文本太短，无法分析框架。请先获取或粘贴更完整的内容。" };
  }

  const systemPrompt = `你是一位直播节奏分析专家。请对以下直播/视频内容进行框架节奏拆解。

分析维度：
1. 整体结构（开头引流 → 产品介绍 → 信任建立 → 逼单转化 → 互动留存 等）
2. 每个阶段的时间占比和大致内容
3. 关键话术和技巧点
4. 改进建议

返回 JSON 格式：
{
  "structure": "整体结构描述（1-2句）",
  "phases": [{"phase": "阶段名", "content": "具体内容", "technique": "使用的技巧"}],
  "keyPoints": ["关键话术1", "关键话术2", ...],
  "suggestions": ["改进建议1", "改进建议2"]
}

只返回纯 JSON，不要 markdown 代码块。`;

  const userContent = `素材：${name || "未命名"}\n${note ? "备注：" + note + "\n" : ""}\n【转写内容】\n${transcript}`;

  return await callDashScope(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    apiKey,
    true
  );
}

/**
 * 功能4：语音转写（视频/音频 → 文字）
 * 使用 DashScope Paraformer-v2 语音识别 API
 *
 * 流程：base64 音频 → 上传 DashScope → 提交转写任务 → 轮询结果 → 返回文字
 */
async function transcribeAudio(body, apiKey) {
  const { audioBase64, format = "wav" } = body;

  if (!audioBase64) {
    return { error: "没有音频数据" };
  }

  // base64 → Buffer
  const audioBuffer = Buffer.from(audioBase64, "base64");
  console.log(`  [转写] 收到音频: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB, 格式: ${format}`);

  // Step 1: 上传音频文件到 DashScope
  console.log("  [转写] Step 1: 上传音频文件...");
  const blob = new Blob([audioBuffer], { type: `audio/${format}` });
  const formData = new FormData();
  formData.append("file", blob, `audio.${format}`);
  formData.append("purpose", "file-extract");

  const uploadResp = await fetch(`${DASHSCOPE_NATIVE}/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    console.error("  [转写] 上传失败:", uploadResp.status, errText);
    throw new Error(`音频上传失败 (${uploadResp.status}): ${errText.slice(0, 200)}`);
  }

  const uploadData = await uploadResp.json();
  const fileUrl = uploadData.data?.url;

  if (!fileUrl) {
    console.error("  [转写] 上传返回异常:", JSON.stringify(uploadData));
    throw new Error("音频上传成功但未返回文件 URL: " + JSON.stringify(uploadData).slice(0, 300));
  }

  console.log("  [转写] 上传成功, URL:", fileUrl.slice(0, 80) + "...");

  // Step 2: 提交 Paraformer-v2 转写任务
  console.log("  [转写] Step 2: 提交转写任务...");
  const taskResp = await fetch(`${DASHSCOPE_NATIVE}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: "paraformer-v2",
      input: {
        file_urls: [fileUrl],
      },
      parameters: {
        language_hints: ["zh", "en"],
      },
    }),
  });

  if (!taskResp.ok) {
    const errText = await taskResp.text();
    console.error("  [转写] 提交任务失败:", taskResp.status, errText);
    throw new Error(`创建转写任务失败 (${taskResp.status}): ${errText.slice(0, 200)}`);
  }

  const taskData = await taskResp.json();
  const taskId = taskData.output?.task_id;

  if (!taskId) {
    console.error("  [转写] 任务创建异常:", JSON.stringify(taskData));
    throw new Error("转写任务创建失败: " + JSON.stringify(taskData).slice(0, 300));
  }

  console.log("  [转写] 任务已创建, ID:", taskId);

  // Step 3: 轮询任务状态（最多等待 3 分钟）
  console.log("  [转写] Step 3: 等待转写完成...");
  for (let i = 0; i < 60; i++) {
    await sleep(3000); // 每 3 秒查询一次

    const pollResp = await fetch(`${DASHSCOPE_NATIVE}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollResp.ok) {
      console.error("  [转写] 轮询失败:", pollResp.status);
      continue;
    }

    const pollData = await pollResp.json();
    const status = pollData.output?.task_status;
    console.log(`  [转写] 轮询 #${i + 1}: ${status}`);

    if (status === "SUCCEEDED") {
      // Step 4: 获取转写结果
      const transcriptionUrl = pollData.output?.results?.[0]?.transcription_url;
      if (!transcriptionUrl) {
        throw new Error("转写成功但未返回结果 URL");
      }

      console.log("  [转写] Step 4: 获取转写结果...");
      const transcriptResp = await fetch(transcriptionUrl);
      const transcriptData = await transcriptResp.json();

      // Paraformer 返回格式: { transcripts: [{ text: "...", sentences: [...] }] }
      const text = transcriptData.transcripts?.[0]?.text || "";

      if (!text) {
        throw new Error("转写结果为空");
      }

      console.log(`  [转写] 完成! 文字长度: ${text.length}`);
      return { success: true, transcript: text };
    } else if (status === "FAILED") {
      const errMsg = pollData.output?.message || "转写任务失败";
      throw new Error("转写失败: " + errMsg);
    }
    // PENDING / RUNNING → 继续等待
  }

  throw new Error("转写超时（等待超过 3 分钟）");
}

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    // GET 健康检查
    if (req.method === "GET") {
      const apiKey = process.env.AI_API_KEY;
      sendJson(res, {
        status: "ok",
        service: "material-ai-proxy",
        apiKeyConfigured: !!apiKey,
      });
      return;
    }
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    sendJson(res, { error: "AI_API_KEY 未配置，请在 .env 文件中设置" }, 500);
    return;
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const parsed = JSON.parse(body);
    const { action } = parsed;

    let result;
    switch (action) {
      case "ping":
        result = { status: "ok", message: "material-ai-proxy" };
        break;
      case "analyze":
        result = await analyzeContent(parsed, apiKey);
        break;
      case "suggest-tags":
        result = await suggestTags(parsed, apiKey);
        break;
      case "breakdown":
        result = await breakdownFramework(parsed, apiKey);
        break;
      case "transcribe":
        result = await transcribeAudio(parsed, apiKey);
        break;
      default:
        sendJson(res, { error: "未知操作: " + action }, 400);
        return;
    }

    sendJson(res, result);
  } catch (err) {
    console.error("  [错误]", err.message);
    sendJson(res, { error: err.message || "服务器内部错误" }, 500);
  }
});

// 增加超时时间到 5 分钟（转写可能需要较长时间）
server.timeout = 300000;
server.keepAliveTimeout = 300000;

server.listen(PORT, () => {
  const apiKey = process.env.AI_API_KEY;
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  AI 代理服务器已启动                          │`);
  console.log(`  │  地址: http://localhost:${PORT}                  │`);
  console.log(`  │  API Key: ${apiKey ? "已配置 ✓" : "未配置 ✗ (请编辑 .env)"}            │`);
  console.log(`  │  功能: 文字分析 / 标签推荐 / 语音转写          │`);
  console.log(`  └─────────────────────────────────────────────┘`);
  console.log(`\n  按 Ctrl+C 停止服务器\n`);
});
