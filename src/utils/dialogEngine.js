// src/utils/dialogEngine.js
// A small, deterministic dialog state machine for the SG Social Good Assistant.
// Plan A: remove duplicated bottom "topic" chips; use step-dependent Quick Replies.
//
// Design goals
// - One clear flow: choose domain -> choose focus (eligibility / steps / overview) -> refine query -> show schemes
// - Always offer: Back to topics / Restart
// - Global urgent & sensitive handling (entry points first)
//
// NOTE: This is frontend-only. It does NOT make network calls.

import kb from "../data/sg_services_kb.json";

const DEFAULT_TOPK = 3;

const STOPWORDS = new Set([
  "the","a","an","to","for","and","or","of","in","on","at","is","are","am",
  "i","me","my","we","our","you","your","they","them","this","that",
  "need","help","please","can","could","want","looking","apply","get",
  "我","我们","你","你们","需要","想","申请","帮助","怎么","如何","有没有","可以","吗","要","找","想要","一下"
]);

const SYNONYMS = [
  // English -> canonical
  { re: /\b(financial aid|cash help|money help|bills? help|low income)\b/i, norm: "financial aid" },
  { re: /\b(housing grant|rental support|rent help|no place to stay|eviction|homeless)\b/i, norm: "housing" },
  { re: /\b(medical help|medical subsidy|clinic subsidy|hospital bill|medifund|chas)\b/i, norm: "medical" },
  { re: /\b(senior support|elderly|caregiver|home care)\b/i, norm: "seniors" },
  { re: /\b(disability|wheelchair|assistive|pwd)\b/i, norm: "disability" },
  { re: /\b(school fees|childcare|preschool|student care|kifas)\b/i, norm: "education" },
  { re: /\b(job|employment|training|upskill|skillsfuture)\b/i, norm: "employment" },
  { re: /\b(mental health|anxiety|depression|counselling|suicid)\b/i, norm: "mental health" },
  { re: /\b(legal aid|lawyer|divorce|court)\b/i, norm: "legal" },

  // Chinese -> canonical
  { re: /(经济援助|现金补助|没钱|生活费|补贴|发放)/, norm: "financial aid" },
  { re: /(住房|租房|租金补贴|被驱逐|驱逐通知|没地方住|无家可归|收容)/, norm: "housing" },
  { re: /(看病|医疗|医药费|太贵|诊所|医院账单|社工)/, norm: "medical" },
  { re: /(长者|老人|照护|护理|照护者|看护)/, norm: "seniors" },
  { re: /(残障|残疾|轮椅|辅助器材|助听器)/, norm: "disability" },
  { re: /(学费|幼儿园|托儿|学生托管|课后照护)/, norm: "education" },
  { re: /(工作|就业|培训|技能|课程补贴)/, norm: "employment" },
  { re: /(心理|抑郁|焦虑|想不开|自杀|辅导)/, norm: "mental health" },
  { re: /(法律援助|离婚|律师|法庭)/, norm: "legal" }
];

const SENSITIVE_TRIGGERS = [
  /\b(suicide|kill myself|self-harm)\b/i,
  /(自杀|轻生|想不开|伤害自己)/
];

const URGENT_TRIGGERS = [
  /\b(no place to stay today|sleeping outside|evicted today|urgent|emergency)\b/i,
  /(今天没地方住|今晚没地方睡|紧急|急需|被赶出来|露宿|马上需要)/
];

const DOMAIN = [
  { id: "financial",  cat: "financial_assistance",  en: "Financial",     zh: "经济援助" },
  { id: "housing",    cat: "housing_assistance",    en: "Housing",       zh: "住房" },
  { id: "healthcare", cat: "healthcare_support",    en: "Healthcare",    zh: "医疗" },
  { id: "seniors",    cat: "elderly_support",       en: "Seniors",       zh: "长者支持" },
  { id: "disability", cat: "disability_support",    en: "Disability",    zh: "残障支持" },
  { id: "legal",      cat: "legal_support",         en: "Legal",         zh: "法律援助" },
  { id: "mental",     cat: "mental_health_support", en: "Mental health", zh: "心理支持" }
];

function langPick(lang, en, zh) {
  return lang === "zh" ? (zh || en) : (en || zh);
}

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

function domainById(id) {
  return DOMAIN.find(d => d.id === id) || null;
}

function detectDomainIdFromText(raw) {
  const t = normalizeText(raw).toLowerCase();
  if (/\bfinancial aid\b/.test(t) || /\bcomcare\b/.test(t) || /assurance|gstv|cdc vouchers/.test(t)) return "financial";
  if (/\bhousing\b/.test(t) || /eviction|homeless|rental/.test(t)) return "housing";
  if (/\bmedical\b/.test(t) || /chas|medifund|medisave|medishield/.test(t)) return "healthcare";
  if (/\bseniors\b/.test(t) || /elderly|caregiver|silver support|aic/.test(t)) return "seniors";
  if (/\bdisability\b/.test(t) || /pwd|sgenable|assistive/.test(t)) return "disability";
  if (/\blegal\b/.test(t) || /lab|lawyer|divorce|court/.test(t)) return "legal";
  if (/\bmental health\b/.test(t) || /anxiety|depression|mindline/.test(t)) return "mental";
  return null;
}

function schemeTextForMatch(s) {
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

function scoreScheme(queryTokens, scheme, categoryBoost = null) {
  const hay = schemeTextForMatch(scheme);
  let score = 0;

  for (const tok of queryTokens) {
    if (hay.includes(tok)) score += 3;
  }
  if (categoryBoost && scheme.category === categoryBoost) score += 8;

  const nameHay = normalizeText(`${scheme.name_en || ""} ${scheme.name_zh || ""}`).toLowerCase();
  for (const tok of queryTokens) {
    if (nameHay.includes(tok)) score += 2;
  }
  return score;
}

function retrieveSchemes({ query, domainId, topK = DEFAULT_TOPK }) {
  const d = domainById(domainId);
  const tokens = tokenize(query);
  const scored = kb.schemes
      .map(s => ({ s, score: scoreScheme(tokens, s, d?.cat || null) }))
      .sort((a, b) => b.score - a.score);

  const best = scored.filter(x => x.score > 0).slice(0, topK).map(x => x.s);
  const bestScore = scored[0]?.score ?? 0;
  const lowConfidence = bestScore < 6;

  return { best, lowConfidence, tokens };
}

function formatScheme(s, lang, focus = "overview") {
  const title = langPick(lang, s.name_en, s.name_zh);
  const summary = langPick(lang, s.summary_en, s.summary_zh);
  const eligibility = lang === "zh" ? (s.eligibility_zh || []) : (s.eligibility_en || []);
  const steps = lang === "zh" ? (s.how_to_apply_zh || []) : (s.how_to_apply_en || []);
  const links = (s.official_links || []).slice(0, 3);

  return {
    id: s.id,
    title,
    summary,
    eligibility,
    steps,
    links,
    focus
  };
}

function entryPointsCards(lang) {
  return (kb.entry_points || []).map(ep => ({
    id: ep.id,
    title: langPick(lang, ep.name_en, ep.name_zh),
    summary: "",
    eligibility: [],
    steps: [],
    links: ep.links || [],
    contacts: ep.contacts || null,
    focus: "entry"
  }));
}

function makeQuickReplies(items) {
  return items.map((it, idx) => ({
    id: it.id || `${idx}`,
    label: it.label,
    sendText: it.sendText || it.label,
    action: it.action
  }));
}

function baseNavQuickReplies(lang) {
  return makeQuickReplies([
    { id: "back_topics", label: lang === "zh" ? "返回主题" : "Back to topics", action: { type: "BACK_TOPICS" } },
    { id: "restart", label: lang === "zh" ? "重新开始" : "Restart", action: { type: "RESTART" } }
  ]);
}

function topicQuickReplies(lang) {
  const topics = DOMAIN.map(d => ({
    id: `topic_${d.id}`,
    label: langPick(lang, d.en, d.zh),
    action: { type: "SET_DOMAIN", domainId: d.id }
  }));
  topics.push({
    id: "urgent",
    label: lang === "zh" ? "我现在很紧急" : "This is urgent",
    action: { type: "URGENT" }
  });
  return makeQuickReplies(topics);
}

function focusQuickReplies(lang) {
  return makeQuickReplies([
    { id: "overview", label: lang === "zh" ? "先看概览" : "Overview", action: { type: "SET_FOCUS", focus: "overview" } },
    { id: "eligibility", label: lang === "zh" ? "我想看资格" : "Eligibility", action: { type: "SET_FOCUS", focus: "eligibility" } },
    { id: "steps", label: lang === "zh" ? "我想看申请步骤" : "How to apply", action: { type: "SET_FOCUS", focus: "steps" } },
    ...baseNavQuickReplies(lang)
  ]);
}

function domainPresets(domainId, lang) {
  const zh = lang === "zh";
  switch (domainId) {
    case "financial":
      return makeQuickReplies([
        { id: "daily", label: zh ? "日常生活费/食物" : "Daily expenses / food", action: { type: "ADD_QUERY", text: zh ? "生活费 食物" : "daily expenses food" } },
        { id: "bills", label: zh ? "账单/水电费" : "Bills / utilities", action: { type: "ADD_QUERY", text: zh ? "账单 水电费" : "bills utilities" } },
        { id: "rent", label: zh ? "租金压力" : "Rent problems", action: { type: "ADD_QUERY", text: zh ? "租金" : "rent" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "housing":
      return makeQuickReplies([
        { id: "no_place", label: zh ? "今天没地方住" : "No place to stay today", action: { type: "URGENT" } },
        { id: "rental", label: zh ? "公共租赁/租房" : "Public rental / renting", action: { type: "ADD_QUERY", text: zh ? "公共租赁 租房" : "public rental" } },
        { id: "temp", label: zh ? "过渡/临时安置" : "Temporary shelter", action: { type: "ADD_QUERY", text: zh ? "临时安置 shelter" : "temporary shelter" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "healthcare":
      return makeQuickReplies([
        { id: "clinic", label: zh ? "诊所/门诊补贴" : "Clinic/outpatient subsidy", action: { type: "ADD_QUERY", text: zh ? "CHAS 门诊 诊所" : "CHAS clinic outpatient" } },
        { id: "hospital", label: zh ? "医院账单付不起" : "Can't afford hospital bill", action: { type: "ADD_QUERY", text: zh ? "医院账单 付不起 MediFund" : "hospital bill MediFund" } },
        { id: "insurance", label: zh ? "保险/保费" : "Insurance / premiums", action: { type: "ADD_QUERY", text: zh ? "MediShield Life 保费" : "MediShield Life premiums" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "seniors":
      return makeQuickReplies([
        { id: "cash", label: zh ? "现金补助" : "Cash support", action: { type: "ADD_QUERY", text: zh ? "现金补助 Silver Support" : "cash support Silver Support" } },
        { id: "care", label: zh ? "照护服务" : "Care services", action: { type: "ADD_QUERY", text: zh ? "照护服务 AIC" : "care services AIC" } },
        { id: "caregiver", label: zh ? "照护者资源" : "Caregiver support", action: { type: "ADD_QUERY", text: zh ? "照护者 支持" : "caregiver support" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "disability":
      return makeQuickReplies([
        { id: "assistive", label: zh ? "辅助器材补贴" : "Assistive tech subsidy", action: { type: "ADD_QUERY", text: zh ? "辅助器材 ATF" : "assistive technology fund ATF" } },
        { id: "jobs", label: zh ? "就业支持" : "Employment support", action: { type: "ADD_QUERY", text: zh ? "残障 就业" : "disability employment" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "legal":
      return makeQuickReplies([
        { id: "legal_aid", label: zh ? "法律援助申请" : "Apply for legal aid", action: { type: "ADD_QUERY", text: zh ? "法律援助 LAB" : "legal aid LAB" } },
        { id: "family", label: zh ? "家庭/离婚" : "Family/divorce", action: { type: "ADD_QUERY", text: zh ? "离婚 家庭" : "divorce family law" } },
        ...baseNavQuickReplies(lang)
      ]);
    case "mental":
      return makeQuickReplies([
        { id: "talk", label: zh ? "想找人聊聊" : "I need someone to talk to", action: { type: "ADD_QUERY", text: zh ? "心理支持 倾诉" : "mental health support talk" } },
        { id: "urgent_mental", label: zh ? "我很危险/想伤害自己" : "I'm in danger / self-harm thoughts", action: { type: "SENSITIVE" } },
        ...baseNavQuickReplies(lang)
      ]);
    default:
      return baseNavQuickReplies(lang);
  }
}

// ----------------- Public API -----------------
export function initDialogState(lang = "en") {
  return {
    lang,
    step: "choose_domain",  // choose_domain -> choose_focus -> refine_and_show
    domainId: null,
    focus: "overview",      // overview | eligibility | steps
    lastQuery: "",
    topK: DEFAULT_TOPK
  };
}

export function getInitialAssistantMessage(lang = "en") {
  const text = lang === "zh"
      ? "你好！我可以帮你从官方渠道快速找到合适的社会服务。你现在最需要哪一类帮助？"
      : "Hi! I can help you find the right official support quickly. What kind of help do you need?";
  return {
    role: "assistant",
    text,
    cards: [],
    quickReplies: topicQuickReplies(lang)
  };
}

function buildResultsMessage({ lang, domainId, focus, query, topK }) {
  const zh = lang === "zh";
  const domain = domainById(domainId);
  const { best, lowConfidence } = retrieveSchemes({ query, domainId, topK });

  if (!best.length) {
    return {
      role: "assistant",
      text: zh
          ? "我没在知识库里匹配到非常具体的项目。你可以先从这些官方入口开始（可转介/查询），也可以换一种描述再试一次。"
          : "I couldn’t match a specific scheme in the KB. Start from these official entry points (they can refer you), or rephrase and try again.",
      cards: entryPointsCards(lang),
      quickReplies: makeQuickReplies([
        { id: "rephrase", label: zh ? "我换种说法" : "I'll rephrase", action: { type: "NOOP" } },
        ...baseNavQuickReplies(lang)
      ])
    };
  }

  const intro = lowConfidence
      ? (zh
          ? `我先给你几个“可能相关”的官方项目（基于：${langPick(lang, domain?.en, domain?.zh)}）。如果不对，你可以点“返回主题”重新选。`
          : `Here are a few *possibly relevant* official schemes (based on: ${langPick(lang, domain?.en, domain?.zh)}). If this isn’t right, tap “Back to topics”.`)
      : (zh
          ? `我找到最相关的官方项目（${langPick(lang, domain?.en, domain?.zh)}）。你想先看“资格”还是“申请步骤”？`
          : `I found the most relevant official schemes (${langPick(lang, domain?.en, domain?.zh)}). Do you want “Eligibility” or “How to apply” first?`);

  const cards = best.map(s => formatScheme(s, lang, focus));

  const focusChips = makeQuickReplies([
    { id: "overview", label: zh ? "概览" : "Overview", action: { type: "SET_FOCUS", focus: "overview" } },
    { id: "eligibility", label: zh ? "资格" : "Eligibility", action: { type: "SET_FOCUS", focus: "eligibility" } },
    { id: "steps", label: zh ? "步骤" : "Steps", action: { type: "SET_FOCUS", focus: "steps" } },
    { id: "more", label: zh ? "更多结果" : "More results", action: { type: "MORE_RESULTS" } },
    ...baseNavQuickReplies(lang)
  ]);

  return {
    role: "assistant",
    text: intro,
    cards,
    quickReplies: focusChips
  };
}

function urgentMessage(lang = "en") {
  const zh = lang === "zh";
  const text = zh
      ? "明白。如果你现在处在紧急情况，我先给你最直接的官方入口（可转介/联系）。如果你愿意，也可以继续选择一个主题，我再把建议细化成“下一步怎么做”。"
      : "Got it. If this is urgent, here are the official entry points you can contact first. If you’d like, pick a topic next and I’ll turn this into concrete next steps.";
  return {
    role: "assistant",
    text,
    cards: entryPointsCards(lang),
    quickReplies: topicQuickReplies(lang)
  };
}

function sensitiveMessage(lang = "en") {
  const zh = lang === "zh";
  const text = zh
      ? "谢谢你告诉我。如果你现在有自伤/他伤风险或处在危险中，请立刻联系紧急服务（999）或使用 national mindline 1771（24/7）。我也可以继续给你官方入口与下一步转介方向。"
      : "Thanks for telling me. If you’re in immediate danger or at risk of self-harm, contact emergency services (999) or national mindline 1771 (24/7). I can also share official entry points and next-step referrals.";
  return {
    role: "assistant",
    text,
    cards: entryPointsCards(lang),
    quickReplies: topicQuickReplies(lang)
  };
}

export function handleUserText(state, userText) {
  const lang = state.lang;
  const raw = (userText || "").trim();
  const zh = lang === "zh";

  if (!raw) {
    return { state, message: {
        role: "assistant",
        text: zh ? "你可以直接选择一个主题，或用一句话描述你的情况。" : "Pick a topic, or describe your situation in one sentence.",
        cards: [],
        quickReplies: state.step === "choose_domain" ? topicQuickReplies(lang) : domainPresets(state.domainId, lang)
      }};
  }

  // global safety checks
  if (containsAny(raw, SENSITIVE_TRIGGERS)) {
    return { state: { ...state, step: "choose_domain", domainId: null }, message: sensitiveMessage(lang) };
  }
  if (containsAny(raw, URGENT_TRIGGERS)) {
    return { state: { ...state, step: "choose_domain", domainId: null }, message: urgentMessage(lang) };
  }

  const detectedDomain = detectDomainIdFromText(raw);

  if (state.step === "choose_domain") {
    if (detectedDomain) {
      const next = { ...state, step: "choose_focus", domainId: detectedDomain };
      const d = domainById(detectedDomain);
      const text = zh
          ? `好的，我们先从「${langPick(lang, d.en, d.zh)}」开始。你想先看哪一类信息？`
          : `OK — let’s start with “${langPick(lang, d.en, d.zh)}”. What do you want first?`;
      return { state: next, message: { role: "assistant", text, cards: [], quickReplies: focusQuickReplies(lang) } };
    }

    const text = zh
        ? "我还不确定你属于哪一类。你可以先点一个主题（上面按钮），或用更具体的一句话描述。"
        : "I’m not sure which category this falls under. Tap a topic above, or describe your need more specifically.";
    return { state, message: { role: "assistant", text, cards: [], quickReplies: topicQuickReplies(lang) } };
  }

  if (state.step === "choose_focus") {
    const q = raw;
    const next = { ...state, step: "refine_and_show", lastQuery: q, topK: DEFAULT_TOPK };
    return { state: next, message: buildResultsMessage({
        lang, domainId: next.domainId, focus: next.focus, query: q, topK: next.topK
      })};
  }

  const next = { ...state, step: "refine_and_show", lastQuery: raw, topK: DEFAULT_TOPK };
  return { state: next, message: buildResultsMessage({
      lang, domainId: next.domainId, focus: next.focus, query: next.lastQuery, topK: next.topK
    })};
}

export function handleAction(state, action) {
  const lang = state.lang;
  const zh = lang === "zh";

  if (!action || !action.type) return { state, message: null };

  switch (action.type) {
    case "RESTART": {
      const s = initDialogState(lang);
      return { state: s, message: getInitialAssistantMessage(lang) };
    }
    case "BACK_TOPICS": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", topK: DEFAULT_TOPK };
      return { state: s, message: {
          role: "assistant",
          text: zh ? "好的，我们回到一开始。你现在需要哪一类帮助？" : "Sure — back to the start. What kind of help do you need?",
          cards: [],
          quickReplies: topicQuickReplies(lang)
        }};
    }
    case "URGENT": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", topK: DEFAULT_TOPK };
      return { state: s, message: urgentMessage(lang) };
    }
    case "SENSITIVE": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", topK: DEFAULT_TOPK };
      return { state: s, message: sensitiveMessage(lang) };
    }
    case "SET_DOMAIN": {
      const d = domainById(action.domainId);
      const s = { ...state, step: "choose_focus", domainId: action.domainId, lastQuery: "", topK: DEFAULT_TOPK };
      const text = zh
          ? `好的，我们从「${langPick(lang, d.en, d.zh)}」开始。你想先看哪一类信息？`
          : `OK — starting with “${langPick(lang, d.en, d.zh)}”. What do you want first?`;
      return { state: s, message: { role: "assistant", text, cards: [], quickReplies: focusQuickReplies(lang) } };
    }
    case "SET_FOCUS": {
      const s = { ...state, focus: action.focus || "overview" };
      if (s.step === "refine_and_show" && s.lastQuery) {
        return { state: s, message: buildResultsMessage({
            lang, domainId: s.domainId, focus: s.focus, query: s.lastQuery, topK: s.topK
          })};
      }
      const text = zh
          ? "明白。为了更精确，能用一句话描述你的情况吗？（也可以点下面的快捷选项）"
          : "Got it. To be precise, can you describe your situation in one sentence? (or tap a quick option below)";
      return { state: { ...s, step: "refine_and_show" }, message: {
          role: "assistant",
          text,
          cards: [],
          quickReplies: domainPresets(s.domainId, lang)
        }};
    }
    case "ADD_QUERY": {
      const added = (action.text || "").trim();
      const q = state.lastQuery ? `${state.lastQuery} ${added}`.trim() : added;
      const s = { ...state, step: "refine_and_show", lastQuery: q, topK: DEFAULT_TOPK };
      return { state: s, message: buildResultsMessage({
          lang, domainId: s.domainId, focus: s.focus, query: s.lastQuery, topK: s.topK
        })};
    }
    case "MORE_RESULTS": {
      const s = { ...state, topK: Math.min((state.topK || DEFAULT_TOPK) + 3, 12) };
      if (!s.lastQuery) {
        return { state: s, message: {
            role: "assistant",
            text: zh ? "请先用一句话描述你的需求，我才能给你更相关的结果。" : "Describe your need in one sentence first, so I can fetch more relevant results.",
            cards: [],
            quickReplies: domainPresets(s.domainId, lang)
          }};
      }
      return { state: s, message: buildResultsMessage({
          lang, domainId: s.domainId, focus: s.focus, query: s.lastQuery, topK: s.topK
        })};
    }
    case "NOOP":
    default:
      return { state, message: null };
  }
}
