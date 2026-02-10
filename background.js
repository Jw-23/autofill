// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ai-autofill-run",
    title: "🤖 AI Auto Fill",
    contexts: ["editable", "page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ai-autofill-run") {
    chrome.tabs.sendMessage(tab.id, { action: "run-autofill" });
  }
});

/**
 * Handle Remote API Requests (OpenAI-compatible)
 * Functions as a proxy to avoid CORS issues in content scripts and secure key management.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch-models') {
    handleFetchModels(request).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }
  if (request.action === 'ai-analyze') {
    handleAIAnalyze(request).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (request.action === 'ai-generate-structured') {
    handleAIGenerateStructured(request).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * Streaming Support using runtime.connect
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "ai-stream") {
    port.onMessage.addListener(async (msg) => {
      if (msg.action === "stream-completion") {
        try {
          const { apiUrl, apiKey, model, userPrompt, systemPrompt } = msg;
          const baseUrl = apiUrl.replace(/\/$/, '');
          const endpoint = `${baseUrl}/chat/completions`;

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
                { role: 'user', content: userPrompt }
              ],
              stream: true
            })
          });

          if (!response.ok) {
            const err = await response.text();
            port.postMessage({ error: `API Error: ${response.status} ${err}` });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
              const cleanedLine = line.replace(/^data: /, "").trim();
              if (cleanedLine === "" || cleanedLine === "[DONE]") continue;

              try {
                const parsed = JSON.parse(cleanedLine);
                const chunk = parsed.choices?.[0]?.delta?.content;
                if (chunk) {
                  port.postMessage({ chunk });
                }
              } catch (e) {
                console.error("Error parsing stream chunk", e);
              }
            }
          }
          port.postMessage({ done: true });
        } catch (error) {
          port.postMessage({ error: error.message });
        }
      }
    });
  }
});

async function handleFetchModels({ apiUrl, apiKey }) {
  // Typical OpenAI endpoint
  const start = Date.now();
  // Remove trailing slashes and ensure /v1/models or just /models depending on user input
  // Assumption: User provides base URL (e.g. https://api.openai.com/v1)
  const baseUrl = apiUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/models`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    // OpenAI returns { data: [{id: '...'}, ...] }
    // Some compatible APIs might differ, but this is standard.
    return { models: data.data || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleAIAnalyze({ apiUrl, apiKey, model, systemPrompt, userPrompt }) {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  try {
    const body = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1 // Deterministic
    };

    // Only force json_object if prompt mentions JSON
    if (systemPrompt.toLowerCase().includes('json') || userPrompt.toLowerCase().includes('json')) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      // If the error is specifically about json_object mode, retry without it
      const errText = await response.text();
      if (errText.includes('json_object') || errText.includes('response_format')) {
        delete body.response_format;
        const retryResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        if (retryResponse.ok) {
          const data = await retryResponse.json();
          return { result: data.choices[0].message.content };
        }
      }
      throw new Error(`API Completion Failed ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) throw new Error('No content in response');
    
    return { result: data.choices[0].message.content };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleAIGenerateStructured({ apiUrl, apiKey, model, userPrompt, schema, schemaName }) {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  // 1. Prepare Structured Output (Strict Schema) Configuration
  const structuredBody = {
    model: model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Generate data according to the schema.' },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema: schema
      }
    }
  };

  // 2. Prepare JSON Mode Fallback Configuration
  const fallbackBody = {
    model: model,
    messages: [
      { 
        role: 'system', 
        content: `You are a helpful assistant. You must output valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}` 
      },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" }
  };

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // Attempt 1: Try Strict Structured Outputs
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(structuredBody)
    });

    if (response.ok) {
        const data = await response.json();
        return { result: data.choices[0].message.content };
    }

    // Attempt 2: If 400 Bad Request, try JSON Mode
    if (response.status === 400) {
        // const errText = await response.text(); 
        // console.warn('Background: Structured Output failed, falling back to JSON Mode. Error:', errText);
        
        const retryResponse = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(fallbackBody)
        });

        if (!retryResponse.ok) {
           const retryErr = await retryResponse.text();
           throw new Error(`Fallback API Error ${retryResponse.status}: ${retryErr}`);
        }
        
        const data = await retryResponse.json();
        return { result: data.choices[0].message.content };
    } else {
        const errText = await response.text();
        throw new Error(`API Error ${response.status}: ${errText}`); 
    }

  } catch (error) {
    return { error: error.message };
  }
}
