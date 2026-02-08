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
      // Check capabilities for download status
      const capabilities = await AIProvider.capabilities();
      if (capabilities.available === 'after-download') {
        alert('AI 模型正在下载中，请稍后再试（下载进度可在 chrome://components 中查看 "Optimization Guide On Device Model"）。');
        return null;
      } else if (capabilities.available === 'no') {
        alert('当前浏览器环境不支持内置 AI，请确认已开启相关实验性功能。');
        return null;
      }

      this.session = await AIProvider.create({
        systemPrompt: `ABSOLUTE RULE: If there is ANY doubt, return null. Do not guess. It is always safer to do nothing than to fill incorrectly.

      You are a strict and precise form-filling assistant. Your only task is to select a single key from the user's data, or return null when not certain.

      Decision Policy (must follow):
      1. **Zero Tolerance**: If you are not 100% certain, return null.
      2. **Strict Semantic Matching**: Only match if the input context has a strong, direct, and unambiguous semantic relationship with a key's Description.
      3. **Low Association => Null**: If the context's relevance to ALL available keys is low or average, you MUST return null. Do not try to pick the "best fit" among weak candidates.
      4. **No Weak Matches**: Generic labels like "Input", "Type here", "Required", "Field", or a short/ambiguous context => return null.
      5. **Disambiguation Required**:
         - "Phone" != "Address". "Email" != "Name". "Username" != "Full name".
         - Address clues: Street, City, Zip, Postal, Shipping, Delivery.
         - Phone clues: Mobile, Cell, Tel, +country code.
      6. **Never Fill These**: Search, Captcha, Password, Verification code/OTP, Credit Card, Bank, Security answers.

      If the context is unclear, return null.`,
        expectedOutputs: [{
          type: 'text',
          languages: ['en']
        }]
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

  /**
   * Identifies which personal info key fits the input context.
   * @param {string} contextText - Text surrounding the input (label, placeholders, nearby text)
   * @param {Array} availableKeys - List of {keyname, description}
   * @returns {Promise<string|null>} - The matching keyname or null
   */
  async identifyField(contextText, availableKeys) {
    const baseSession = await this.getSession();
    if (!baseSession) return null;

    let session;
    try {
      // Use clone() to keep the system prompt but avoid history buildup
      // This ensures each field identification is independent and consistent.
      session = await baseSession.clone();
    } catch (e) {
      console.warn('Session clone failed, using base session (history might affect results):', e);
      session = baseSession;
    }

    const schema = {
      type: "object",
      properties: {
        matchedKey: {
          type: "string",
          nullable: true,
          description: "The keyname that best matches the input context, or null if no match is found."
        }
      },
      required: ["matchedKey"]
    };

    const keysDescription = availableKeys.map(k => `- Key: "${k.keyname}" | Description: "${k.description}"`).join('\n');
    
    const prompt = `
      [Task]:
      Choose the single best key ONLY if you are absolutely certain. If there is any doubt, return null.
      
      [Input Context]: "${contextText}"
      
      [User's Personal Data Keys]:
      ${keysDescription}
      
      [Decision Logic]:
      - **Rule #1**: Only match when the context is explicit and unambiguous.
      - **Rule #2**: Perform a relevance check. If the "form context" does not have a high degree of correlation with any "key description", return null.
      - **Rule #3**: Do not pick the "closest match" if that match is still weak.
      - **Rule #4**: If multiple keys could fit, return null.
      - Examples:
        - Context "Ship to" + description "Home shipping address" => match (High Correlation).
        - Context "Mobile" + description "Personal phone" => match (High Correlation).
        - Context "Please enter info" or "Attribute" => return null (Low Correlation).
        - Context "Search" or "OTP" => return null (Explicit Exclusion).
      
      Response (JSON with matchedKey or null):
    `;

    try {
      // Chrome 137+ supports responseConstraint for structured output
      const result = await session.prompt(prompt, {
        responseConstraint: schema
      });
      
      const parsed = JSON.parse(result);
      return parsed.matchedKey;
    } catch (e) {
      console.error('AI matching failed:', e);
      // If the prompt fails, the base session might be corrupted, so we clear it
      if (e.message?.toLowerCase().includes('session') || e.message?.toLowerCase().includes('aborted')) {
        this.session = null;
      }
      return null;
    } finally {
      // If we used a cloned session, destroy it to free memory
      if (session && session !== baseSession && typeof session.destroy === 'function') {
        session.destroy();
      }
    }
  }
};
