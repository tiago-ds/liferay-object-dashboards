"""
Drives a headless Chrome over the DevTools protocol, signed in to the portal.

Used by brand.py (the style-book switch), which needs three awkward things: a browser that will accept a websocket
from us, a Liferay session, and something that answers the native dialogs
Liferay pops — an unanswered confirm() freezes the renderer and every command
after it times out.
"""

import json
import shutil
import subprocess
import tempfile
import time
import urllib.request

import websocket  # websocket-client

PORTAL = "http://localhost:8080"
USER = "test@liferay.com"
PASSWORD = "pw"
PORT = 9333

LOGIN_JS = """
(() => {
  const set = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const p = '_com_liferay_login_web_portlet_LoginPortlet_';
  const form = document.getElementById(p + 'loginForm');
  if (!form) return 'no-form';
  set(document.getElementById(p + 'login'), %s);
  set(document.getElementById(p + 'password'), %s);
  const btn = [...form.querySelectorAll('button,input[type=submit]')]
    .find(b => /sign in/i.test(b.textContent || b.value || ''));
  if (btn) { btn.click(); return 'clicked'; }
  form.submit();
  return 'submitted';
})()
"""


class Tab:
    """The handful of CDP calls these scripts need, over one websocket."""

    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=90)
        self.n = 0
        self.dialogs = []

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())

            # Liferay confirms destructive-looking actions with a native
            # confirm(). Nothing else on the connection is served until it is
            # answered, so answer it here rather than deadlocking.
            if msg.get("method") == "Page.javascriptDialogOpening":
                self.dialogs.append(msg["params"].get("message", ""))
                self.ws.send(json.dumps({
                    "id": 10_000 + len(self.dialogs),
                    "method": "Page.handleJavaScriptDialog",
                    "params": {"accept": True},
                }))
                continue

            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evaluate(self, expression):
        r = self.call("Runtime.evaluate", expression=expression,
                      returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def goto(self, url, settle=3.0):
        self.call("Page.navigate", url=url)
        time.sleep(settle)


class Browser:
    """A throwaway Chrome, cleaned up on exit."""

    def __init__(self, width=1680, height=1050, scale=2):
        self.profile = tempfile.mkdtemp(prefix="cdp-chrome-")
        self.proc = subprocess.Popen(
            ["google-chrome", "--headless=new", f"--remote-debugging-port={PORT}",
             f"--user-data-dir={self.profile}", "--no-first-run", "--hide-scrollbars",
             # Chrome refuses a DevTools websocket whose Origin it did not
             # expect, and websocket-client always sends one. Only this process
             # knows the port, so allowing it widens nothing.
             f"--remote-allow-origins=http://127.0.0.1:{PORT}",
             f"--window-size={width},{height}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        ws_url = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                    pages = [t for t in json.load(r) if t.get("type") == "page"]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws_url:
            self.close()
            raise RuntimeError("Chrome never opened a debugging port")

        self.tab = Tab(ws_url)
        self.tab.call("Page.enable")
        self.tab.call("Runtime.enable")
        self.tab.call("Emulation.setDeviceMetricsOverride", width=width,
                      height=height, deviceScaleFactor=scale, mobile=False)

    def sign_in(self):
        self.tab.goto(f"{PORTAL}/c/portal/login")
        if self.tab.evaluate(
                LOGIN_JS % (json.dumps(USER), json.dumps(PASSWORD))) == "no-form":
            raise RuntimeError("No login form — is the portal up?")
        time.sleep(5)
        if not self.tab.evaluate("window.Liferay && Liferay.ThemeDisplay.isSignedIn()"):
            raise RuntimeError("Sign-in did not take")

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def wait_for(tab, js, want, attempts=40, every=1.0):
    state = None
    for _ in range(attempts):
        state = tab.evaluate(js)
        if state == want:
            return state
        time.sleep(every)
    return state
