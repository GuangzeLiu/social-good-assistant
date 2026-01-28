import { useMemo, useState } from "react";
import { LANGS } from "./data/languages";
import { t } from "./utils/i18n";
import { nextTurn } from "./utils/dialogEngine";

function Bubble({ role, children }) {
    const isUser = role === "user";
    return (
        <div
            style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                margin: "10px 0"
            }}
        >
            <div
                style={{
                    maxWidth: 760,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid #e2e2e2",
                    background: isUser ? "#f5f5f5" : "#fff",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45
                }}
            >
                {children}
            </div>
        </div>
    );
}

function SchemeCard({ lang, scheme }) {
    const title = lang === "zh" ? scheme.name_zh : scheme.name_en;
    const summary = lang === "zh" ? scheme.summary_zh : scheme.summary_en;
    const elig = (lang === "zh" ? scheme.eligibility_zh : scheme.eligibility_en) || [];
    const apply = (lang === "zh" ? scheme.how_to_apply_zh : scheme.how_to_apply_en) || [];
    const links = scheme.official_links || [];

    return (
        <div
            style={{
                border: "1px solid #e6e6e6",
                borderRadius: 14,
                padding: 12,
                background: "#fff"
            }}
        >
            <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
            <div style={{ marginTop: 8, color: "#444" }}>{summary}</div>

            <div style={{ marginTop: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 800, marginTop: 8 }}>
                    {lang === "zh" ? "资格（简化）" : "Eligibility (simplified)"}
                </div>
                <ul style={{ margin: "6px 0 0 18px" }}>
                    {elig.map((x, i) => (
                        <li key={i}>{x}</li>
                    ))}
                </ul>

                <div style={{ fontWeight: 800, marginTop: 10 }}>
                    {lang === "zh" ? "申请方式" : "How to apply"}
                </div>
                <ol style={{ margin: "6px 0 0 18px" }}>
                    {apply.map((x, i) => (
                        <li key={i}>{x}</li>
                    ))}
                </ol>

                {links.length > 0 && (
                    <>
                        <div style={{ fontWeight: 800, marginTop: 10 }}>
                            {lang === "zh" ? "官方链接" : "Official links"}
                        </div>
                        <ul style={{ margin: "6px 0 0 18px" }}>
                            {links.map((u) => (
                                <li key={u}>
                                    <a href={u} target="_blank" rel="noreferrer">
                                        {u}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </div>
    );
}

function EscalationModal({ open, lang, onClose, onSubmit }) {
    const [name, setName] = useState("");
    const [contact, setContact] = useState("");
    const [summary, setSummary] = useState("");

    if (!open) return null;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16
            }}
        >
            <div
                style={{
                    width: "min(720px, 100%)",
                    background: "#fff",
                    borderRadius: 16,
                    border: "1px solid #ddd"
                }}
            >
                <div style={{ padding: 16, borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{t(lang, "ticketTitle")}</div>
                    <div style={{ marginTop: 6, color: "#555" }}>{t(lang, "ticketHint")}</div>
                </div>

                <div style={{ padding: 16, display: "grid", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>{t(lang, "name")}</span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={{ padding: 10, borderRadius: 12, border: "1px solid #ccc" }}
                        />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>{t(lang, "contact")}</span>
                        <input
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            style={{ padding: 10, borderRadius: 12, border: "1px solid #ccc" }}
                        />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>{t(lang, "summary")}</span>
                        <textarea
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            rows={4}
                            style={{ padding: 10, borderRadius: 12, border: "1px solid #ccc" }}
                        />
                    </label>
                </div>

                <div
                    style={{
                        padding: 16,
                        borderTop: "1px solid #eee",
                        display: "flex",
                        gap: 10,
                        justifyContent: "flex-end"
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 12,
                            border: "1px solid #ccc",
                            background: "#fff"
                        }}
                    >
                        {t(lang, "cancel")}
                    </button>
                    <button
                        onClick={() => onSubmit({ name, contact, summary })}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 12,
                            border: "1px solid #111",
                            background: "#111",
                            color: "#fff"
                        }}
                    >
                        {t(lang, "submit")}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const [lang, setLang] = useState("zh"); // default zh to match your screenshot
    const [input, setInput] = useState("");
    const [openEsc, setOpenEsc] = useState(false);

    const [dialogState, setDialogState] = useState({
        step: "start",
        category: null,
        profile: {},
        preQuery: ""
    });
    const [recommendations, setRecommendations] = useState([]);

    // ✅ messages store i18nKey for system messages so they always render with current lang
    const [messages, setMessages] = useState(() => [{ role: "assistant", i18nKey: "welcome" }]);

    const quickPrompts = useMemo(() => {
        return lang === "zh"
            ? [
                "我需要经济援助（financial aid）",
                "我想申请住房补助/租房补贴（housing grant）",
                "看病太贵了，有没有医疗补贴（medical help）",
                "我是长者，需要生活支持/照护资源",
                "我收到驱逐通知/今天没地方住（紧急）"
            ]
            : [
                "I need financial aid",
                "Looking for a housing grant / rental support",
                "Medical bills are too expensive — any subsidies?",
                "I’m a senior and need support / caregiving resources",
                "I received an eviction notice / no place to stay today (urgent)"
            ];
    }, [lang]);

    function push(role, content) {
        setMessages((prev) => [...prev, { role, content }]);
    }

    function pushKey(role, i18nKey) {
        setMessages((prev) => [...prev, { role, i18nKey }]);
    }

    function send(text) {
        const q = (text ?? input).trim();
        if (!q) return;

        push("user", q);
        setInput("");

        const res = nextTurn({ lang, state: dialogState, userText: q });

        // ✅ support both reply (string) and replyKey (system i18n)
        if (res.replyKey) {
            pushKey("assistant", res.replyKey);
        } else {
            push("assistant", res.reply);
        }

        setDialogState((prev) => ({ ...prev, ...(res.patch || {}) }));
        setRecommendations(res.recommendations || []);
    }

    function submitTicket(payload) {
        setOpenEsc(false);
        const id = "T-" + Math.random().toString(16).slice(2, 8).toUpperCase();
        const msg =
            lang === "zh"
                ? `已创建工单：${id}\n姓名：${payload.name || "（未填）"}\n联系方式：${payload.contact || "（未填）"}\n描述：${payload.summary || "（未填）"}\n\n${t(lang, "ticketCreated")}`
                : `Ticket created: ${id}\nName: ${payload.name || "(not provided)"}\nContact: ${payload.contact || "(not provided)"}\nSummary: ${payload.summary || "(not provided)"}\n\n${t(lang, "ticketCreated")}`;
        push("assistant", msg);
    }

    return (
        <div style={{ minHeight: "100vh" }}>
            <style>{`
        .container { width: min(96vw, 1600px); margin: 0 auto; padding: 16px; }
        .layout { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-top: 14px; }
        @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
      `}</style>

            <div className="container">
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap"
                    }}
                >
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 900 }}>{t(lang, "title")}</div>
                        <div style={{ marginTop: 4, color: "#555" }}>{t(lang, "subtitle")}</div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontWeight: 700 }}>{t(lang, "language")}</span>
                            <select
                                value={lang}
                                onChange={(e) => setLang(e.target.value)}
                                style={{
                                    padding: "8px 10px",
                                    borderRadius: 12,
                                    border: "1px solid #ccc"
                                }}
                            >
                                {LANGS.map((l) => (
                                    <option key={l.code} value={l.code}>
                                        {l.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <button
                            onClick={() => setOpenEsc(true)}
                            style={{
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid #111",
                                background: "#111",
                                color: "#fff"
                            }}
                        >
                            {t(lang, "escalate")}
                        </button>
                    </div>
                </div>

                <div
                    style={{
                        marginTop: 12,
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center"
                    }}
                >
                    <div style={{ fontWeight: 800, color: "#333" }}>{t(lang, "suggested")}:</div>
                    {quickPrompts.map((p) => (
                        <button
                            key={p}
                            onClick={() => send(p)}
                            style={{
                                padding: "8px 10px",
                                borderRadius: 999,
                                border: "1px solid #ddd",
                                background: "#fff"
                            }}
                        >
                            {p}
                        </button>
                    ))}
                </div>

                <div className="layout">
                    <div
                        style={{
                            background: "#fff",
                            border: "1px solid #e5e5e5",
                            borderRadius: 16,
                            padding: 14,
                            display: "flex",
                            flexDirection: "column"
                        }}
                    >
                        <div style={{ height: "60vh", overflow: "auto", paddingRight: 6 }}>
                            {messages.map((m, i) => (
                                <Bubble key={i} role={m.role}>
                                    {m.i18nKey ? t(lang, m.i18nKey) : m.content}
                                </Bubble>
                            ))}
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={t(lang, "placeholder")}
                                onKeyDown={(e) => e.key === "Enter" && send()}
                                style={{
                                    flex: 1,
                                    padding: "12px 12px",
                                    borderRadius: 14,
                                    border: "1px solid #ccc"
                                }}
                            />
                            <button
                                onClick={() => send()}
                                style={{
                                    padding: "12px 14px",
                                    borderRadius: 14,
                                    border: "1px solid #111",
                                    background: "#111",
                                    color: "#fff"
                                }}
                            >
                                {t(lang, "send")}
                            </button>
                        </div>
                    </div>

                    <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{t(lang, "panelTitle")}</div>

                        {recommendations.length === 0 ? (
                            <div
                                style={{
                                    padding: 12,
                                    borderRadius: 14,
                                    border: "1px dashed #d9d9d9",
                                    color: "#666",
                                    background: "#fff"
                                }}
                            >
                                {t(lang, "emptyPanel")}
                            </div>
                        ) : (
                            recommendations.map((s) => <SchemeCard key={s.id} lang={lang} scheme={s} />)
                        )}
                    </div>
                </div>
            </div>

            <EscalationModal
                open={openEsc}
                lang={lang}
                onClose={() => setOpenEsc(false)}
                onSubmit={submitTicket}
            />
        </div>
    );
}
