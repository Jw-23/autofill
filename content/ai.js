// content/ai.js

const AIManager = {
  session: null,

  async getSession() {
    if (this.session) return this.session;
    
    // Check if the AI API is available
    const AIProvider = typeof ai !== 'undefined' && ai.languageModel ? ai.languageModel : (typeof LanguageModel !== 'undefined' ? LanguageModel : null);
    
    if (!AIProvider) {
      console.warn('Chrome Prompt API (Gemini Nano) is not available.');
      return null;
    }

    try {
      this.session = await AIProvider.create({
        systemPrompt: `CRITICAL: IF YOU ARE NOT 100% SURE ABOUT A MATCH, YOU MUST RETURN NULL. DO NOT FILL. IT IS BETTER TO DO NOTHING THAN TO FILL INCORRECTLY.

You are a strict and precise form-filling assistant. Your sole purpose is to accurately map web input fields to user-provided data keys.

Matching Rules:
1. **Zero Tolerance for Errors**: This is your highest priority. Return null for any ambiguity.
2. **Context Disambiguation**: 
   - Distinction is key. "Phone" != "Address". "Email" != "Name".
   - Watch out for "Address" words (Street, City, Zip, Shipping) versus "Phone" words (Mobile, Cell, +1).
   - Watch out for "Name" words (Full Name, Last Name) versus "Username" or "Login".
3. **Ignore Irrelevant Fields**: If the input appears to be a Search bar, Captcha, Password, Credit Card Number, or OTP, return null immediately.`,
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
      Identify the specific key from the list above that belongs in this input field. 
      IF YOU ARE AT ALL UNCERTAIN, RETURN NULL.
      
      [Input Context]: "${contextText}"
      
      [User's Personal Data Keys]:
      ${keysDescription}
      
      [Decision Logic]:
      - **Rule #1**: Match ONLY if highly certain. Otherwise, return null.
      - **Rule #2**: Rely heavily on the 'Description' field to understand what each key represents.
      - If the input context aligns with a key's Description (e.g., context "Where to deliver" matches description "Home shipping address"), that is a match.
      - If the context mentions "Mobile" and you have a "phone" key, match it.
      - If the context is generic (e.g., just "Type here") or unrelated (e.g., "Search", "Code"), return null.
      - If the input requires an address but you only have a phone number, return null.
      
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
