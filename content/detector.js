// content/detector.js

const InputDetector = {
  /**
   * Finds all fillable inputs on the page.
   * @returns {HTMLInputElement[]}
   */
  getVisibleInputs() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]'));
    return inputs.filter(input => {
      const style = window.getComputedStyle(input);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
      const isEditable = input.isContentEditable || input.getAttribute('contenteditable') !== null;
      return isVisible && (isEditable || (!input.disabled && !input.readOnly));
    });
  },

  /**
   * Gathers context for a specific input.
   * Only looks at the textContent of the first parent that has text.
   * @param {HTMLInputElement} input 
   * @returns {string}
   */
  getInputContext(input) {
    // Recursive search for the first parent that contains meaningful text
    let parentText = "";
    let current = input.parentElement;
    
    while (current && current !== document.body) {
      // Use textContent as requested by user
      const text = current.textContent?.trim();
      
      // Validation: Must not be empty, not just numbers, and not just special characters
      if (text) {
        // Regex explanation:
        // [a-zA-Z\u4e00-\u9fa5] matches at least one letter (English or Chinese)
        // This effectively excludes strings composed entirely of digits or special symbols.
        const hasMeanigfulChar = /[a-zA-Z\u4e00-\u9fa5]/.test(text);
        
        if (hasMeanigfulChar) {
          parentText = text;
          break;
        }
      }
      current = current.parentElement;
    }

    if (parentText) {
      // Limit context length and clean up whitespace
      return parentText.replace(/\s+/g, ' ').substring(0, 300);
    }

    return "";
  }
};
