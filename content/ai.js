// content/ai.js

const AIManager = {
  session: null,

  async getSession() {
    if (this.session) return this.session;

    // Check if the AI API is available
    const AIProvider = typeof ai !== 'undefined' && ai.languageModel ? ai.languageModel : (typeof LanguageModel !== 'undefined' ? LanguageModel : null);

    if (!AIProvider) {
      alert('Chrome Built-in AI (Gemini Nano) is not available. Please enable it in chrome://flags.');
      return null;
    }

    try {
      // Get system default parameters first
      const params = await AIProvider.params();
      
      const config = {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      };

      // Check availability with the same options as create/prompt
      const status = await AIProvider.availability(config);

      if (status === 'after-download') {
        alert('AI 模型正在下载中，请稍后再试（下载进度可在 chrome://components 中查看 "Optimization Guide On Device Model"）。');
        return null;
      } else if (status === 'no') {
        alert('当前浏览器环境不支持内置 AI，请确认已开启相关实验性功能并重启浏览器。');
        return null;
      }

      const systemPromptContent = `STRICT MATCHING RULE: You are a precise form-filling assistant.
      Your goal is to map each form input to exactly ONE personal data key from the provided list, or return null if no certain match exists.

      Decision Logic:
      1. **Evaluation**: For each form input, analyze its context (labels, placeholders, names) and compare it against the "Description" of all available personal data keys.
      2. **Strict Selection**: Select the key whose Description has the strongest semantic match.
      3. **Skip Instruction**: If NO key is a strong match (i.e., confidence < 90%), you MUST return null for that field. Do not guess. Do not halluncinate.
      4. **De-duplication**: If multiple fields look similar, use the global context to differentiate them.
      5. **Language**: All analysis and matchedKey output MUST be in English. The matchedKey must be an exact string match of a provided keyname.
      6. **Safety**: Never fill passwords, captchas, bank/card info, or OTPs.

      Failure to find a 100% match => RETURN NULL.`;

      this.session = await AIProvider.create({
        ...config,
        initialPrompts: [{
          role: 'system',
          content: systemPromptContent
        }],
        temperature: params.defaultTemperature,
        topK: params.defaultTopK
      });

      // Monitor session for unexpected loss
      this.session.addEventListener('error', () => {
        this.session = null;
      });

      return this.session;
    } catch (e) {
      console.error('Failed to create AI session:', e);
      return null;
    }
  },

  async identifyingFieldsBatchRemote(fields, availableKeys, settings, isDebug) {
    const { apiUrl, apiKey, model } = settings;
    
    // Construct System Prompt
    const systemPrompt = `You are a precise form-filling assistant (Autofill AI).
Your task is to analyze form fields and map them to the best matching key from the user's personal data vault.

[Personal Data Vault]:
${JSON.stringify(availableKeys.map(k => ({ key: k.keyname, desc: k.description })), null, 2)}

[Matching Rules]:
1. You MUST return a valid JSON object with a "matches" array.
2. Each match: { "inputId": <int>, "matchedKey": "<keyname>" }.
3. "matchedKey" MUST be one of the keys from the vault.
4. If a field matches nothing with high confidence (>90%), omit it or do not include a matchedKey.
5. STRICTLY output valid JSON only. Do not use block-code markdown.`;

    // Construct User Prompt
    // Limit context length if needed, but for batch it should be okay.
    // Format: "FieldID: <id>, Context: <context>"
    const fieldDescriptions = fields.map(f => `FieldID: ${f.id}\nContext: ${f.context}`).join('\n---\n');
    const userPrompt = `Analyze the following fields and return the results as a JSON object:\n\n${fieldDescriptions}`;

    if (isDebug) console.log('AIManager [Remote]: Sending request to background...', { model, fieldCount: fields.length });

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'ai-analyze',
            apiUrl, 
            apiKey,
            model,
            systemPrompt,
            userPrompt
        });

        if (response.error) {
            console.error('AIManager [Remote]: API Error:', response.error);
            return [];
        }

        // Expected result is a JSON string or object
        let content = response.result;
        if (typeof content === 'string') {
            // Cleanup markdown code blocks if present
            content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            try {
                const parsed = JSON.parse(content);
                if (isDebug) console.log('AIManager [Remote]: Parsed response:', parsed);
                return parsed.matches || [];
            } catch (e) {
                console.error('AIManager [Remote]: Failed to parse JSON response', content);
                return [];
            }
        }
        return [];

    } catch (e) {
        console.error('AIManager [Remote]: Transport Error:', e);
        return [];
    }
  },

  /**
   * Identifies matches for multiple fields in a single AI call.
   * @param {Array} fields - Array of {id, context}
   * @param {Array} availableKeys - Array of {keyname, description}
   * @param {Boolean} isDebug - Whether to log debug information
   * @returns {Promise<Array>} - Array of {inputId, matchedKey}
   */
  async identifyFieldsBatch(fields, availableKeys, isDebug = false) {
    // Check Provider Setting
    const settings = await StorageManager.getAISettings();
    if (settings.provider === 'remote') {
        if (!settings.apiKey) {
            console.warn('AIManager: Remote provider selected but no API Key configured.');
            return [];
        }
        return this.identifyingFieldsBatchRemote(fields, availableKeys, settings, isDebug);
    }

    // Default: Local Gemini Nano
    const baseSession = await this.getSession();
    if (!baseSession) return [];

    if (isDebug) console.log('AIManager: Starting batch matching for fields:', fields);

    let session;
    try {
      session = await baseSession.clone();
    } catch (e) {
      session = baseSession;
    }

    const schema = {
      type: "object",
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              inputId: { type: "integer" },
              matchedKey: {
                type: "string",
                nullable: true,
                description: "The keyname from Personal Data Keys, or null if no match."
              }
            },
            required: ["inputId", "matchedKey"]
          }
        }
      },
      required: ["matches"]
    };

    const keysDescription = availableKeys.map(k => {
      const sensitivity = k.isSecret ? " [HIGH SENSITIVITY]" : "";
      return `- Key: "${k.keyname}" | Description: "${k.description}"${sensitivity}`;
    }).join('\n');

    const fieldsList = fields.map(f => `[Input ID: ${f.id}] Context: "${f.context}"`).join('\n');

    const prompt = `
      [Target]: Map each input context to the BEST fitting Personal Data Key or return null.
      
      [User's Personal Data Keys]:
      ${keysDescription}
      
      [Current Form Inputs to Process]:
      ${fieldsList}
      
      [Matching Constraints]:
      1. "matchedKey" must be the exact keyname or null.
      2. "inputId" must be the exact integer provided.
      3. If a field's context is ambiguous or doesn't fit any description, set matchedKey to null.
      4. OUTPUT LANGUAGE: ENGLISH ONLY.
    `;

    try {
      const result = await session.prompt(prompt, {
        responseConstraint: schema,
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      });

      if (isDebug) console.log('AIManager: Raw AI response:', result);

      const parsed = JSON.parse(result);
      const matches = parsed.matches || [];
      
      if (isDebug) console.log('AIManager: Parsed matches:', matches);
      return matches;
    } catch (e) {
      console.error('AI batch matching failed:', e);
      return [];
    } finally {
      if (session && session !== baseSession && typeof session.destroy === 'function') {
        session.destroy();
      }
    }
  },

  /**
   * @deprecated Use identifyFieldsBatch for better context.
   */
  async identifyField(contextText, availableKeys) {
    const matches = await this.identifyFieldsBatch([{ id: 0, context: contextText }], availableKeys);
    return matches.length > 0 ? matches[0].matchedKey : null;
  }
};
