// content/ai.js

const AIManager = {
  session: null,
  matchCache: new Map(), // New Cache: context -> matchedKey

  async getSession() {
    if (this.session) return this.session;

    // Check if the AI API is available
    let AIProvider = null;
    if (typeof ai !== 'undefined' && ai.languageModel) {
      AIProvider = ai.languageModel;
    } else if (typeof LanguageModel !== 'undefined') {
      AIProvider = LanguageModel;
    }

    if (!AIProvider) {
      console.warn('AIManager: Chrome Built-in AI (Gemini Nano) is not available.');
      return null;
    }

    try {
      const config = {
        systemPrompt: `STRICT MATCHING RULE: You are a precise form-filling assistant.
        Your goal is to map each form input to exactly ONE personal data key from the provided list, or return null if no certain match exists.
        Decision Logic:
        1. Select the key whose Description has the strongest semantic match.
        2. If NO key is a strong match (i.e., confidence < 90%), return null.
        3. Never fill passwords or sensitive info.`
      };

      const status = await AIProvider.availability(config);

      if (status === 'no') {
        console.warn('AIManager: Built-in AI is not supported in this environment.');
        return null;
      }

      if (status === 'after-download') {
        console.warn('AIManager: AI model needs download. Please check chrome://components "Optimization Guide On Device Model"');
        return null;
      }

      // Get system default parameters
      const params = await AIProvider.params();

      this.session = await AIProvider.create({
        ...config,
        temperature: params.defaultTemperature,
        topK: params.defaultTopK
      });

      this.session.addEventListener('error', (e) => {
        this.session = null;
      });

      return this.session;
    } catch (e) {
      console.error('AIManager: Failed during session setup:', e);
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
    if (isDebug) console.log('AIManager: identifyFieldsBatch start', { provider: settings.provider, fieldsCount: fields.length });

    // 1. Check Cache for local provider (caching is most beneficial for local)
    if (settings.provider === 'local') {
      const results = [];
      const fieldsToMatch = [];
      const isFullSet = availableKeys.some(k => k.isSecret);

      for (const field of fields) {
        // Cache key includes sensitivity level to avoid using partial-match results for full-match requests
        const cacheKey = `${isFullSet ? 'F' : 'P'}:${field.context}`;
        if (this.matchCache.has(cacheKey)) {
          results.push({ inputId: field.id, matchedKey: this.matchCache.get(cacheKey), cached: true });
        } else {
          fieldsToMatch.push(field);
        }
      }

      if (fieldsToMatch.length === 0) {
        if (isDebug) console.log('AIManager [Local Cache]: All fields resolved from cache');
        return results;
      }

      // If we have some fields to match, proceed with those
      const newMatches = await this._identifyFieldsBatchLocal(fieldsToMatch, availableKeys, isDebug);
      
      // Update cache
      for (const match of newMatches) {
        const field = fieldsToMatch.find(f => f.id === match.inputId);
        if (field) {
          const cacheKey = `${isFullSet ? 'F' : 'P'}:${field.context}`;
          this.matchCache.set(cacheKey, match.matchedKey);
        }
      }

      return [...results, ...newMatches];
    }

    if (settings.provider === 'remote') {
      if (!settings.apiKey) {
        console.warn('AIManager: Remote provider selected but no API Key configured.');
        return [];
      }
      return this.identifyingFieldsBatchRemote(fields, availableKeys, settings, isDebug);
    }

    return [];
  },

  async _identifyFieldsBatchLocal(fields, availableKeys, isDebug = false) {
    // Default: Local Gemini Nano
    const baseSession = await this.getSession();
    if (!baseSession) {
      if (isDebug) console.warn('AIManager: Local session not available');
      return [];
    }

    if (isDebug) console.log('AIManager [Local]: Starting matching for fields:', fields);

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

    const fieldsList = fields.map(f => `Field ID ${f.id}: "${f.context}"`).join('\n');

    const prompt = `Match these form fields to the keys below.
Available Keys:
${keysDescription}

Fields:
${fieldsList}

Task: Return a JSON object with "matches" array. Each match has "inputId" and "matchedKey" (string or null). No conversational text.`;

    try {
      let result;
      try {
        result = await session.prompt(prompt, {
          responseConstraint: schema,
        });
      } catch (e) {
        if (isDebug) console.warn('AIManager: Prompt with schema failed, retrying simple...', e);
        result = await session.prompt(prompt + "\nOutput raw JSON.");
      }

      if (isDebug) console.log('AIManager: Raw AI response:', result);

      // Clean up potential markdown formatting if any
      const cleanedResult = result.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanedResult);
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
