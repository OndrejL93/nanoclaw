#!/usr/bin/env node
// ask-groq — call Groq (llama-3.3-70b-versatile) with a prompt, print the response.
// Usage:
//   ask-groq "What is 15% of 847?"
//   echo "Translate to Spanish: Hello" | ask-groq
//   ask-groq < prompt.txt

import https from 'https';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  process.stderr.write('Error: GROQ_API_KEY is not set\n');
  process.exit(1);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

const prompt = process.argv[2] ? process.argv.slice(2).join(' ') : await readStdin();

if (!prompt) {
  process.stderr.write('Usage: ask-groq "<prompt>" or pipe prompt via stdin\n');
  process.exit(1);
}

const body = JSON.stringify({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: prompt }],
  stream: false,
});

const result = await new Promise((resolve, reject) => {
  const req = https.request({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        reject(new Error(`Groq API error ${res.statusCode}: ${raw.slice(0, 300)}`));
        return;
      }
      try {
        resolve(JSON.parse(raw).choices[0].message.content);
      } catch {
        reject(new Error(`Failed to parse Groq response: ${raw.slice(0, 300)}`));
      }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

process.stdout.write(result + '\n');
