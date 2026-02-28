# VEYES — LLM Bridge System Design
> **Role:** Sits between Speechmatics STT output and Browserbase/Playwright browser automation.

---

## Architecture Position

```
[Speechmatics SDK] → raw transcript
        ↓
[LLM Bridge] ← this system
        ↓
[Action Router] → navigate / click / type / memory / TTS
```

---

## System Prompt

```
You are VoiceNav, a voice-to-browser automation bridge for blind and visually impaired users.

Your job is to receive a raw voice transcript (from Speechmatics STT) and convert it into:
1. A SHORT action summary (what the user wants to do, 1 sentence max)
2. A structured NEXT STEP (one atomic browser action or clarification request)

RULES:
- Be concise. The user hears everything you say. No walls of text.
- Extract one action at a time. Do not chain multiple steps in a single response.
- If the intent is ambiguous, ask ONE clarifying question — never assume.
- Before any purchase or irreversible action, always confirm explicitly.
- Ignore filler words ("um", "uh", "like", "you know"), false starts, and repetitions.
- Normalize synonyms: "go to", "open", "navigate to" → navigate action.
- Never invent data the user didn't provide (dates, prices, names).

OUTPUT FORMAT (strict JSON):
{
  "summary": "<1-sentence description of what the user wants>",
  "intent": "<categorized intent: navigate | search | click | type | select | confirm | cancel | recall | clarify | done>",
  "confidence": <0.0–1.0>,
  "action": {
    "tool": "<navigate | click | type_text | select_option | get_page_content | memory_read | memory_write | speak | clarify>",
    "params": { <tool-specific parameters> }
  },
  "speak": "<short phrase to speak aloud to user while action executes, or null>",
  "requires_confirmation": <true | false>
}

TOOL PARAMETER SCHEMAS:
- navigate:      { "url": string }
- click:         { "description": string, "selector_hint": string | null }
- type_text:     { "field_description": string, "value": string, "press_enter": boolean }
- select_option: { "field_description": string, "value": string }
- memory_read:   { "query": string }
- memory_write:  { "thread_id": string, "entry": { "type": string, "data": object } }
- speak:         { "message": string }
- clarify:       { "question": string, "options": string[] | null }

CONFIDENCE THRESHOLDS:
- >= 0.85 → Execute directly
- 0.60–0.84 → Execute but speak a brief confirmation
- < 0.60 → Use clarify tool, never guess

CONFIRMATION REQUIRED FOR:
- Any checkout or purchase step
- Entering payment information
- Submitting a form
- Cancelling or modifying an existing booking
```

---

## User Message Structure

Every call to the LLM bridge must include:

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "TRANSCRIPT:\n\"<raw speechmatics output>\"\n\nPAGE CONTEXT:\n<simplified DOM snapshot or 'none'>\n\nSESSION STATE:\n<current_step, pending_task, last_action_result>"
    }
  ]
}
```

### Example Input

```json
{
  "role": "user",
  "content": "TRANSCRIPT:\n\"um I want to uh book a flight from Paris Orly to San Francisco tomorrow after 10am direct flights only under 500 dollars\"\n\nPAGE CONTEXT:\nnone\n\nSESSION STATE:\n{ \"current_step\": \"idle\", \"pending_task\": null, \"last_action\": null }"
}
```

### Example Output

```json
{
  "summary": "Book a direct flight from Paris Orly to San Francisco tomorrow after 10am for under $500.",
  "intent": "navigate",
  "confidence": 0.95,
  "action": {
    "tool": "navigate",
    "params": {
      "url": "https://www.skyscanner.com/transport/flights/ory/sfo/"
    }
  },
  "speak": "Got it — searching for direct flights from Orly to San Francisco tomorrow after 10am, under $500.",
  "requires_confirmation": false
}
```

---

## Multi-Turn Conversation Flow

The LLM bridge receives the full conversation history on every call (stateless pattern):

```python
messages = [
    {
        "role": "system",
        "content": SYSTEM_PROMPT  # defined above
    },
    # --- previous turns ---
    {
        "role": "user",
        "content": "TRANSCRIPT: \"search for flights paris to san francisco\"\nPAGE CONTEXT: none\nSESSION STATE: {current_step: idle}"
    },
    {
        "role": "assistant",
        "content": '{"summary":"Search flights Paris to SFO","intent":"navigate","confidence":0.9,"action":{"tool":"navigate","params":{"url":"https://skyscanner.com"}},"speak":"Navigating to Skyscanner.","requires_confirmation":false}'
    },
    # --- current turn (Skyscanner loaded, new input) ---
    {
        "role": "user",
        "content": "TRANSCRIPT: \"the united one at 420\"\nPAGE CONTEXT: {title: 'Skyscanner Results', elements: [{id:1,tag:'button',text:'United $420 - 2:30pm',selector:'.flight-card-1'}]}\nSESSION STATE: {current_step: 'viewing_results', last_action: 'search_complete'}"
    }
]
```

---

## Intent Classification Reference

| User says | Mapped intent | Tool |
|-----------|--------------|------|
| "go to / open / navigate to X" | navigate | navigate |
| "search for / find / look up X" | search | navigate (with search URL) |
| "click / press / select X" | click | click |
| "type / enter / write X" | type | type_text |
| "choose / pick X" | select | select_option |
| "yes / go ahead / confirm / do it" | confirm | — (resolves pending confirmation) |
| "no / stop / wait / cancel" | cancel | speak |
| "what do I have pending / any tasks" | recall | memory_read |
| "tomorrow / next week / in 2 days" | → normalize to ISO date | injected into params |

---

## Session State Object

Pass this in every `SESSION STATE:` block:

```typescript
interface SessionState {
  current_step: 
    | "idle"
    | "navigating"
    | "filling_form"
    | "viewing_results"
    | "awaiting_confirmation"
    | "booking_in_progress"
    | "task_complete";
  
  pending_task: {
    type: "flight_booking" | "purchase" | "form_fill" | null;
    params: Record<string, any>;
    last_action: string | null;
  } | null;

  last_action_result: {
    tool: string;
    status: "ok" | "error" | "blocked" | "not_found";
    detail: string | null;
  } | null;
}
```

---

## Error Handling: What the LLM Should Return

| Scenario | Expected LLM response |
|----------|----------------------|
| STT produced garbled text | `"intent": "clarify"`, `"confidence": < 0.6` |
| User interrupted mid-sentence | Parse the last complete phrase; set `confidence` accordingly |
| Ambiguous target ("the first one") | `"tool": "clarify"`, ask which option |
| Page context doesn't match intent | `"tool": "get_page_content"` to refresh DOM first |
| Dangerous action without confirmation | Force `"requires_confirmation": true` regardless of user phrasing |

---

## Code Integration (Python / Pipecat)

```python
import anthropic
import json

SYSTEM_PROMPT = """..."""  # full prompt above

async def process_transcript(
    transcript: str,
    page_context: dict | None,
    session_state: dict,
    conversation_history: list[dict]
) -> dict:
    """
    Bridge between Speechmatics output and browser action router.
    Returns a structured action dict.
    """
    client = anthropic.AsyncAnthropic()

    user_message = f"""TRANSCRIPT:
\"{transcript}\"

PAGE CONTEXT:
{json.dumps(page_context, indent=2) if page_context else "none"}

SESSION STATE:
{json.dumps(session_state, indent=2)}"""

    messages = conversation_history + [
        {"role": "user", "content": user_message}
    ]

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,          # Keep short — this is a bridge, not a writer
        system=SYSTEM_PROMPT,
        messages=messages,
        temperature=0,           # Deterministic for tool routing
    )

    raw = response.content[0].text.strip()
    
    # Strip markdown fences if model wraps in ```json
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    
    action = json.loads(raw)

    # Safety gate: force confirmation for irreversible actions
    IRREVERSIBLE = {"checkout", "payment", "submit", "purchase", "book_now"}
    if any(k in json.dumps(action).lower() for k in IRREVERSIBLE):
        action["requires_confirmation"] = True

    return action


async def route_action(action: dict, browser_session, tts_service, memory_service):
    """
    Routes the LLM bridge output to the correct downstream service.
    """
    tool = action["action"]["tool"]
    params = action["action"]["params"]

    # Speak the status while acting
    if action.get("speak"):
        await tts_service.speak(action["speak"])

    # Confirmation gate
    if action.get("requires_confirmation"):
        confirmed = await tts_service.ask_confirmation(action["speak"])
        if not confirmed:
            await tts_service.speak("Okay, I've stopped. What would you like to do instead?")
            return

    # Route to tool
    match tool:
        case "navigate":
            return await browser_session.navigate(params["url"])
        case "click":
            return await browser_session.click(params["selector_hint"], params["description"])
        case "type_text":
            return await browser_session.type_text(params["field_description"], params["value"], params.get("press_enter", False))
        case "get_page_content":
            return await browser_session.get_page_content()
        case "memory_read":
            return await memory_service.read(params["query"])
        case "memory_write":
            return await memory_service.write(params["thread_id"], params["entry"])
        case "clarify":
            await tts_service.speak(params["question"])
            return None
        case "speak":
            await tts_service.speak(params["message"])
            return None
```

---

## Key Design Decisions

**Why `temperature=0`?**
The bridge is a router, not a writer. Deterministic output is safer for tool calling — we never want the model to randomly rephrase an action in a way that breaks JSON parsing.

**Why one action at a time?**
Voice UX requires the user to stay in the loop. Multi-step chaining silently executes several actions before the user can intervene. Single-step → speak → next keeps the user in control.

**Why include PAGE CONTEXT in every call?**
The same phrase means different things on different pages. "Click the first one" on a search results page means something completely different from "click the first one" on a confirmation dialog. Page context resolves ambiguity without extra round-trips.

**Why pass SESSION STATE?**
The LLM is stateless. Without knowing `current_step: "awaiting_confirmation"`, it can't distinguish "yes" as a confirmation from "yes" as part of a new command like "yes book the United flight".
