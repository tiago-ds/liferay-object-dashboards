"""
Switches the site's brand by marking a style book as the theme's default.

This is the gesture the talk makes on stage — Design -> Style Books -> ... ->
"Mark as Default for Dialect Theme" — and it is worth having as a script for
two reasons. It makes the before/after screenshots reproducible, and it is the
only way to perform it unattended: the menu item opens a native confirm(), and
an unanswered confirm() freezes the whole renderer, so a browser being driven
from outside simply stops responding. cdp.py answers it.

    python3 outfitter/brand.py "Coastal Drift"
    python3 outfitter/brand.py --show
"""

import sys
import time

from cdp import PORTAL, Browser

STYLE_BOOKS = (
    "/group/outfitter/~/control_panel/manage"
    "?p_p_id=com_liferay_style_book_web_internal_portlet_StyleBookPortlet"
    "&p_p_lifecycle=0"
)

LIST_JS = """
(() => [...document.querySelectorAll('.card')]
  .map(c => c.textContent.replace(/\\s+/g, ' ').trim())
  .filter(t => /Based on/.test(t)))()
"""

OPEN_MENU_JS = """
(() => {
  const card = [...document.querySelectorAll('.card')]
    .find(c => c.textContent.includes(%s));
  if (!card) return 'no-card';
  const t = card.querySelector('[aria-label="More actions"]');
  if (!t) return 'no-menu';
  t.click();
  return 'open';
})()
"""

CLICK_DEFAULT_JS = """
(() => {
  const item = [...document.querySelectorAll(
      '.dropdown-menu.show button, .dropdown-menu.show a')]
    .find(i => /^Mark as Default/.test(i.textContent.replace(/\\s+/g, ' ').trim()));
  if (!item) return 'no-item';
  item.click();
  return 'clicked';
})()
"""


def main():
    if len(sys.argv) != 2:
        sys.exit(f'usage: {sys.argv[0]} "<Style Book name>" | --show')

    with Browser() as b:
        b.sign_in()
        b.tab.goto(f"{PORTAL}{STYLE_BOOKS}", settle=4.0)

        books = b.tab.evaluate(LIST_JS) or []
        if sys.argv[1] == "--show":
            for t in books:
                print(t)
            return

        name = sys.argv[1]
        if not any(name in t for t in books):
            sys.exit(f"No style book named {name!r}. Found: {books}")

        opened = b.tab.evaluate(OPEN_MENU_JS % repr(name).replace("'", '"'))
        if opened != "open":
            sys.exit(f"Could not open the actions menu: {opened}")
        time.sleep(1.5)

        clicked = b.tab.evaluate(CLICK_DEFAULT_JS)
        if clicked != "clicked":
            sys.exit(f"Could not click Mark as Default: {clicked}")
        time.sleep(6)

        if b.tab.dialogs:
            print(f"confirmed: {b.tab.dialogs[-1]!r}")
        for t in b.tab.evaluate(LIST_JS) or []:
            print(t)


if __name__ == "__main__":
    main()
