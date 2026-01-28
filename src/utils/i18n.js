export const UI = {
    en: {
        title: "Social Good Assistant (Singapore)",
        subtitle:
            "Simple keywords → guided questions → plain-language guidance → optional human escalation.",
        placeholder:
            'Type a keyword (e.g., "financial aid", "housing grant", "medical help")...',
        send: "Send",
        language: "Language",
        suggested: "Quick prompts",
        panelTitle: "Top Recommendations",
        escalate: "Escalate to human",
        ticketTitle: "Escalation to Human Support",
        ticketHint:
            "For urgent/complex cases, we create a ticket for a human caseworker follow-up.",
        name: "Name",
        contact: "Email or phone",
        summary: "Brief summary",
        submit: "Submit",
        cancel: "Cancel",
        ticketCreated: "Ticket created. A caseworker will follow up.",
        emptyPanel: "Recommendations will appear here after the guided questions.",

        // ✅ dynamic system messages (fix language switching)
        welcome:
            'Hi! Type a simple keyword like "financial aid", "housing grant", "medical help", or "support for seniors". I’ll ask a few questions, then provide plain-language guidance and suggest human escalation when needed.',
        resetHint:
            'If you want another service type, type a new keyword (e.g., "financial aid", "housing grant", "medical help", "support for seniors").'
    },

    zh: {
        title: "社会公益对话助手（新加坡）",
        subtitle: "输入简单关键词 → 引导追问 → 简化指引 → 必要时转人工。",
        placeholder: "输入关键词（例如：经济援助 / 住房补助 / 医疗补贴）…",
        send: "发送",
        language: "语言",
        suggested: "快捷示例",
        panelTitle: "推荐结果",
        escalate: "转人工支持",
        ticketTitle: "转人工支持（社工/工作人员）",
        ticketHint: "紧急/复杂情况将创建工单，由工作人员跟进。",
        name: "姓名",
        contact: "邮箱或电话",
        summary: "简要描述",
        submit: "提交",
        cancel: "取消",
        ticketCreated: "工单已创建，工作人员将联系你。",
        emptyPanel: "完成引导问题后，这里会显示推荐结果。",

        // ✅ dynamic system messages (fix language switching)
        welcome:
            "你好！你可以输入简单关键词，比如：经济援助、住房补助、医疗补贴、长者支持。我会问几个问题，然后给你简化的申请指引，并在需要时建议转人工。",
        resetHint:
            "如果你还想了解其他服务类型，请输入新的关键词（例如：经济援助 / 住房补助 / 医疗补贴 / 长者支持）。"
    }
};

export const t = (lang, k) => UI[lang]?.[k] ?? UI.en[k] ?? k;
