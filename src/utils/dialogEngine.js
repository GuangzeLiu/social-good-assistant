// src/utils/dialogEngine.js
// Frontend-only dialog + retrieval engine for SG social services KB.
// Goals:
// 1) smarter retrieval (keywords + category + fuzzy-ish scoring)
// 2) guided follow-up questions (slot-like clarification)
// 3) escalation to human support when low confidence / complex / sensitive / urgent

import kb from "../data/sg_services_kb.json";

const DEFAULT_TOPK = 3;

const STOPWORDS = new Set([
  "the","a","an","to","for","and","or","of","in","on","at","is","are","am",
  "i","me","my","we","our","you","your","they","them","this","that",
  "need","help","please","can","could","want","looking","apply","get",
  "我","我们","你","你们","需要","想","申请","帮助","怎么","如何","有没有","可以","吗","要","找"
]);

const SYNONYMS = [
  // English -> canonical
  { re: /\b(financial aid|cash help|money help|bills? help|low income)\b/i, norm: "financial aid" },
  { re: /\b(housing grant|rental support|rent help|no place to stay|eviction)\b/i, norm: "housing" },
  { re: /\b(medical help|medical subsidy|clinic subsidy|hospital bill|medifund|chas)\b/i, norm: "medical" },
  { re: /\b(senior support|elderly|caregiver|home care)\b/i, norm: "senior care" },
  { re: /\b(disability|wheelchair|assistive|pwd)\b/i, norm: "disability" },
  { re: /\b(school fees|childcare|preschool|student care|kifas)\b/i, norm: "education" },
  { re: /\b(job|employment|training|upskill|skillsfuture)\b/i, norm: "employment" },
  { re: /\b(mental health|anxiety|depression|counselling|suicid)\b/i, norm: "mental" },
  { re: /\b(legal aid|lawyer|divorce|court)\b/i, norm: "legal" },

  // Chinese -> canonical
  { re: /(经济援助|现金补助|没钱|生活费|补贴)/, norm: "financial aid" },
  { re: /(住房|租房|租金补贴|被驱逐|驱逐通知|没地方住|无家可归)/, norm: "housing" },
  { re: /(看病|医疗|医药费|太贵|补贴|社工|医院账单)/, norm: "medical" },
  { re: /(长者|老人|照护|护理|照护者|看护)/, norm: "senior care" },
  { re: /(残障|残疾|轮椅|辅助器材|助听器)/, norm: "disability" },
  { re: /(学费|幼儿园|托儿|学生托管|课后照护)/, norm: "education" },
  { re: /(工作|就业|培训|技能|课程补贴)/, norm: "employment" },
  { re: /(心理|抑郁|焦虑|想不开|自杀|辅导)/, norm: "mental" },
  { re: /(法律援助|离婚|律师|法庭)/, norm: "legal" }
];

const SENSITIVE_TRIGGERS = [
  /\b(suicide|kill myself|self-harm)\b/i,
  /(自杀|轻生|想不开|伤害自己)/
];

const URGENT_TRIGGERS = [
  /\b(no place to stay today|sleeping outside|evicted|urgent|emergency)\b/i,
  /(今天没地方住|今晚没地方睡|紧急|急需|被赶出来|露宿)/
];

// --- helpers ---
function normalizeText(raw = "") {
  let t = raw.trim();
  for (const s of SYNONYMS) t = t.replace(s.re, s.norm);
  return t;
}

function tokenize(raw = "") {
  const t = normalizeText(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ");
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.filter(w => !STOPWORDS.has(w));
}

function containsAny(raw, regexList) {
  return regexList.some(re => re.test(raw));
}

function langPick(lang, en, zh) {
  return lang === "zh" ? (zh || en) : (en || zh);
}

function schemeTextForMatch(s) {
  // combine fields for scoring
  const all = [
    s.name_en, s.name_zh,
    s.summary_en, s.summary_zh,
    ...(s.keywords_en || []),
    ...(s.keywords_zh || []),
    ...(s.eligibility_en || []),
    ...(s.eligibility_zh || [])
  ].filter(Boolean).join(" ");
  return normalizeText(all).toLowerCase();
}

function scoreScheme(queryTokens, scheme, intentHint = null) {
  const hay = schemeTextForMatch(scheme);
  let score = 0;

  // token hits
  for (const tok of queryTokens) {
    if (hay.includes(tok)) score += 3;
  }

  // intent/category boost
  if (intentHint && scheme.category === intentHint) score += 6;

  // keyword exact boost
  for (const k of (scheme.keywords_en || [])) {
    const kk = normalizeText(k).toLowerCase();
    if (queryTokens.some(t => kk.includes(t) || t.includes(kk))) score += 2;
  }
  for (const k of (scheme.keywords_zh || [])) {
    const kk = normalizeText(k).toLowerCase();
    if (queryTokens.some(t => kk.includes(t) || t.includes(kk))) score += 2;
  }

  return score;
}

function detectIntent(raw) {
  const t = normalizeText(raw);
  // ordered: urgent housing > mental > financial > medical > etc.
  if (/housing/.test(t) || /eviction/.test(t)) return "housing_assistance";
  if (/mental/.test(t)) return "mental_health_support";
  if (/financial aid/.test(t) || /comcare/.test(t) || /assurance/.test(t) || /gstv/.test(t)) return "financial_assistance";
  if (/medical/.test(t) || /chas/.test(t) || /medifund/.test(t)) return "healthcare_support";
  if (/senior care/.test(t)) return "elderly_support";
  if (/disability/.test(t) || /pwd/.test(t)) return "disability_support";
  if (/education/.test(t) || /childcare/.test(t)) return "education_support";
  if (/employment/.test(t) || /skillsfuture/.test(t) || /job/.test(t)) return "employment_support";
  if (/legal/.test(t)) return "legal_support";
  return null;
}

function topSchemes(raw, lang, topK = DEFAULT_TOPK) {
  const tokens = tokenize(raw);
  const intent = detectIntent(raw);
  const scored = kb.schemes
    .map(s => ({ s, score: scoreScheme(tokens, s, intent) }))
    .sort((a, b) => b.score - a.score);

  const best = scored.slice(0, topK);
  const bestScore = best[0]?.score ?? 0;

  // confidence heuristic:
  // if top score too low, treat as low confidence
  const lowConfidence = bestScore < 6;

  return { intent, tokens, best: best.map(x => x.s), lowConfidence };
}

function formatSchemeCard(s, lang) {
  const name = langPick(lang, s.name_en, s.name_zh);
  const summary = langPick(lang, s.summary_en, s.summary_zh);
  const elig = langPick(lang, (s.eligibility_en || []).join(" "), (s.eligibility_zh || []).join(" "));
  const how = langPick(lang, (s.how_to_apply_en || []).join(" "), (s.how_to_apply_zh || []).join(" "));
  const links = (s.official_links || []).slice(0, 3);

  return {
    id: s.id,
    title: name,
    summary,
    eligibility: elig,
    how_to_apply: how,
    links
  };
}

function followUpQuestions(intent, lang) {
  // keep questions lightweight & non-invasive; avoid collecting sensitive personal data.
  const commonTail = lang === "zh"
    ? "你也可以直接输入另一个关键词（如：医疗 / 住房 / 教育 / 残障 / 法律）。"
    : "You can also type a new keyword (e.g., medical / housing / education / disability / legal).";

  switch (intent) {
    case "housing_assistance":
      return lang === "zh"
        ? [
            "你是“今天/今晚没地方住”这种紧急情况吗？（是/否）",
            "你更需要：临时安置（shelter）还是长期租房/租金支持？",
            commonTail
          ]
        : [
            "Is this urgent (no place to stay today/tonight)? (yes/no)",
            "Do you need temporary shelter or longer-term rental support?",
            commonTail
          ];
    case "financial_assistance":
      return lang === "zh"
        ? [
            "你主要想解决：生活费/食物、账单、还是短期现金周转？",
            "你是否已经联系过 SSO/ComCare？如果没有，我建议从那里开始。",
            commonTail
          ]
        : [
            "Which is your main need: daily expenses/food, bills, or short-term cash?",
            "Have you contacted SSO/ComCare? If not, that’s usually the best first step.",
            commonTail
          ];
    case "healthcare_support":
      return lang === "zh"
        ? [
            "你是想要：诊所/门诊补贴（如 CHAS）还是医院账单减免（可找医疗社工/MediFund）？",
            "你现在是在公立医院/诊所就诊吗？（不同路径会不一样）",
            commonTail
          ]
        : [
            "Do you need clinic/outpatient subsidies (e.g., CHAS) or help with a hospital bill (via Medical Social Worker/MediFund)?",
            "Are you receiving care at a public hospital/clinic? (The route may differ.)",
            commonTail
          ];
    case "elderly_support":
      return lang === "zh"
        ? [
            "你需要的是：现金补助、日常照护服务，还是照护者资源？",
            "是否需要我把 AIC 的‘照护服务入口’给你作为下一步？",
            commonTail
          ]
        : [
            "Do you need cash support, care services, or caregiver resources?",
            "Should I point you to AIC’s care services entry point as the next step?",
            commonTail
          ];
    case "mental_health_support":
      return lang === "zh"
        ? [
            "你是想要匿名倾诉/咨询，还是需要专业转介？",
            "如果你现在处于危险或有自伤想法，请立刻求助紧急服务或联系 1771。",
            commonTail
          ]
        : [
            "Are you looking for anonymous support, or professional referral?",
            "If you’re in immediate danger or thinking about self-harm, seek emergency help right now or contact 1771.",
            commonTail
          ];
    default:
      return lang === "zh"
        ? [
            "你更关心哪一类：经济援助 / 住房 / 医疗 / 长者 / 残障 / 教育 / 就业 / 法律？",
            commonTail
          ]
        : [
            "Which area is closest: financial / housing / medical / seniors / disability / education / employment / legal?",
            commonTail
          ];
  }
}

// Public API: one-step respond (stateless). You can add state later if you want multi-turn slots.
export function generateAssistantReply({ userText, lang = "en" }) {
  const raw = (userText || "").trim();
  if (!raw) {
    return {
      replyText: lang === "zh"
        ? "请输入一个关键词（例如：经济援助 / 住房补贴 / 医疗补助 / 长者照护）。"
        : 'Type a keyword (e.g., "financial aid", "housing grant", "medical help", "support for seniors").',
      cards: [],
      followUps: []
    };
  }

  // sensitive / urgent handling first
  const isSensitive = containsAny(raw, SENSITIVE_TRIGGERS);
  const isUrgent = containsAny(raw, URGENT_TRIGGERS);

  const { intent, best, lowConfidence } = topSchemes(raw, lang, DEFAULT_TOPK);

  // prepare cards
  const cards = best.map(s => formatSchemeCard(s, lang));

  // base response
  let replyText = "";
  if (isSensitive) {
    replyText = lang === "zh"
      ? "我可以先提供支持资源与下一步入口。若你现在有自伤/他伤风险或处在危险中，请立刻联系紧急服务（如 999）或拨打 national mindline 1771（24/7）。如果更合适，也建议尽快转人工社工/专业人员。"
      : "I can share support resources and next-step entry points. If you’re in immediate danger or at risk of self-harm, call emergency services (e.g., 999) or contact national mindline 1771 (24/7). You may also want to escalate to a human professional.";
    // force include mindline as an entry point card
    cards.unshift({
      id: "mindline_1771",
      title: lang === "zh" ? "national mindline 1771（24/7 心理支持）" : "national mindline 1771 (24/7 mental health support)",
      summary: lang === "zh" ? "24/7 心理支持热线/文字服务与网页聊天。" : "24/7 helpline/textline and webchat for mental health support.",
      eligibility: lang === "zh" ? "通常可直接使用。" : "Open access.",
      how_to_apply: lang === "zh" ? "拨打 1771 或使用 mindline.sg 网页聊天。" : "Call 1771 or use mindline.sg webchat.",
      links: ["https://www.mindline.sg/"]
    });
    return {
      replyText,
      cards,
      followUps: followUpQuestions("mental_health_support", lang),
      escalation: { recommended: true, reason: "sensitive" }
    };
  }

  if (isUrgent) {
    replyText = lang === "zh"
      ? "看起来情况比较紧急（例如今天/今晚没地方住）。建议你优先联系 SSO/ComCare（1800-222-0000）或通过 SupportGoWhere 查找最近的安置与支援入口。如果你愿意，你可以回复“是/否：今天没地方住”，我再把建议细化成更可执行的步骤。"
      : "This sounds urgent (e.g., no place to stay today/tonight). Consider contacting SSO/ComCare (1800-222-0000) or use SupportGoWhere to find nearby shelter/support. If you reply yes/no to ‘no place to stay today’, I can tailor the next steps.";
  } else if (lowConfidence) {
    replyText = lang === "zh"
      ? "我可能还不够确定你想找哪一类支持。你可以选一个方向：经济援助 / 住房 / 医疗 / 长者 / 残障 / 教育 / 就业 / 法律。也可以直接说一句更具体的需求（例如：‘我付不起医药费’）。"
      : "I’m not fully sure which area you need. Pick one: financial / housing / medical / seniors / disability / education / employment / legal — or describe your situation briefly (e.g., ‘I can’t afford medical bills’).";
  } else {
    replyText = lang === "zh"
      ? "根据你的关键词，我先给你最相关的几个官方支持方案（简化版步骤），你可以再回答下面的问题，我会继续把建议细化。"
      : "Based on your keywords, here are the most relevant official schemes (simplified steps). Answer the follow-up questions and I’ll refine the guidance further.";
  }

  // escalation suggestion when low confidence
  const escalation = lowConfidence
    ? { recommended: true, reason: "low_confidence", entryPoints: kb.entry_points }
    : { recommended: false };

  return {
    replyText,
    cards,
    followUps: followUpQuestions(intent, lang),
    escalation
  };
}
