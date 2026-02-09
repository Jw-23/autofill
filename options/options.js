// options/options.js
import { updateLanguageUI } from './modules/i18n.js';
import { initVault, renderList } from './modules/vault.js';
import { initWhitelist, renderWhitelist } from './modules/whitelist.js';
import { initSettings } from './modules/settings.js';
import { checkAndDownloadAI } from './modules/ui.js';

/**
 * Main entry point for the options page.
 * Orchestrates the initialization of all modules.
 */
async function init() {
  console.log('Options: Initializing application modules...');
  
  // 1. Initialize language and then render data-dependent components
  await updateLanguageUI(async () => {
    await renderList();
    await renderWhitelist();
  });
  
  // 2. Initialize event listeners for different sections
  initVault();
  initWhitelist();
  initSettings();
  
  // 3. Perform background checks
  checkAndDownloadAI();
  
  console.log('Options: Initialization complete.');
}

// Start the app
init();
