import kb from "../data/sg_services_kb.json";
import faq from "../data/sg_faq_kb.json";

/*
 kb = {
   meta,
   entry_points: [...],
   schemes: [...]
 }
*/

const SCHEMES = kb.schemes || [];
const ENTRY_POINTS = kb.entry_points || [];

function normalize(s) {
    return (s || "").toLowerCase().trim();
}

/* =========================
   FAQ: 特定问题 → 固定答案
========================= */
function matchFAQ(text) {
    const q = normalize(text);
    let best = null;

    for (const item of faq) {
        const kws = item.triggers?.keywords || [];
        if (kws.some(k => q.includes(normalize(k)))) {
            if (!best || item.priority > best.priority) best = item;
        }
    }
    return best;
}

/* =========================
   分类识别（轻量）
========================= */
function detectCategory(text) {
    const t = normalize(text);
    if (t.match(/(rent|housing|evict|住|房|租)/)) return "housing_assistance";
    if (t.match(/(medical|hospital|clinic|医|病)/)) return "healthcare_support";
    if (t.match(/(cash|financial|income|钱|经济)/)) return "financial_assistance";
    if (t.match(/(elder|senior|老人|长者)/)) return "elderly_support";
    return null;
}

/* =========================
   Scheme 检索
========================= */
function scoreScheme(s, query) {
    const hay = normalize(
        `${s.name_en} ${s.name_zh} ${s.summary_en} ${s.summary_zh}`
    );
    const terms = normalize(query).split(/\s+/);
    let score = 0;
    for (const t of terms) {
        if (t.length > 1 && hay.includes(t)) score += 2;
    }
    if (s.official_links?.length) score += 1;
    return score;
}

function retrieveSchemes(query, category, k = 5) {
    return SCHEMES
        .filter(s => !category || s.category === category)
        .map(s => ({ s, score: scoreScheme(s, query) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(x => x.s);
}

/* =========================
   对话主逻辑
========================= */
export function nextTurn({ lang = "en", state, userText }) {
    const zh = lang === "zh";
    const text = userText.trim();

    /* 0️⃣ FAQ 优先 */
    const faqHit = matchFAQ(text);
    if (faqHit) {
        const answer = zh ? faqHit.answer_zh : faqHit.answer_en;
        const links =
            faqHit.links?.length
                ? "\n\n" +
                (zh ? "相关官方链接：" : "Official links:") +
                "\n" +
                faqHit.links.map(l => `- ${l}`).join("\n")
                : "";

        return {
            reply: answer + links,
            patch: {},
            recommendations: [],
            sensitiveSuggested: faqHit.tags?.includes("urgent")
        };
    }

    /* 1️⃣ 普通检索 */
    const category = detectCategory(text);
    const schemes = retrieveSchemes(text, category);

    if (schemes.length > 0) {
        const intro = zh
            ? "根据你的问题，这里是一些可能相关的政府支持项目："
            : "Based on your question, here are some relevant government support schemes:";

        return {
            reply: intro,
            patch: {},
            recommendations: schemes,
            sensitiveSuggested: false
        };
    }

    /* 2️⃣ 兜底：引导入口 */
    const entryText = ENTRY_POINTS.map(p =>
        zh
            ? `- ${p.name_zh}: ${p.links?.[0] || ""}`
            : `- ${p.name_en}: ${p.links?.[0] || ""}`
    ).join("\n");

    const fallback = zh
        ? "我暂时没找到完全匹配的项目。你可以从以下官方入口开始查询，或换一个更简单的关键词再试：\n\n"
        : "I couldn’t find an exact match. You can start from these official entry points, or try a simpler keyword:\n\n";

    return {
        reply: fallback + entryText,
        patch: {},
        recommendations: [],
        sensitiveSuggested: false
    };
}
