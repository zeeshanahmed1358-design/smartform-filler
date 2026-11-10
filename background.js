/* =========================================
   SMARTFORM FILLER - BACKGROUND SERVICE
   Firefox + Chrome compatibility
========================================= */

"use strict";

/* -----------------------------------------
   BROWSER API COMPATIBILITY
----------------------------------------- */

const ext = globalThis.browser || globalThis.chrome;

if (!ext) {
    throw new Error("SmartForm Filler: Browser extension API unavailable.");
}

/* -----------------------------------------
   TOOLBAR ICONS
----------------------------------------- */

const ON = {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png"
};

const OFF = {
    16: "icons/idle16.png",
    32: "icons/idle32.png",
    48: "icons/idle48.png",
    128: "icons/idle128.png"
};

/* -----------------------------------------
   CONTENT SCRIPT BRIDGE
----------------------------------------- */

const RUN = mode => {
    if (typeof window.__FA_RUN === "function") {
        return window.__FA_RUN(mode);
    }

    return null;
};

/* -----------------------------------------
   TOOLBAR STATUS
----------------------------------------- */

function paint(tabId, total) {
    const detected = total > 0;

    ext.action.setIcon({
        tabId,
        path: detected ? ON : OFF
    }).catch(() => {});

    ext.action.setBadgeBackgroundColor({
        tabId,
        color: "#0f766e"
    }).catch(() => {});

    ext.action.setBadgeText({
        tabId,
        text: detected ? String(Math.min(total, 99)) : ""
    }).catch(() => {});

    ext.action.setTitle({
        tabId,
        title: detected
            ? `SmartForm Filler: form detected (${total} fields)`
            : "SmartForm Filler: no form detected"
    }).catch(() => {});
}

/* -----------------------------------------
   FRAME STATUS MANAGEMENT
----------------------------------------- */

async function setStatus(tabId, frameId, count) {
    if (typeof tabId !== "number") return;

    const key = "st" + tabId;

    try {
        const stored = await ext.storage.session.get(key);
        const data = stored[key] || {};

        data[frameId] = Math.max(
            0,
            Number.parseInt(count, 10) || 0
        );

        await ext.storage.session.set({
            [key]: data
        });

        const total = Object.values(data).reduce(
            (sum, value) => sum + (Number(value) || 0),
            0
        );

        paint(tabId, total);

    } catch (error) {
        console.error("SmartForm status error:", error);
    }
}

/* -----------------------------------------
   TAB NAVIGATION
----------------------------------------- */

ext.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") {
        ext.storage.session.remove("st" + tabId)
            .catch(() => {});

        paint(tabId, 0);
    }
});

ext.tabs.onRemoved.addListener(tabId => {
    ext.storage.session.remove("st" + tabId)
        .catch(() => {});
});

/* -----------------------------------------
   MESSAGE HANDLER
----------------------------------------- */

ext.runtime.onMessage.addListener(
    (msg, sender, sendResponse) => {

        if (!msg || !msg.type) return;

        /* Form detection status */

        if (msg.type === "status" && sender.tab) {
            setStatus(
                sender.tab.id,
                sender.frameId || 0,
                msg.count
            );

            return;
        }

        /* AI field matching */

        if (msg.type === "llm") {
            llmMap(msg)
                .then(result => sendResponse(result))
                .catch(error => {
                    console.error("SmartForm AI error:", error);

                    sendResponse({
                        map: {},
                        error: error.message || String(error)
                    });
                });

            return true;
        }
    }
);

/* =========================================
   KEYBOARD SHORTCUT
========================================= */

ext.commands.onCommand.addListener(async command => {

    if (command !== "fill-form") return;

    try {
        const [tab] = await ext.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tab || !tab.id) return;

        const results = await ext.scripting.executeScript({
            target: {
                tabId: tab.id,
                allFrames: true
            },
            func: RUN,
            args: ["fill"]
        });

        const filledCount = (results || [])
            .flatMap(result => {
                return result.result?.groups || [];
            })
            .reduce((total, group) => {
                const matches = Array.isArray(group.matches)
                    ? group.matches
                    : [];

                return total + matches.filter(
                    match => match.applied
                ).length;
            }, 0);

        await ext.action.setBadgeBackgroundColor({
            tabId: tab.id,
            color: "#0f766e"
        });

        await ext.action.setBadgeText({
            tabId: tab.id,
            text: filledCount > 0
                ? "✓" + Math.min(filledCount, 99)
                : "0"
        });

        /* Restore detected-field counter */

        setTimeout(async () => {
            try {
                const key = "st" + tab.id;

                const stored = await ext.storage.session.get(key);
                const data = stored[key] || {};

                const total = Object.values(data).reduce(
                    (sum, value) => sum + (Number(value) || 0),
                    0
                );

                paint(tab.id, total);

            } catch (error) {
                console.error("Status restore error:", error);
            }
        }, 3500);

    } catch (error) {
        console.error("SmartForm keyboard fill error:", error);
    }
});

/* =========================================
   OPTIONAL AI FIELD MATCHING
========================================= */

/*
   Privacy:
   Only field labels, options, form title
   and profile keys are sent to Anthropic.

   Actual profile values are never sent.
*/

async function llmMap({ title, fields, keys }) {

    try {

        /* Load settings */

        const stored = await ext.storage.local.get("settings");
        const settings = stored.settings || {};

        if (
            !settings.useLLM ||
            !settings.apiKey ||
            !String(settings.apiKey).trim()
        ) {
            return { map: {} };
        }

        if (!Array.isArray(fields) || !Array.isArray(keys)) {
            return {
                map: {},
                error: "Invalid field or profile key data."
            };
        }

        /* Prepare AI prompt */

        const prompt = `
A web form is titled: "${String(title || "")}".

Match each form field to the user's profile key that it is asking for.

Instructions:
- Understand field meanings and synonyms in any language.
- Use the form title as additional context.
- Be conservative. If no key clearly fits, return null.
- A wrong match is worse than no match.
- Do not match fields about another person (father, spouse,
  emergency contact, reference) to the user's own data unless
  a profile key explicitly identifies that person.
- Do not invent profile keys.
- Return valid JSON only.

Fields (id, label, kind, options):
${JSON.stringify(fields)}

Profile keys:
${JSON.stringify(keys)}

Return ONLY this JSON structure:
{
  "field_id": "profile_key",
  "another_field_id": null
}
`;

        /* Send request to Anthropic */

        const response = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
                method: "POST",

                headers: {
                    "content-type": "application/json",
                    "x-api-key": settings.apiKey,
                    "anthropic-version": "2023-06-01",
                    "anthropic-dangerous-direct-browser-access": "true"
                },

                body: JSON.stringify({
                    model: settings.model || "claude-haiku-5-5",
                    max_tokens: 1500,

                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ]
                })
            }
        );

        /* Read API response */

        const data = await response.json();

        if (!response.ok) {
            const message =
                data.error?.message ||
                `Anthropic API error (${response.status})`;

            throw new Error(message);
        }

        /* Extract response text */

        const responseText = (data.content || [])
            .filter(block => block.type === "text")
            .map(block => block.text || "")
            .join("")
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();

        if (!responseText) {
            throw new Error("AI returned an empty response.");
        }

        /* Parse JSON safely */

        let map;

        try {
            map = JSON.parse(responseText);
        } catch {
            const start = responseText.indexOf("{");
            const end = responseText.lastIndexOf("}");

            if (start === -1 || end === -1 || end <= start) {
                throw new Error("AI returned invalid JSON.");
            }

            map = JSON.parse(
                responseText.substring(start, end + 1)
            );
        }

        if (
            !map ||
            typeof map !== "object" ||
            Array.isArray(map)
        ) {
            throw new Error("AI returned an invalid field mapping.");
        }

        return { map };

    } catch (error) {

        console.error("SmartForm AI matching failed:", error);

        return {
            map: {},
            error: error.message || "AI matching failed."
        };
    }
}
