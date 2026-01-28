import KB from "../data/sg_services_kb.json";

const normalize = (s) =>
    (s || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

const tokenize = (s) => normalize(s).split(" ").filter(Boolean);

/** coarse category hint */
const KEYWORD_MAP = [
    { kw: ["financial", "aid", "money", "assistance", "help", "cash", "voucher", "vouchers", "comcare", "wis", "workfare", "gstv", "gst", "cdc"], category: "financial_assistance" },
    { kw: ["housing", "rent", "rental", "arrears", "tenant", "eviction", "shelter", "homeless", "hdb", "pphs"], category: "housing_assistance" },
    { kw: ["health", "medical", "clinic", "doctor", "hospital", "chas", "medifund", "medishield", "careshield"], category: "healthcare_support" },
    { kw: ["elderly", "senior", "silver", "aic", "caregiver", "pioneer", "merdeka"], category: "elderly_support" },

    { kw: ["经济", "补助", "救助", "现金", "生活费", "购物券", "代金券", "comcare"], category: "financial_assistance" },
    { kw: ["住房", "租房", "租金", "欠租", "驱逐", "无家可归", "收容所", "hdb"], category: "housing_assistance" },
    { kw: ["医疗", "看病", "诊所", "住院", "费用", "补贴", "chas", "medifund"], category: "healthcare_support" },
    { kw: ["长者", "老人", "乐龄", "照护", "护理", "silver", "aic"], category: "elderly_support" }
];

const SYN = {
    eviction: ["notice", "kicked", "homeless", "shelter"],
    rent: ["rental", "arrears", "tenant"],
    hdb: ["public rental", "flat", "housing"],
    medical: ["health", "clinic", "doctor", "hospital"],
    chas: ["gp", "dental", "subsidy"],
    medifund: ["bill", "unable to pay", "financial assistance"],
    comcare: ["assistance", "aid", "help", "cash"],
    workfare: ["wis", "low wage", "cpf"],
    elderly: ["senior", "silver", "aic", "caregiver"],

    住房: ["租房", "租金", "驱逐", "欠租", "无家可归", "收容所"],
    医疗: ["看病", "诊所", "补贴", "住院", "费用"],
    经济: ["补助", "救助", "现金", "生活费"],
    长者: ["老人", "乐龄", "护理", "照护"]
};

function expandTokens(tokens) {
    const set = new Set(tokens);
    for (const t of tokens) {
        if (SYN[t]) SYN[t].forEach((x) => set.add(normalize(x)));
    }
    return Array.from(set).filter(Boolean);
}

export function detectCategory(text) {
    const q = normalize(text);
    for (const m of KEYWORD_MAP) {
        if (m.kw.some((k) => q.includes(normalize(k)))) return m.category;
    }
    return null;
}

export function detectSensitive(text) {
    const q = normalize(text);
    const triggers = [
        "homeless", "unsafe", "abuse", "harm", "suicide", "eviction", "urgent", "emergency",
        "无家可归", "危险", "家暴", "自残", "轻生", "驱逐", "紧急", "今天没地方住"
    ];
    return triggers.some((k) => q.includes(normalize(k)));
}

function schemeText(s) {
    const parts = [
        s.name_en, s.name_zh,
        s.summary_en, s.summary_zh,
        ...(s.eligibility_en || []), ...(s.eligibility_zh || []),
        ...(s.how_to_apply_en || []), ...(s.how_to_apply_zh || []),
        ...(s.official_links || [])
    ];
    return normalize(parts.filter(Boolean).join(" "));
}

function intentBoost(tokens) {
    const tset = new Set(tokens);
    const boosts = {
        housing_assistance: 0,
        healthcare_support: 0,
        financial_assistance: 0,
        elderly_support: 0
    };
    const add = (cat, v) => (boosts[cat] += v);

    // housing urgency
    if (tset.has("eviction") || tset.has("驱逐") || tset.has("homeless") || tset.has("无家可归") || tset.has("shelter") || tset.has("收容所")) add("housing_assistance", 3.0);
    if (tset.has("arrears") || tset.has("欠租")) add("housing_assistance", 2.0);

    // healthcare
    if (tset.has("chas")) add("healthcare_support", 2.0);
    if (tset.has("medifund")) add("healthcare_support", 2.0);
    if (tset.has("hospital") || tset.has("住院")) add("healthcare_support", 1.5);

    // financial
    if (tset.has("comcare")) add("financial_assistance", 2.0);
    if (tset.has("wis") || tset.has("workfare")) add("financial_assistance", 1.5);
    if (tset.has("voucher") || tset.has("vouchers") || tset.has("购物券") || tset.has("代金券")) add("financial_assistance", 1.0);

    // elderly
    if (tset.has("elderly") || tset.has("长者") || tset.has("silver")) add("elderly_support", 2.0);
    if (tset.has("caregiver") || tset.has("照护") || tset.has("护理")) add("elderly_support", 1.5);

    return boosts;
}

function scoreScheme(queryTokens, scheme, hintedCategory) {
    const text = schemeText(scheme);
    let score = 0;

    // token overlap
    for (const tok of queryTokens) {
        if (!tok) continue;
        if (text.includes(tok)) score += 1.0;
    }

    // title boost
    const title = normalize(`${scheme.name_en || ""} ${scheme.name_zh || ""}`);
    for (const tok of queryTokens) {
        if (title.includes(tok)) score += 1.2;
    }

    // category hint
    if (hintedCategory && scheme.category === hintedCategory) score += 1.0;

    // intent boost
    score += (intentBoost(queryTokens)[scheme.category] || 0);

    return score;
}

function searchSchemesSmart(userText, hintedCategory, topK = 5) {
    const baseTokens = tokenize(userText);
    const tokens = expandTokens(baseTokens);

    const schemes = Array.isArray(KB?.schemes) ? KB.schemes : [];
    const scored = schemes
        .map((s) => ({ s, score: scoreScheme(tokens, s, hintedCategory) }))
        .filter((x) => x.score > 0.6)
        .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((x) => x.s);
}

function formatFallbackHint(lang) {
    const ep = Array.isArray(KB?.entry_points) ? KB.entry_points : [];
    const support = ep.find((x) => x.id === "supportgowhere");
    const sso = ep.find((x) => x.id === "sso_comcare");

    if (lang === "zh") {
        const lines = [
            "我没找到足够匹配的具体方案。你可以先从这些官方入口开始：",
            support?.links?.[0] ? `- SupportGoWhere：${support.links[0]}` : null,
            sso?.links?.[0] ? `- SSO / ComCare：${sso.links[0]}` : null,
            sso?.contacts?.hotline ? `- ComCare 热线：${sso.contacts.hotline}` : null,
            sso?.contacts?.email ? `- 邮箱：${sso.contacts.email}` : null
        ].filter(Boolean);
        return "\n\n" + lines.join("\n");
    }

    const lines = [
        "I couldn’t find a high-confidence match. Start from these official entry points:",
        support?.links?.[0] ? `- SupportGoWhere: ${support.links[0]}` : null,
        sso?.links?.[0] ? `- SSO / ComCare: ${sso.links[0]}` : null,
        sso?.contacts?.hotline ? `- ComCare Hotline: ${sso.contacts.hotline}` : null,
        sso?.contacts?.email ? `- Email: ${sso.contacts.email}` : null
    ].filter(Boolean);
    return "\n\n" + lines.join("\n");
}

/**
 * start -> ask_audience -> ask_urgency -> ask_docs -> done
 */
export function nextTurn({ lang, state, userText }) {
    const q = (userText || "").trim();
    const sensitive = detectSensitive(q);
    const step = state?.step ?? "start";

    if (step === "start") {
        const category = detectCategory(q);

        // if no category, try smart search anyway
        if (!category) {
            const pre = searchSchemesSmart(q, null, 3);
            if (pre.length > 0) {
                const ask =
                    lang === "zh"
                        ? "我初步找到一些可能相关的方案。为了更准确匹配，我问你 3 个问题：\n1) 你属于哪类人群？（长者 / 低收入家庭 / 其他）"
                        : "I found a few potentially relevant schemes. To be more accurate, I’ll ask 3 quick questions:\n1) Which group best describes you? (elderly / low-income family / other)";
                return {
                    reply: ask,
                    patch: { step: "ask_audience", category: null, preQuery: q },
                    recommendations: [],
                    sensitiveSuggested: sensitive
                };
            }

            const msg =
                lang === "zh"
                    ? "你可以输入简单关键词开始，例如：经济援助、住房补助、医疗补贴、长者支持。\n\n我会通过几个追问给出简化指引，并在必要时建议转人工。"
                    : 'Type a simple keyword to start, e.g., "financial aid", "housing grant", "medical subsidy", "support for seniors".\n\nI’ll ask a few questions, explain in plain language, and suggest human escalation when needed.';
            return { reply: msg, patch: { step: "start" }, recommendations: [], sensitiveSuggested: sensitive };
        }

        const ask =
            lang === "zh"
                ? "好的。我问你 3 个简单问题来更精准匹配：\n1) 你属于哪类人群？（长者 / 低收入家庭 / 其他）"
                : "Got it. I’ll ask 3 quick questions to narrow down:\n1) Which group best describes you? (elderly / low-income family / other)";
        return {
            reply: ask,
            patch: { step: "ask_audience", category, preQuery: q },
            recommendations: [],
            sensitiveSuggested: sensitive
        };
    }

    if (step === "ask_audience") {
        const audience = q;
        const ask =
            lang === "zh"
                ? "2) 是否紧急？（例如：收到驱逐通知 / 今天没地方住 / 否）"
                : "2) Is it urgent? (e.g., eviction notice / no place to stay today / not urgent)";
        return {
            reply: ask,
            patch: { step: "ask_urgency", profile: { ...(state.profile || {}), audience } },
            recommendations: [],
            sensitiveSuggested: sensitive
        };
    }

    if (step === "ask_urgency") {
        const urgency = q;
        const ask =
            lang === "zh"
                ? "3) 你目前有哪些材料？（身份证明/住址证明/收入证明/都没有）"
                : "3) What documents do you have? (ID / proof of address / proof of income / none)";
        return {
            reply: ask,
            patch: { step: "ask_docs", profile: { ...(state.profile || {}), urgency } },
            recommendations: [],
            sensitiveSuggested: sensitive
        };
    }

    if (step === "ask_docs") {
        const docs = q;
        const profile = { ...(state.profile || {}), docs };

        const query = [
            state.preQuery || "",
            state.category || "",
            profile.audience || "",
            profile.urgency || "",
            profile.docs || ""
        ].join(" ").trim();

        const hintedCategory = state.category || detectCategory(query) || null;
        const recs = searchSchemesSmart(query, hintedCategory, 5);

        const header =
            lang === "zh"
                ? "谢谢。以下是与你需求最相关的方案（基于官方信息整理），并附上简化申请指引与官方链接："
                : "Thanks. Here are the most relevant schemes (compiled from official sources), with simplified steps and official links:";

        const sensitiveHint =
            sensitive
                ? lang === "zh"
                    ? "\n\n⚠️ 你的情况可能紧急/敏感，建议点击右上角“转人工支持”。"
                    : "\n\n⚠️ This may be urgent/sensitive. Consider clicking “Escalate to human”."
                : "";

        const fallback = recs.length === 0 ? formatFallbackHint(lang) : "";

        return {
            reply: header + sensitiveHint + fallback,
            patch: { step: "done", profile, category: hintedCategory },
            recommendations: recs,
            sensitiveSuggested: sensitive
        };
    }

    const msg =
        lang === "zh"
            ? "如果你还想了解其他服务类型，请输入新的关键词（例如：经济援助 / 住房补助 / 医疗补贴 / 长者支持）。"
            : 'If you want another service type, type a new keyword (e.g., "financial aid", "housing grant", "medical help", "support for seniors").';

    return {
        replyKey: "resetHint",
        patch: { step: "start", category: null, profile: {}, preQuery: "" },
        recommendations: [],
        sensitiveSuggested: sensitive
    };
}
