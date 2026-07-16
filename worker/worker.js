/**
 * Cloudflare Worker — 素材库 AI 代理
 * 前端 → 本 Worker → 阿里云百练 DashScope API
 * API Key 存在环境变量 AI_API_KEY 中，前端看不到
 */

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// CORS 头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    // 处理 CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const apiKey = env.AI_API_KEY;
    if (!apiKey) {
      return json({ error: "AI_API_KEY 未配置，请在 Cloudflare 设置环境变量" }, 500);
    }

    try {
      const body = await request.json();
      const { action } = body;

      let result;

      switch (action) {
        case "analyze":
          result = await analyzeContent(body, apiKey);
          break;
        case "suggest-tags":
          result = await suggestTags(body, apiKey);
          break;
        case "breakdown":
          result = await breakdownFramework(body, apiKey);
          break;
        default:
          return json({ error: "未知操作: " + action }, 400);
      }

      return json(result);
    } catch (err) {
      return json({ error: err.message || "服务器内部错误" }, 500);
    }
  },
};

/**
 * 功能1：分析素材内容 — 给出内容摘要 + 结构化框架拆解
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

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  return await callDashScope(messages, apiKey, true);
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

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ];

  return await callDashScope(messages, apiKey, true);
}

/**
 * 功能3：框架节奏拆解 — 专门分析直播/视频的节奏结构
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

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  return await callDashScope(messages, apiKey, true);
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
    } catch (e) {
      // 非 JSON 错误
    }
    throw new Error(errMsg);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 尝试解析 JSON
  let parsed = null;
  try {
    // 清理可能的 markdown 代码块标记
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?\n?/, "").replace(/```\s*$/, "");
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // 返回原始文本
    parsed = { rawResponse: content };
  }

  return { success: true, data: parsed, usage: data.usage || null };
}
