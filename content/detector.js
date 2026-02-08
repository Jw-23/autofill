// content/detector.js

const InputDetector = {
  /**
   * Finds all fillable inputs on the page.
   * @returns {HTMLInputElement[]}
   */
  getVisibleInputs() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'));
    return inputs.filter(input => {
      const style = window.getComputedStyle(input);
      return style.display !== 'none' && style.visibility !== 'hidden' && !input.disabled && !input.readOnly;
    });
  },

  /**
   * Gathers context for a specific input.
   * Looks at placeholder, name, id, and recursively searches for the first parent with text.
   * @param {HTMLInputElement} input 
   * @returns {string}
   */
  getInputContext(input) {
    let context = [];
    
    if (input.placeholder) context.push(`Placeholder: ${input.placeholder}`);
    if (input.name) context.push(`Name: ${input.name}`);
    if (input.id) context.push(`ID: ${input.id}`);
    if (input.type) context.push(`Type: ${input.type}`);

    // Recursive search for the first parent that contains meaningful text
    let parentText = "";
    let current = input.parentElement;
    
    while (current && current !== document.body) {
      // Use a clone to get text without the input element's own contribution if needed, 
      // but innerText of parent usually captures the label/instruction accurately.
      const text = current.innerText?.trim();
      if (text && text.length > 0) {
        parentText = text;
        break;
      }
      current = current.parentElement;
    }

    if (parentText) {
      // Limit context length to avoid overwhelming the AI prompt
      context.push(`Text Context: ${parentText.replace(/\s+/g, ' ').substring(0, 300)}`);
    }

    return context.join(' | ');
  }
};
