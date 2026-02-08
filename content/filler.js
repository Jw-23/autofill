// content/filler.js

const InputFiller = {
  /**
   * Fills an input element with a value and triggers necessary events.
   * @param {HTMLInputElement} input 
   * @param {string} value 
   */
  fill(input, value) {
    if (!input || value === undefined || value === null) return;
    
    input.value = value;
    
    // Trigger events so the page notices the change
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }
};
