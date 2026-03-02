---
name: groq
description: Delegate simple, self-contained tasks to Groq (llama-3.3-70b-versatile) for fast, free responses. Use proactively for translation, math, Q&A, and text summarization when no tools are needed.
allowed-tools: Bash(ask-groq:*)
---

# Groq via ask-groq

Groq runs DeepSeek-R1 (70B) at high speed, completely free. Use it proactively when the task is self-contained and doesn't require Bash, file access, or web browsing.

## When to use Groq

- **Translation**: Translate text between languages
- **Math**: Arithmetic, percentages, unit conversions, equations
- **Q&A**: Factual questions with a clear answer
- **Summarization**: Summarize text that you already have (not URLs)
- **Text generation**: Drafting short messages, rephrasing, grammar fixes
- **Code explanation**: Explain a snippet the user has pasted

## When NOT to use Groq

- Tasks that require running Bash commands or reading/writing files
- Browsing the web or fetching URLs (use `agent-browser` instead)
- Tasks that require memory of previous conversations
- Anything requiring tool use or structured output parsing

## Usage

```bash
# Simple question
ask-groq "What is 15% of 847?"

# Translation
ask-groq "Translate to French: Good morning, how are you?"

# Multi-line prompt via stdin
echo "Summarize this in one sentence: $(cat notes.txt)" | ask-groq

# Longer prompt as argument
ask-groq "Convert 72°F to Celsius and explain the formula"
```

## Notes

- Responses are plain text only — no tool calls or structured output
- `GROQ_API_KEY` must be set in the environment (injected automatically by NanoClaw)
- Exits non-zero on API error; check `$?` if scripting
- Free tier: 14,400 requests/day, 30 req/min
