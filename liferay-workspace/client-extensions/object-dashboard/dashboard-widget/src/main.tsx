// REWRITTEN after the original was lost — behaviour reconstructed from how
// Dashboard.tsx consumes instanceId and from FOLLOW-UPS.md #3, which records
// that an attribute-less widget falls back to a per-page-load counter.
import { createRoot, type Root } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { readDeclaredConfig } from "./declared";
// ?inline gives us the CSS as a string instead of a separate asset. The CX
// manifest ships only object-dashboard.js, so an emitted .css file would never
// be loaded and the widget would render unstyled.
import styles from "./styles.css?inline";

// Liferay gives every widget instance its own element but not, by default, a
// stable id. Without one, two widgets on a page would share a localStorage key.
// An explicit instance-id attribute (e.g. from a fragment wrapper) is stable
// across reloads; the counter fallback is only unique within one page load,
// which is why FOLLOW-UPS #3 wants real server-side persistence.
let autoInstance = 0;

// Injected once per page, not per widget instance.
function ensureStyles() {
  const id = "object-dashboard-styles";
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = styles;
  document.head.appendChild(el);
}

class ObjectDashboardElement extends HTMLElement {
  private root: Root | null = null;

  connectedCallback() {
    if (this.root) return;
    ensureStyles();

    const instanceId =
      this.getAttribute("instance-id") ?? `auto-${++autoInstance}`;

    this.root = createRoot(this);
    this.root.render(
      <Dashboard instanceId={instanceId} declared={readDeclaredConfig(this)} />
    );
  }

  disconnectedCallback() {
    // Defer: Liferay moves elements around the DOM during page edits, and
    // unmounting synchronously inside the callback throws in React 18.
    const root = this.root;
    this.root = null;
    if (root) setTimeout(() => root.unmount(), 0);
  }
}

if (!customElements.get("object-dashboard")) {
  customElements.define("object-dashboard", ObjectDashboardElement);
}
