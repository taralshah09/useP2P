/**
 * Writes text to the OS clipboard.
 *
 * Must be called from within a user gesture (e.g. a click handler): browsers
 * block programmatic clipboard writes outside a gesture, and iOS Safari is
 * especially strict. The caller (the Copy button) satisfies that requirement.
 *
 * Tries the async Clipboard API first (secure contexts), then falls back to a
 * hidden-textarea + execCommand('copy') for older browsers. Returns whether
 * the write actually succeeded so the UI only shows "Copied" on success.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  // Preferred path: async Clipboard API, available in secure contexts.
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }

  // Legacy fallback: select a hidden textarea and execCommand('copy').
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
