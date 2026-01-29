import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { LANGS } from "./utils/languages";
import { t } from "./utils/i18n";
import {
    initDialogState,
    getInitialAssistantMessage,
    handleUserText,
    handleAction
} from "./utils/dialogEngine";

function uid() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ChatBubble({ role, text, ts }) {
    return (
        <div className={`bubbleRow ${role === "user" ? "right" : "left"}`}>
            <div className={`bubble ${role}`}>
                <div className="bubbleText">{text}</div>
                <div className="bubbleMeta">{ts}</div>
            </div>
        </div>
    );
}

function LinkList({ links }) {
    if (!links?.length) return null;
    return (
        <div className="links">
            <div className="linksLabel">Official links</div>
            <ul>
                {links.map((u) => (
                    <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer">
                            {u}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function SchemeCard({ card, lang }) {
    const focus = card.focus || "overview";
    const isEntry = focus === "entry";

    return (
        <div className="card">
            <div className="cardTitle">{card.title}</div>

            {card.summary ? <div className="cardSummary">{card.summary}</div> : null}

            {isEntry && card.contacts ? (
                <div className="cardBlock">
                    <div className="cardBlockTitle">{lang === "zh" ? "联系方式" : "Contacts"}</div>
                    <div className="kv">
                        {card.contacts.hotline ? (
                            <div>
                                <span className="k">{lang === "zh" ? "热线" : "Hotline"}:</span>{" "}
                                <span className="v">{card.contacts.hotline}</span>
                            </div>
                        ) : null}
                        {card.contacts.email ? (
                            <div>
                                <span className="k">{lang === "zh" ? "邮箱" : "Email"}:</span>{" "}
                                <span className="v">{card.contacts.email}</span>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {!isEntry && (focus === "overview" || focus === "eligibility") ? (
                card.eligibility?.length ? (
                    <div className="cardBlock">
                        <div className="cardBlockTitle">{lang === "zh" ? "资格要点" : "Eligibility"}</div>
                        <ul>
                            {card.eligibility.slice(0, 4).map((x, i) => (
                                <li key={i}>{x}</li>
                            ))}
                        </ul>
                    </div>
                ) : null
            ) : null}

            {!isEntry && (focus === "overview" || focus === "steps") ? (
                card.steps?.length ? (
                    <div className="cardBlock">
                        <div className="cardBlockTitle">{lang === "zh" ? "申请步骤" : "How to apply"}</div>
                        <ol>
                            {card.steps.slice(0, 4).map((x, i) => (
                                <li key={i}>{x}</li>
                            ))}
                        </ol>
                    </div>
                ) : null
            ) : null}

            <LinkList links={card.links} />
        </div>
    );
}

function QuickReplies({ items, onClick }) {
    if (!items?.length) return null;
    return (
        <div className="quickReplies" aria-label="Quick replies">
            {items.map((it) => (
                <button
                    key={it.id}
                    className="chip"
                    onClick={() => onClick(it)}
                    type="button"
                    title={it.label}
                >
                    {it.label}
                </button>
            ))}
        </div>
    );
}

export default function App() {
    const [lang, setLang] = useState("en");

    // Accessibility toggles
    const [seniorMode, setSeniorMode] = useState(false);     // large text + larger tap targets
    const [highContrast, setHighContrast] = useState(false); // strong contrast palette

    const [dlg, setDlg] = useState(() => initDialogState("en"));

    const [messages, setMessages] = useState(() => {
        const m = getInitialAssistantMessage("en");
        return [
            {
                id: uid(),
                role: "assistant",
                text: m.text,
                cards: m.cards || [],
                quickReplies: m.quickReplies || [],
                ts: new Date().toLocaleTimeString()
            }
        ];
    });

    const [input, setInput] = useState("");
    const bottomRef = useRef(null);

    const lastAssistant = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant") return messages[i];
        }
        return null;
    }, [messages]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Language change: restart cleanly in the new language (avoid mixed-language flow)
    useEffect(() => {
        const s = initDialogState(lang);
        const m = getInitialAssistantMessage(lang);
        setDlg(s);
        setMessages([
            {
                id: uid(),
                role: "assistant",
                text: m.text,
                cards: m.cards || [],
                quickReplies: m.quickReplies || [],
                ts: new Date().toLocaleTimeString()
            }
        ]);
        setInput("");
    }, [lang]);

    function pushAssistantMessage(m) {
        if (!m) return;
        setMessages((prev) => [
            ...prev,
            {
                id: uid(),
                role: "assistant",
                text: m.text,
                cards: m.cards || [],
                quickReplies: m.quickReplies || [],
                ts: new Date().toLocaleTimeString()
            }
        ]);
    }

    function pushUserMessage(text) {
        setMessages((prev) => [
            ...prev,
            {
                id: uid(),
                role: "user",
                text,
                cards: [],
                quickReplies: [],
                ts: new Date().toLocaleTimeString()
            }
        ]);
    }

    function onSend() {
        const text = input.trim();
        if (!text) return;

        pushUserMessage(text);
        setInput("");

        const { state: nextState, message } = handleUserText(dlg, text);
        setDlg(nextState);
        pushAssistantMessage(message);
    }

    function onQuickReply(it) {
        pushUserMessage(it.sendText || it.label);
        const { state: nextState, message } = handleAction(dlg, it.action);
        setDlg(nextState);
        if (message) pushAssistantMessage(message);
    }

    function doRestart() {
        pushUserMessage(lang === "zh" ? "重新开始" : "Restart");
        const { state: nextState, message } = handleAction(dlg, { type: "RESTART" });
        setDlg(nextState);
        pushAssistantMessage(message);
    }

    function doUrgent() {
        pushUserMessage(lang === "zh" ? "我现在很紧急" : "This is urgent");
        const { state: nextState, message } = handleAction(dlg, { type: "URGENT" });
        setDlg(nextState);
        pushAssistantMessage(message);
    }

    const rootClass = [
        "page",
        seniorMode ? "senior" : "",
        highContrast ? "contrast" : ""
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={rootClass}>
            <header className="topbar">
                <div className="brand">
                    <div className="title">{t(lang, "title")}</div>

                </div>

                <div className="actions">
                    <button className="btn ghost" onClick={doUrgent} type="button">
                        {t(lang, "urgent")}
                    </button>

                    {/* Accessibility toggles */}
                    <button
                        className="btn ghost"
                        onClick={() => setSeniorMode((v) => !v)}
                        type="button"
                        aria-pressed={seniorMode}
                        title={seniorMode ? t(lang, "normalText") : t(lang, "largeText")}
                    >
                        {seniorMode ? t(lang, "normalText") : t(lang, "largeText")}
                    </button>

                    <button
                        className="btn ghost"
                        onClick={() => setHighContrast((v) => !v)}
                        type="button"
                        aria-pressed={highContrast}
                        title={highContrast ? t(lang, "standardContrast") : t(lang, "highContrast")}
                    >
                        {highContrast ? t(lang, "standardContrast") : t(lang, "highContrast")}
                    </button>

                    <select
                        className="select"
                        value={lang}
                        onChange={(e) => setLang(e.target.value)}
                        aria-label="Language"
                    >
                        {LANGS.map((x) => (
                            <option key={x.code} value={x.code}>
                                {x.label}
                            </option>
                        ))}
                    </select>

                    <button className="btn" onClick={doRestart} type="button">
                        {t(lang, "reset")}
                    </button>
                </div>
            </header>

            <main className="main">
                <div className="chat">
                    <div className="chatBody">
                        {messages.map((m) => (
                            <div key={m.id}>
                                <ChatBubble role={m.role} text={m.text} ts={m.ts} />

                                {/* assistant cards inline */}
                                {m.role === "assistant" && m.cards?.length ? (
                                    <div className="cardList">
                                        {m.cards.map((c) => (
                                            <SchemeCard key={c.id} card={c} lang={lang} />
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>

                    {/* single quick reply bar */}
                    <div className="chatFooter">
                        <QuickReplies items={lastAssistant?.quickReplies} onClick={onQuickReply} />

                        <div className="composer">
                            <input
                                className="input"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={t(lang, "placeholder")}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") onSend();
                                }}
                            />
                            <button className="btn" onClick={onSend} type="button">
                                {t(lang, "send")}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
