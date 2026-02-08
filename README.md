# AI Autofill - Smart Form Completion via Local AI

AI Autofill is an intelligent form-filling extension powered by Chrome's built-in local AI (**Gemini Nano**). Unlike traditional tools that rely on fragile `name` or `id` attributes, this extension understands the **semantic context** of form fields—analyzing surrounding text, labels, and hints to accurately determine which piece of information belongs where.

---

## 🌟 Key Features

- **Local-First AI**: Powered by Gemini Nano within Chrome. All processing happens on your machine. Data stays private and never leaves your device.
- **Semantic Understanding**: Intelligent enough to navigate nested structures, complex layouts, and ambiguous field labels.
- **Confidential Mode**: Mask sensitive entries (e.g., ID numbers, private keys) in the settings UI. AI can still fill them securely.
- **Multi-language Support**: Interface is fully localized in English and Chinese.
- **Debug Insights**: Toggle debug logs to see exactly what context AI extracts and how it matches your data.

---

## 📸 Preview

> *Screenshots placeholder*
> ![Options Page](icons/icon_512x512.png) 

![real ui](program_cut.png)

---

## 🛠️ System Requirements (Critical)

This extension utilizes experimental Chrome AI APIs. It requires:

1.  **Browser**: Chrome v127 or higher.
2.  **Platform**: **Windows, macOS, or Linux** (Mobile browsers are not supported).
3.  **Hardware**: Recommended 8GB+ RAM and approx. 2GB disk space for the model.

### How to Enable Gemini Nano:

1.  Navigate to `chrome://flags`.
2.  Enable the following flags:
    -   `Prompt API for Gemini Nano` -> Set to **Enabled**.
    -   `Enables optimization guide on device` -> Set to **Enabled BypassPrefRequirement**.
3.  Restart Chrome.
4.  Go to `chrome://components`. Find **Optimization Guide On Device Model** and click **Check for update** to ensure the model is fully downloaded.

---

## 🚀 Getting Started

1.  **Configuration**: Right-click the extension icon and go to **Options**. Add your personal data (Name, Phone, Address, GitHub, etc.).
2.  **Define Descriptions**: The **Description** field is vital for AI accuracy. *Example*: For an address, use "My primary shipping address for home deliveries."
3.  **Auto-fill**: On any web form, right-click and select **🤖 Run AI Autofill**.
4.  **Instant Stop**: If the AI is currently processing, clicking the same menu item again will immediately abort the task.

---

## 📁 Project Structure

- `manifest.json`: Extension manifest (V3)
- `content/`: Core logic (AI Management, DOM Detection, Input Filling)
- `options/`: Settings UI
- `_locales/`: Internationalization (i18n) support
- `background.js`: Service worker handling context menus

---

## ⚠️ Important Notes

- **Privacy**: Your data is processed locally. No personal information is sent to Google or any third-party servers.
- **Accuracy**: The AI follows a "Zero Tolerance" policy. It will skip ambiguous fields, search bars, captchas, and password fields to prevent incorrect entries.

---

## 📄 License

MIT
