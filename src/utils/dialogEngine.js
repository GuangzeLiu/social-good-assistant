// Design goals
// - One clear flow: choose domain -> choose focus (eligibility / steps / overview) -> refine query -> show schemes
// - Always offer: Back to topics / Restart
// - Global urgent & sensitive handling (entry points first)
// - Be tolerant of free-form input: detect domain from natural text, soft-guess domain if needed
// - More empathetic, caring tone while staying factual

import kb from "../data/sg_services_kb.json";

const DEFAULT_PAGE_SIZE = 3;
const MAX_MATCHES_CAP = 50; // safety cap (avoid huge payloads)

const STOPWORDS = new Set([
  "the","a","an","to","for","and","or","of","in","on","at","is","are","am",
  "i","me","my","we","our","you","your","they","them","this","that",
  "need","help","please","can","could","want","looking","apply","get",
  "with","from","about","into","as","it","im","i'm",

  "我","我们","你","你们","需要","想","申请","帮助","怎么","如何","有没有","可以","吗","要","找","想要","一下","现在","这个","那个"
]);

// Make synonyms generous: this is the key to "free-form" robustness.
const SYNONYMS = [
  // English -> canonical
  { re: /\b(financial aid|cash help|money help|no money|broke|bills? help|overdue bills?|arrears|low income|debt)\b/i, norm: "financial aid" },
  { re: /\b(housing grant|rental support|rent help|no place to stay|eviction|evicted|homeless|shelter|sleeping outside)\b/i, norm: "housing" },

  // IMPORTANT: "health" should map into medical intent
  { re: /\b(health|healthcare|medical|sick|ill|clinic|doctor|gp|polyclinic|medicine|medication|dental)\b/i, norm: "medical" },
  { re: /\b(hospital bill|ward|a&e|emergency room|cannot afford hospital|cant afford hospital)\b/i, norm: "hospital bill" },
  { re: /\b(medical subsidy|clinic subsidy|medifund|chas|medisave|medishield)\b/i, norm: "medical" },

  { re: /\b(senior support|elderly|caregiver|home care)\b/i, norm: "seniors" },
  { re: /\b(disability|wheelchair|assistive|pwd|sgenable)\b/i, norm: "disability" },
  { re: /\b(school fees|childcare|preschool|student care|kifas|ecda)\b/i, norm: "education" },
  { re: /\b(job|employment|unemployed|training|upskill|skillsfuture)\b/i, norm: "employment" },
  { re: /\b(mental health|anxiety|depression|counselling|therapy|stressed|overwhelmed|panic|suicid)\b/i, norm: "mental health" },
  { re: /\b(legal aid|lawyer|divorce|court|legal)\b/i, norm: "legal" },

  // Chinese -> canonical
  { re: /(经济援助|现金补助|没钱|我很穷|生活费|账单|欠费|补贴|发放)/, norm: "financial aid" },
  { re: /(住房|租房|租金补贴|被驱逐|驱逐通知|没地方住|无家可归|收容|露宿)/, norm: "housing" },

  { re: /(健康|生病|看病|医疗|医药费|药|药费|太贵|诊所|医生|医院账单|住院费|急诊|A&E|社工)/i, norm: "medical" },

  { re: /(长者|老人|照护|护理|照护者|看护)/, norm: "seniors" },
  { re: /(残障|残疾|轮椅|辅助器材|助听器)/, norm: "disability" },
  { re: /(学费|幼儿园|托儿|学生托管|课后照护)/, norm: "education" },
  { re: /(工作|就业|失业|培训|技能|课程补贴)/, norm: "employment" },
  { re: /(心理|抑郁|焦虑|压力很大|崩溃|想不开|自杀|辅导)/, norm: "mental health" },
  { re: /(法律援助|离婚|律师|法庭|法律)/, norm: "legal" }
];

const SENSITIVE_TRIGGERS = [
  /\b(suicide|kill myself|self-harm|end my life)\b/i,
  /(自杀|轻生|想不开|伤害自己|结束生命)/
];

const URGENT_TRIGGERS = [
  /\b(no place to stay today|no place to stay tonight|sleeping outside|evicted today|urgent|emergency|tonight)\b/i,
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

// Optional: category keyword hints to help soft-domain scoring
const DOMAIN_HINTS = {
  financial: ["financial aid","comcare","gstv","assurance","cdc","workfare","wis","cash","bills"],
  housing: ["housing","rent","rental","hdb","irh","pphs","eviction","homeless","shelter"],
  healthcare: ["medical","clinic","doctor","chas","medifund","medisave","medishield","hospital bill","health"],
  seniors: ["seniors","elderly","caregiver","aic","silver support"],
  disability: ["disability","pwd","sgenable","assistive","atf","eec"],
  legal: ["legal","lab","lawyer","divorce","court","legal aid"],
  mental: ["mental health","mindline","1771","anxiety","depression","stressed","overwhelmed"]
};

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

// Hard detection: fast path
function detectDomainIdFromText(raw) {
  const t = normalizeText(raw).toLowerCase();

  if (/\bfinancial aid\b/.test(t) || /\bcomcare\b/.test(t) || /assurance|gstv|cdc vouchers|workfare|wis/.test(t)) return "financial";
  if (/\bhousing\b/.test(t) || /eviction|evicted|homeless|rental|shelter|no place to stay/.test(t)) return "housing";

  // IMPORTANT: health/medical should map to healthcare
  if (/\bmedical\b/.test(t) || /\bhealth\b/.test(t) || /clinic|doctor|gp|polyclinic|chas|medifund|medisave|medishield|hospital bill/.test(t)) return "healthcare";

  if (/\bseniors\b/.test(t) || /elderly|caregiver|silver support|aic/.test(t)) return "seniors";
  if (/\bdisability\b/.test(t) || /pwd|sgenable|assistive|atf|eec/.test(t)) return "disability";
  if (/\blegal\b/.test(t) || /lab|lawyer|divorce|court|legal aid/.test(t)) return "legal";
  if (/\bmental health\b/.test(t) || /anxiety|depression|mindline|1771|stressed|overwhelmed/.test(t)) return "mental";

  return null;
}

// Soft detection: if user free-types without clicking topics
function softGuessDomainId(raw) {
  const t = normalizeText(raw).toLowerCase();
  const tokens = tokenize(t);

  let best = { id: null, score: 0 };
  for (const d of DOMAIN) {
    const hints = DOMAIN_HINTS[d.id] || [];
    let s = 0;

    for (const h of hints) {
      const hh = normalizeText(h).toLowerCase();
      if (t.includes(hh)) s += 3;
    }
    for (const tok of tokens) {
      if (hints.some(h => normalizeText(h).toLowerCase().includes(tok))) s += 1;
    }

    // tiny bias if user already typed canonical keyword like "medical"/"housing"
    if (t.includes(d.id)) s += 1;

    if (s > best.score) best = { id: d.id, score: s };
  }

  // threshold: require at least small signal
  return best.score >= 3 ? best.id : null;
}

function schemeTextForMatch(s) {
  const all = [
    s.name_en, s.name_zh,
    s.summary_en, s.summary_zh,
    ...(s.keywords_en || []),
    ...(s.keywords_zh || []),
    ...(s.eligibility_en || []),
    ...(s.eligibility_zh || []),
    ...(s.how_to_apply_en || []),
    ...(s.how_to_apply_zh || [])
  ].filter(Boolean).join(" ");
  return normalizeText(all).toLowerCase();
}

function scoreScheme(queryTokens, scheme, categoryBoost = null) {
  const hay = schemeTextForMatch(scheme);
  let score = 0;

  for (const tok of queryTokens) {
    if (hay.includes(tok)) score += 3;
  }
  if (categoryBoost && scheme.category === categoryBoost) score += 10; // stronger boost

  const nameHay = normalizeText(`${scheme.name_en || ""} ${scheme.name_zh || ""}`).toLowerCase();
  for (const tok of queryTokens) {
    if (nameHay.includes(tok)) score += 2;
  }

  // Extra: if query is very short (e.g., "health"), avoid falling to 0 too often
  if (queryTokens.length <= 2 && categoryBoost && scheme.category === categoryBoost) score += 2;

  return score;
}

/**
 * Return all matched schemes (sorted, score>0) up to MAX_MATCHES_CAP.
 * We paginate on top of this to avoid duplicates.
 */
function retrieveAllSchemes({ query, domainId }) {
  const d = domainById(domainId);
  const tokens = tokenize(query);

  const scored = kb.schemes
      .map(s => ({ s, score: scoreScheme(tokens, s, d?.cat || null) }))
      .sort((a, b) => b.score - a.score);

  const matched = scored.filter(x => x.score > 0).slice(0, MAX_MATCHES_CAP);
  const bestScore = scored[0]?.score ?? 0;
  const lowConfidence = bestScore < 5;

  return { matched, lowConfidence, bestScore };
}

function formatScheme(s, lang, focus = "overview") {
  const title = langPick(lang, s.name_en, s.name_zh);
  const summary = langPick(lang, s.summary_en, s.summary_zh);
  const eligibility = lang === "zh" ? (s.eligibility_zh || []) : (s.eligibility_en || []);
  const steps = lang === "zh" ? (s.how_to_apply_zh || []) : (s.how_to_apply_en || []);
  const links = (s.official_links || []).slice(0, 3);

  return { id: s.id, title, summary, eligibility, steps, links, focus };
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

function endQuickReply(lang) {
  return makeQuickReplies([
    { id: "end", label: lang === "zh" ? "结束" : "End", action: { type: "END" } }
  ])[0];
}

function escalateQuickReply(lang) {
  return makeQuickReplies([
    { id: "escalate", label: lang === "zh" ? "转人工" : "Talk to a human", action: { type: "ESCALATE" } }
  ])[0];
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
  // add end at the bottom
  topics.push({
    id: "end",
    label: lang === "zh" ? "结束" : "End",
    action: { type: "END" }
  });
  return makeQuickReplies(topics);
}

function focusQuickReplies(lang) {
  return makeQuickReplies([
    { id: "overview", label: lang === "zh" ? "先看概览" : "Overview", action: { type: "SET_FOCUS", focus: "overview" } },
    { id: "eligibility", label: lang === "zh" ? "我想看资格" : "Eligibility", action: { type: "SET_FOCUS", focus: "eligibility" } },
    { id: "steps", label: lang === "zh" ? "我想看申请步骤" : "How to apply", action: { type: "SET_FOCUS", focus: "steps" } },
    ...baseNavQuickReplies(lang),
    endQuickReply(lang)
  ]);
}

// Small empathy helpers (keeps your deterministic flow, but sounds better)
function empathyStart(domainId, lang) {
  const zh = lang === "zh";
  switch (domainId) {
    case "financial":
      return zh ? "明白，经济压力真的会让人喘不过气。我们先找最直接可行的官方方案。" : "I hear you — money stress can be heavy. Let’s start with the most workable official options.";
    case "housing":
      return zh ? "听起来你在处理住宿压力，这种情况很不容易。我们先确保你有安全可行的下一步。" : "That sounds tough. Let’s make sure you have a safe, practical next step first.";
    case "healthcare":
      return zh ? "我明白，身体不舒服或医药费压力会很焦虑。我们先看最直接的补贴/减免入口。" : "I’m sorry you’re dealing with this. Let’s look at the most direct subsidy/relief routes.";
    case "mental":
      return zh ? "我听到了你的压力。你不需要一个人扛着，我们一步一步来。" : "I hear you. You don’t have to handle this alone — we’ll take it one step at a time.";
    case "seniors":
      return zh ? "明白，我们先把适合长者/照护者的官方入口整理出来。" : "Got it. Let’s narrow down the best official support for seniors/caregivers.";
    case "disability":
      return zh ? "明白，我们先看最匹配的残障支持与申请路径。" : "Got it. Let’s look at the most relevant disability support and application route.";
    case "legal":
      return zh ? "明白，法律问题往往很耗心力。我们先从官方援助入口开始。" : "Got it — legal issues can be stressful. Let’s start from official aid entry points.";
    default:
      return zh ? "明白。我们先把方向收敛一下。" : "Got it. Let’s narrow this down.";
  }
}

function askOneClarifier(domainId, lang) {
  const zh = lang === "zh";
  switch (domainId) {
    case "healthcare":
      return zh
          ? "你更接近哪种情况？A 诊所/门诊补贴（例如 CHAS）｜B 住院/医院账单需要减免（例如 MediFund/医疗社工）"
          : "Which is closer? A) clinic/outpatient subsidies (e.g., CHAS) or B) help with a hospital bill (e.g., MediFund/Medical Social Worker)?";
    case "housing":
      return zh
          ? "这是“今天/今晚没地方住”的紧急情况吗？（是/否）"
          : "Is this urgent — no place to stay today/tonight? (yes/no)";
    case "financial":
      return zh
          ? "你现在最急的是：A 日常生活费/食物｜B 账单欠费｜C 短期现金周转？"
          : "What’s most urgent: A) daily expenses/food, B) overdue bills, or C) short-term cash help?";
    case "mental":
      return zh
          ? "你希望我优先给：A 先有人倾听/匿名支持｜B 专业转介与下一步？"
          : "Do you prefer A) someone to talk to anonymously, or B) professional referral/next steps?";
    default:
      return zh
          ? "你想先看：A 资格条件（我是否符合）｜B 申请步骤（怎么做/去哪办）？"
          : "Would you like A) eligibility criteria, or B) step-by-step how/where to apply?";
  }
}

function domainPresets(domainId, lang) {
  const zh = lang === "zh";
  switch (domainId) {
    case "financial":
      return makeQuickReplies([
        { id: "daily", label: zh ? "日常生活费/食物" : "Daily expenses / food", action: { type: "ADD_QUERY", text: zh ? "生活费 食物" : "daily expenses food" } },
        { id: "bills", label: zh ? "账单/水电费" : "Bills / utilities", action: { type: "ADD_QUERY", text: zh ? "账单 水电费" : "bills utilities" } },
        { id: "rent", label: zh ? "租金压力" : "Rent problems", action: { type: "ADD_QUERY", text: zh ? "租金" : "rent" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "housing":
      return makeQuickReplies([
        { id: "no_place", label: zh ? "今天没地方住" : "No place to stay today", action: { type: "URGENT" } },
        { id: "rental", label: zh ? "公共租赁/租房" : "Public rental / renting", action: { type: "ADD_QUERY", text: zh ? "公共租赁 租房" : "public rental" } },
        { id: "temp", label: zh ? "过渡/临时安置" : "Temporary shelter", action: { type: "ADD_QUERY", text: zh ? "临时安置 shelter" : "temporary shelter" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "healthcare":
      return makeQuickReplies([
        { id: "clinic", label: zh ? "诊所/门诊补贴" : "Clinic/outpatient subsidy", action: { type: "ADD_QUERY", text: zh ? "CHAS 门诊 诊所" : "CHAS clinic outpatient" } },
        { id: "hospital", label: zh ? "医院账单付不起" : "Can't afford hospital bill", action: { type: "ADD_QUERY", text: zh ? "医院账单 付不起 MediFund" : "hospital bill MediFund" } },
        { id: "insurance", label: zh ? "保险/保费" : "Insurance / premiums", action: { type: "ADD_QUERY", text: zh ? "MediShield Life 保费" : "MediShield Life premiums" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "seniors":
      return makeQuickReplies([
        { id: "cash", label: zh ? "现金补助" : "Cash support", action: { type: "ADD_QUERY", text: zh ? "现金补助 Silver Support" : "cash support Silver Support" } },
        { id: "care", label: zh ? "照护服务" : "Care services", action: { type: "ADD_QUERY", text: zh ? "照护服务 AIC" : "care services AIC" } },
        { id: "caregiver", label: zh ? "照护者资源" : "Caregiver support", action: { type: "ADD_QUERY", text: zh ? "照护者 支持" : "caregiver support" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "disability":
      return makeQuickReplies([
        { id: "assistive", label: zh ? "辅助器材补贴" : "Assistive tech subsidy", action: { type: "ADD_QUERY", text: zh ? "辅助器材 ATF" : "assistive technology fund ATF" } },
        { id: "jobs", label: zh ? "就业支持" : "Employment support", action: { type: "ADD_QUERY", text: zh ? "残障 就业" : "disability employment" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "legal":
      return makeQuickReplies([
        { id: "legal_aid", label: zh ? "法律援助申请" : "Apply for legal aid", action: { type: "ADD_QUERY", text: zh ? "法律援助 LAB" : "legal aid LAB" } },
        { id: "family", label: zh ? "家庭/离婚" : "Family/divorce", action: { type: "ADD_QUERY", text: zh ? "离婚 家庭" : "divorce family law" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    case "mental":
      return makeQuickReplies([
        { id: "talk", label: zh ? "想找人聊聊" : "I need someone to talk to", action: { type: "ADD_QUERY", text: zh ? "心理支持 倾诉" : "mental health support talk" } },
        { id: "urgent_mental", label: zh ? "我很危险/想伤害自己" : "I'm in danger / self-harm thoughts", action: { type: "SENSITIVE" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
    default:
      return makeQuickReplies([
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ]);
  }
}

function noMoreResultsMessage(lang, domainId) {
  const zh = lang === "zh";
  const text = zh
      ? "我这边已经没有更多匹配结果了。\n\n如果你希望进一步确认适用方案或需要更个性化的协助，可以选择“转人工”。"
      : "I don’t have more matched results to show.\n\nIf you need more tailored help or want to confirm what applies to you, you can choose “Talk to a human”.";

  return {
    role: "assistant",
    text,
    cards: [],
    quickReplies: makeQuickReplies([
      { id: "escalate", label: zh ? "转人工" : "Talk to a human", action: { type: "ESCALATE" } },
      ...baseNavQuickReplies(lang),
      endQuickReply(lang)
    ])
  };
}

function endConversationMessage(lang) {
  const zh = lang === "zh";
  const text = zh
      ? "希望我提供的信息能帮助到您。\n\n如果之后还需要我协助，你随时可以点击“重新开始”或“返回主题”。"
      : "I hope the information I shared was helpful.\n\nIf you need help later, you can always tap “Restart” or “Back to topics”.";

  return {
    role: "assistant",
    text,
    cards: [],
    quickReplies: makeQuickReplies([
      { id: "back_topics", label: zh ? "返回主题" : "Back to topics", action: { type: "BACK_TOPICS" } },
      { id: "restart", label: zh ? "重新开始" : "Restart", action: { type: "RESTART" } }
    ])
  };
}

/**
 * Build results for the *current page* (offset/pageSize).
 * No duplication: "More results" moves offset forward.
 */
function buildResultsMessage({ lang, domainId, focus, query, offset, pageSize }) {
  const zh = lang === "zh";
  const domain = domainById(domainId);

  const { matched, lowConfidence } = retrieveAllSchemes({ query, domainId });
  const total = matched.length;

  if (!total) {
    return {
      role: "assistant",
      text: zh
          ? "我暂时没在知识库里匹配到非常具体的项目。别担心——你可以先从这些官方入口开始（能转介/查询），或者换一种说法（例如加上‘住院/诊所/账单’这类关键词）。"
          : "I couldn’t match a specific scheme in the KB yet. No worries — start from these official entry points (they can refer you), or rephrase with a bit more detail (e.g., ‘clinic/hospital/bills’).",
      cards: entryPointsCards(lang),
      quickReplies: makeQuickReplies([
        { id: "rephrase", label: zh ? "我补充一句细节" : "I’ll add one detail", action: { type: "NOOP" } },
        ...baseNavQuickReplies(lang),
        endQuickReply(lang)
      ])
    };
  }

  if (offset >= total) {
    return noMoreResultsMessage(lang, domainId);
  }

  const page = matched.slice(offset, offset + pageSize).map(x => x.s);
  const hasMore = offset + pageSize < total;

  const intro = lowConfidence
      ? (zh
          ? `我先给你几个“可能相关”的官方项目（基于：${langPick(lang, domain?.en, domain?.zh)}）。如果方向不对，点“返回主题”就能重来。`
          : `Here are a few *possibly relevant* official schemes (based on: ${langPick(lang, domain?.en, domain?.zh)}). If this isn’t right, tap “Back to topics”.`)
      : (zh
          ? `我找到最相关的官方项目（${langPick(lang, domain?.en, domain?.zh)}）。你想先看“资格”还是“申请步骤”？`
          : `I found the most relevant official schemes (${langPick(lang, domain?.en, domain?.zh)}). Do you want “Eligibility” or “How to apply” first?`);

  const cards = page.map(s => formatScheme(s, lang, focus));

  const focusChips = [
    { id: "overview", label: zh ? "概览" : "Overview", action: { type: "SET_FOCUS", focus: "overview" } },
    { id: "eligibility", label: zh ? "资格" : "Eligibility", action: { type: "SET_FOCUS", focus: "eligibility" } },
    { id: "steps", label: zh ? "步骤" : "Steps", action: { type: "SET_FOCUS", focus: "steps" } }
  ];

  if (hasMore) {
    focusChips.push({ id: "more", label: zh ? "更多结果" : "More results", action: { type: "MORE_RESULTS" } });
  } else {
    // optional: you can still allow "More results" to show the noMore message,
    // but UX-wise it’s cleaner to hide it when there’s no more.
  }

  return {
    role: "assistant",
    text: intro,
    cards,
    quickReplies: makeQuickReplies([
      ...focusChips,
      ...baseNavQuickReplies(lang),
      endQuickReply(lang)
    ])
  };
}

function urgentMessage(lang = "en") {
  const zh = lang === "zh";
  const text = zh
      ? "明白，这听起来比较紧急。为了让你马上有可走的下一步，我先给你最直接的官方入口（可转介/联系）。如果你愿意，也可以再说一句：你现在最急的是住房/钱/医疗哪一块？我会把步骤整理成 1-2-3。"
      : "Got it — this sounds urgent. To help immediately, here are official entry points you can contact first. If you’d like, tell me in one sentence whether this is mainly housing/money/healthcare, and I’ll turn it into a clear 1-2-3 plan.";
  return {
    role: "assistant",
    text,
    cards: entryPointsCards(lang),
    quickReplies: makeQuickReplies([
      ...topicQuickReplies(lang)
    ])
  };
}

function sensitiveMessage(lang = "en") {
  const zh = lang === "zh";
  const text = zh
      ? "谢谢你告诉我。如果你现在有自伤/他伤风险或处在危险中，请立刻联系紧急服务（999）或使用 national mindline 1771（24/7）。如果你愿意，你也可以回我一句：你更想‘有人倾听’还是‘获得转介与下一步’，我会继续帮你。"
      : "Thanks for telling me. If you’re in immediate danger or at risk of self-harm, contact emergency services (999) or national mindline 1771 (24/7). If you want, tell me whether you prefer ‘someone to talk to’ or ‘referral/next steps’, and I’ll continue.";
  return {
    role: "assistant",
    text,
    cards: entryPointsCards(lang),
    quickReplies: topicQuickReplies(lang)
  };
}

// ----------------- Public API -----------------
export function initDialogState(lang = "en") {
  return {
    lang,
    step: "choose_domain",  // choose_domain -> choose_focus -> refine_and_show
    domainId: null,
    focus: "overview",      // overview | eligibility | steps
    lastQuery: "",
    offset: 0,              // pagination offset (avoid duplicates)
    pageSize: DEFAULT_PAGE_SIZE,
    ended: false
  };
}

export function getInitialAssistantMessage(lang = "en") {
  const text = lang === "zh"
      ? "你好！你可以直接用一句话描述情况（例如：‘医药费太贵’ / ‘今晚没地方住’ / ‘我很焦虑’），我会从官方渠道帮你找到下一步。你现在最需要哪一类帮助？"
      : "Hi! You can describe your situation in one sentence (e.g., ‘medical bills are too expensive’ / ‘no place to stay tonight’ / ‘I feel overwhelmed’). I’ll help you find the next steps from official sources. What kind of help do you need?";
  return {
    role: "assistant",
    text,
    cards: [],
    quickReplies: topicQuickReplies(lang)
  };
}

export function handleUserText(state, userText) {
  const lang = state.lang;
  const raw = (userText || "").trim();
  const zh = lang === "zh";

  // If user already ended but types again, revive to start (friendly UX)
  if (state.ended) {
    const revived = { ...initDialogState(lang) };
    return {
      state: revived,
      message: {
        role: "assistant",
        text: zh ? "好的，我们重新开始。你现在最需要哪一类帮助？" : "Sure — let’s restart. What kind of help do you need?",
        cards: [],
        quickReplies: topicQuickReplies(lang)
      }
    };
  }

  if (!raw) {
    return {
      state,
      message: {
        role: "assistant",
        text: zh
            ? "你可以直接选择一个主题，或者用一句话描述你的情况（越像日常说法越好）。"
            : "You can pick a topic, or describe your situation in one natural sentence.",
        cards: [],
        quickReplies: state.step === "choose_domain" ? topicQuickReplies(lang) : domainPresets(state.domainId, lang)
      }
    };
  }

  // global safety checks
  if (containsAny(raw, SENSITIVE_TRIGGERS)) {
    return { state: { ...state, step: "choose_domain", domainId: null, lastQuery: "", offset: 0 }, message: sensitiveMessage(lang) };
  }
  if (containsAny(raw, URGENT_TRIGGERS)) {
    return { state: { ...state, step: "choose_domain", domainId: null, lastQuery: "", offset: 0 }, message: urgentMessage(lang) };
  }

  // Detect domain from free-form input
  const detectedHard = detectDomainIdFromText(raw);
  const detectedSoft = detectedHard || softGuessDomainId(raw);
  const detectedDomain = detectedSoft;

  // Step: choose_domain
  if (state.step === "choose_domain") {
    if (detectedDomain) {
      // Let user free-type: auto-advance
      const next = { ...state, step: "choose_focus", domainId: detectedDomain, offset: 0 };
      const d = domainById(detectedDomain);

      const text = zh
          ? `${empathyStart(detectedDomain, lang)}\n\n好的，我们先从「${langPick(lang, d.en, d.zh)}」开始。你想先看哪一类信息？`
          : `${empathyStart(detectedDomain, lang)}\n\nOK — let’s start with “${langPick(lang, d.en, d.zh)}”. What do you want first?`;

      return { state: next, message: { role: "assistant", text, cards: [], quickReplies: focusQuickReplies(lang) } };
    }

    // still unknown: be helpful + ask one clarifier (not just "I'm not sure")
    const text = zh
        ? "我还没完全确定你属于哪一类，但我想先接住你。\n\n你更接近下面哪一个？（也可以直接再说一句细节，例如‘住院账单’/‘租金欠费’/‘很焦虑’）"
        : "I’m not fully sure which category this falls under yet, but I want to help.\n\nWhich is closest? (Or add one detail like ‘hospital bill’ / ‘rent arrears’ / ‘feeling overwhelmed’.)";

    return { state, message: { role: "assistant", text, cards: [], quickReplies: topicQuickReplies(lang) } };
  }

  // Step: choose_focus
  if (state.step === "choose_focus") {
    const q = raw;
    const next = { ...state, step: "refine_and_show", lastQuery: q, offset: 0 };
    return {
      state: next,
      message: buildResultsMessage({
        lang,
        domainId: next.domainId,
        focus: next.focus,
        query: q,
        offset: next.offset,
        pageSize: next.pageSize
      })
    };
  }

  // Step: refine_and_show
  const next = { ...state, step: "refine_and_show", lastQuery: raw, offset: 0 };
  return {
    state: next,
    message: buildResultsMessage({
      lang,
      domainId: next.domainId,
      focus: next.focus,
      query: next.lastQuery,
      offset: next.offset,
      pageSize: next.pageSize
    })
  };
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
    case "END": {
      const s = { ...state, ended: true };
      return { state: s, message: endConversationMessage(lang) };
    }
    case "ESCALATE": {
      // Engine does not implement human handoff, but we emit the action so UI can route it.
      // We also provide a friendly message.
      const text = zh
          ? "好的，我帮你转接人工支持。"
          : "Okay — I’ll connect you to human support.";
      return {
        state,
        message: {
          role: "assistant",
          text,
          cards: [],
          quickReplies: makeQuickReplies([
            ...baseNavQuickReplies(lang),
            endQuickReply(lang)
          ])
        }
      };
    }
    case "BACK_TOPICS": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", offset: 0, ended: false };
      return {
        state: s,
        message: {
          role: "assistant",
          text: zh
              ? "好的，我们回到一开始。你可以点主题，也可以直接说一句你遇到的情况。"
              : "Sure — back to the start. You can tap a topic, or just tell me what’s going on in one sentence.",
          cards: [],
          quickReplies: topicQuickReplies(lang)
        }
      };
    }
    case "URGENT": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", offset: 0, ended: false };
      return { state: s, message: urgentMessage(lang) };
    }
    case "SENSITIVE": {
      const s = { ...state, step: "choose_domain", domainId: null, lastQuery: "", offset: 0, ended: false };
      return { state: s, message: sensitiveMessage(lang) };
    }
    case "SET_DOMAIN": {
      const d = domainById(action.domainId);
      const s = { ...state, step: "choose_focus", domainId: action.domainId, lastQuery: "", offset: 0, ended: false };

      const text = zh
          ? `${empathyStart(action.domainId, lang)}\n\n好的，我们从「${langPick(lang, d.en, d.zh)}」开始。你想先看哪一类信息？`
          : `${empathyStart(action.domainId, lang)}\n\nOK — starting with “${langPick(lang, d.en, d.zh)}”. What do you want first?`;

      return { state: s, message: { role: "assistant", text, cards: [], quickReplies: focusQuickReplies(lang) } };
    }
    case "SET_FOCUS": {
      // Focus changed => reset pagination to page 1 to avoid confusing jumps
      const s = { ...state, focus: action.focus || "overview", offset: 0 };

      if (s.step === "refine_and_show" && s.lastQuery) {
        return {
          state: s,
          message: buildResultsMessage({
            lang,
            domainId: s.domainId,
            focus: s.focus,
            query: s.lastQuery,
            offset: s.offset,
            pageSize: s.pageSize
          })
        };
      }

      // Move to refine step: ask one clarifier + show domain presets
      const text = zh
          ? `明白。${askOneClarifier(s.domainId, lang)}\n\n你也可以直接用一句话描述，我会马上给你最相关的官方项目。`
          : `Got it. ${askOneClarifier(s.domainId, lang)}\n\nOr describe it in one sentence — I’ll show the most relevant official schemes right away.`;

      return {
        state: { ...s, step: "refine_and_show" },
        message: { role: "assistant", text, cards: [], quickReplies: domainPresets(s.domainId, lang) }
      };
    }
    case "ADD_QUERY": {
      const added = (action.text || "").trim();
      const q = state.lastQuery ? `${state.lastQuery} ${added}`.trim() : added;
      const s = { ...state, step: "refine_and_show", lastQuery: q, offset: 0 };
      return {
        state: s,
        message: buildResultsMessage({
          lang,
          domainId: s.domainId,
          focus: s.focus,
          query: s.lastQuery,
          offset: s.offset,
          pageSize: s.pageSize
        })
      };
    }
    case "MORE_RESULTS": {
      if (!state.lastQuery) {
        return {
          state,
          message: {
            role: "assistant",
            text: zh
                ? "你先用一句话描述你的需求（例如‘住院账单’/‘租金欠费’/‘诊所补贴’），我才能给你更相关的更多结果。"
                : "Describe your need in one sentence first (e.g., ‘hospital bill’ / ‘rent arrears’ / ‘clinic subsidy’), and I’ll fetch more relevant results.",
            cards: [],
            quickReplies: domainPresets(state.domainId, lang)
          }
        };
      }

      const nextOffset = (state.offset || 0) + (state.pageSize || DEFAULT_PAGE_SIZE);
      const s = { ...state, offset: nextOffset };

      const msg = buildResultsMessage({
        lang,
        domainId: s.domainId,
        focus: s.focus,
        query: s.lastQuery,
        offset: s.offset,
        pageSize: s.pageSize
      });

      return { state: s, message: msg };
    }
    case "NOOP":
    default:
      return { state, message: null };
  }
}
