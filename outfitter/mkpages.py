#!/usr/bin/env python3
"""Writes the Outfitter site's page definitions.

    python3 outfitter/mkpages.py

Page definitions are deep JSON with a lot of repeated scaffolding — a Row needs
three viewport entries whether or not you care about tablets, and every Fragment
carries the same twenty style keys. Hand-writing that is how a comma ends up in
the wrong object and the whole site initialization aborts, so the structure is
built here and the JSON is output.

Nothing in this file is clever: it is the shapes Liferay's own site initializers
use, named.
"""
import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = (ROOT / "liferay-workspace" / "client-extensions" / "outfitter-site" /
        "site-initializer")

WIDGET_ERC = "[$CLIENT_EXTENSION_ENTRY_ERC:LXC:object-dashboard-custom-element$]"
DOC = "/site-initializer/documents/group"

# Deterministic ids: a fresh uuid4 on every run would make every regeneration a
# whole-file diff, which hides the change you actually made.
_NS = uuid.UUID("2f1c4a90-5d3e-4b7a-9c21-6e8f0a7b1d44")
def eid(name: str) -> str:
    return str(uuid.uuid5(_NS, name))


# --------------------------------------------------------------- values
def text(value):
    return {"text": {"value_i18n": {"en_US": value}}}


def link(href, label=None):
    v = {"fragmentLink": {"value": {"href": {"value": href}}}}
    if label is not None:
        v["text"] = {"value_i18n": {"en_US": label}}
    return v


def image(filename):
    return {"backgroundFragmentImage": {"url": {"mapping": {
        "fieldKey": "FileEntry_previewImage",
        "itemReference": {
            "className": "com.liferay.portal.kernel.repository.model.FileEntry",
            "classPK": f"[#DOCUMENT_FILE_ENTRY_ID:{DOC}/{filename}#]",
        },
    }}}}


def mapped(field_key, source="CollectionItem"):
    """A value taken from the collection item or display page item, not authored."""
    return {"text": {"mapping": {
        "fieldKey": field_key,
        "itemReference": {"contextSource": source},
    }}}


# -------------------------------------------------------------- elements
VIEWPORTS = ["landscapeMobile", "portraitMobile", "tablet"]


def frag(key, name, fields=None, config=None, style=None, css=None, children=None,
         link_to=None):
    # A fragment's key is its FOLDER NAME under fragments/group/<collection>/
    # fragments/ — not the collection name, and not a prefixed combination of
    # the two (FragmentsImporterImpl._getKey). A key that resolves to nothing
    # does not warn: the column renders empty, which looks exactly like the
    # page definition failing to import.
    #
    # Liferay's own fragments (BASIC_COMPONENT-*) are global; ours live in this
    # site, so they need the site's group key to be found.
    fragment = {"key": key}
    if not key.startswith("BASIC_COMPONENT-"):
        fragment["siteKey"] = "[$GROUP_KEY$]"
    definition = {
        "fragment": fragment,
        "fragmentConfig": config or {},
        "fragmentFields": [{"id": k, "value": v} for k, v in (fields or {}).items()],
        "fragmentStyle": style or {},
        "indexed": True,
    }
    if css:
        definition["customCSS"] = css
    if link_to:
        definition["fragmentLink"] = {"value": {"href": {"value": link_to}}}
    el = {"definition": definition, "id": eid(name), "type": "Fragment"}
    if children is not None:
        # Whatever goes into a fragment's <lfr-drop-zone> must be wrapped in a
        # FragmentDropZone element. Hanging the children straight off the
        # Fragment imports without complaint and renders an empty <div> — which
        # is how a header with no navigation in it looks.
        el["pageElements"] = [{"type": "FragmentDropZone", "pageElements": children}]
    return el


def section(name, children, fluid=False, style=None, css=None):
    definition = {
        "indexed": True,
        "layout": {
            "contentDisplay": "Block",
            "widthType": "Fluid" if fluid else "Fixed",
        },
    }
    if style:
        definition["fragmentStyle"] = style
    if css:
        definition["customCSS"] = css
    return {"definition": definition, "id": eid(name), "pageElements": children,
            "type": "Section"}


def row(name, columns, per_row=None, mobile=1, gutters=True, style=None):
    n = len(columns)
    definition = {
        "gutters": gutters,
        "indexed": True,
        "modulesPerRow": per_row or n,
        "numberOfColumns": n,
        "reverseOrder": False,
        "rowViewports": [
            {"id": "landscapeMobile", "rowViewportDefinition": {"modulesPerRow": mobile}},
            {"id": "portraitMobile", "rowViewportDefinition": {"modulesPerRow": mobile}},
            {"id": "tablet", "rowViewportDefinition": {}},
        ],
        "verticalAlignment": "top",
    }
    if style:
        definition["fragmentStyle"] = style
    return {"definition": definition, "id": eid(name), "type": "Row",
            "pageElements": columns}


def col(name, size, children, mobile_size=12):
    return {
        "definition": {
            "columnViewports": [
                {"id": v, "columnViewportDefinition": {"size": mobile_size}}
                for v in VIEWPORTS
            ],
            "size": size,
        },
        "id": eid(name),
        "pageElements": children,
        "type": "Column",
    }


def widget(name, props):
    return {
        "definition": {"widgetInstance": {
            "widgetConfig": {"properties": "".join(f"{k}={v}\n" for k, v in props.items())},
            "widgetName": WIDGET_ERC,
        }},
        "id": eid(name),
        "type": "Widget",
    }


def portlet(name, portlet_name, config=None):
    instance = {"widgetName": portlet_name}
    if config:
        instance["widgetConfig"] = config
    return {"definition": {"widgetInstance": instance}, "id": eid(name), "type": "Widget"}


def asset_list_key(title):
    """The placeholder takes a collection's KEY in upper case, not its title.

    AssetListEntryLocalServiceImpl lower-cases the title and turns spaces into
    dashes to make the key; BundleSiteInitializer then registers the placeholder
    under that key upper-cased. Pass the title and a one-word name happens to
    work, which is exactly why this is easy to get wrong — an unresolved
    placeholder is left in the page as a literal string, so the collection finds
    nothing and the page says "No Results Found" with no error logged anywhere.
    """
    return title.strip().lower().replace(" ", "-").upper()


def collection(name, asset_list, children, columns=3, per_page=12, pagination="Numeric",
               items=12):
    return {
        "definition": {
            "collectionConfig": {
                "collectionReference": {
                    "className": "com.liferay.asset.list.model.AssetListEntry",
                    "classPK": f"[$ASSET_LIST_ENTRY_ID:{asset_list_key(asset_list)}$]",
                },
                "collectionType": "Collection",
            },
            "collectionViewports": [
                {"id": v, "collectionViewportDefinition": {"numberOfColumns": 1}}
                for v in VIEWPORTS
            ],
            "displayAllItems": False,
            "displayAllPages": False,
            "emptyCollectionConfig": {"displayMessage": True},
            "listItemStyle": "",
            "listStyle": "",
            "numberOfColumns": columns,
            "numberOfItems": items,
            "numberOfItemsPerPage": per_page,
            "numberOfPages": 4,
            "paginationType": pagination,
            "showAllItems": False,
            "templateKey": "",
        },
        "id": eid(name),
        "pageElements": [{
            "definition": {"collectionItemConfig": {}},
            "id": eid(name + ":item"),
            "pageElements": children,
            "type": "CollectionItem",
        }],
        "type": "Collection",
    }


def drop_zone():
    return {"definition": {"fragmentSettings": {"unallowedFragments": []}},
            "type": "DropZone"}


def page_definition(children, master=None, name="root"):
    d = {"pageElement": {"id": eid(name), "pageElements": children, "type": "Root"}}
    if master:
        d["masterPage"] = {"key": master}
        d["settings"] = {"masterPage": {"key": master}}
    return d


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent="\t") + "\n")
    return path


def layout(folder, friendly_url, title, children, priority, master="outfitter",
           hidden=False):
    d = SITE / "layouts" / folder
    write(d / "page.json", {
        "friendlyURL": friendly_url,
        "hidden": hidden,
        "name_i18n": {"en_US": title},
        "priority": priority,
        "private": False,
        "system": False,
        # Without this the initializer imports the page definition into the
        # DRAFT layout and stops: the draft holds the whole page and the live
        # one renders "No Results Found". Verified by opening the editor — the
        # content was all there, unpublished.
        "typeSettings": [{"key": "published", "value": "true"}],
        "type": "Content",
    })
    write(d / "page-definition.json", page_definition(children, master=master,
                                                      name=f"page:{folder}"))
    return d


# fragmentStyle.backgroundColor only takes a hex, and a hex cannot follow a
# brand. A section styled through the theme's own tokens can, so cards are
# built with customCSS instead.
CARD_CSS = (".[$FRAGMENT_CLASS$] {\n"
            "\tbackground: var(--color-neutral-1, #f7f6f9);\n"
            "\tborder-radius: var(--border-radius-lg, 0.75rem);\n"
            "\theight: 100%;\n"
            "\tmargin-bottom: 1.5rem;\n"   # collection items stack within a column
            "\tpadding: 1.5rem;\n"
            "}")


def card(name, children, css=CARD_CSS):
    return section(name, children, css=css)


# =====================================================================
# Shared blocks
# =====================================================================
SPACER_LG = {"paddingBottom": "7", "paddingTop": "7"}
SPACER_MD = {"paddingBottom": "5", "paddingTop": "5"}


def intro(name, eyebrow, title, lead, align="left", spacing="normal"):
    fields = {"title": text(title)}
    config = {"align": align, "spacing": spacing,
              "showEyebrow": bool(eyebrow), "showLead": bool(lead)}
    if eyebrow:
        fields["eyebrow"] = text(eyebrow)
    if lead:
        fields["lead"] = text(lead)
    return frag("section-intro", name, fields, config)


def feature(name, icon, title, body, tone="card"):
    return frag("feature-card", name,
                {"title": text(title), "body": text(body)},
                {"icon": icon, "tone": tone})


def stat(name, value, label, note=None, align="left"):
    fields = {"value": text(value), "label": text(label)}
    if note:
        fields["note"] = text(note)
    return frag("stat", name, fields,
                {"align": align, "showNote": bool(note)})


def step(name, number, title, body):
    return frag("step-card", name,
                {"title": text(title), "body": text(body)},
                {"number": str(number)})


def band(name, picture, title, lead, cta=None, cta_href="/web/outfitter/catalogue",
         height="short", align="left", scrim="medium"):
    fields = {"backgroundImage": image(picture), "title": text(title), "lead": text(lead)}
    if cta:
        fields["cta"] = link(cta_href, cta)
    return frag("media-band", name, fields,
                {"height": height, "align": align, "scrim": scrim,
                 "showCta": bool(cta)})


def category(name, picture, title, meta, href):
    # link_to, not an editable link: see the fragment's own comment.
    return frag("category-card", name,
                {"backgroundImage": image(picture), "title": text(title),
                 "meta": text(meta)}, link_to=href)


def grid(name, cells, per_row, size=None, gap=True, mobile=1):
    size = size or max(1, 12 // per_row)
    return row(name, [col(f"{name}:c{i}", size, [cell]) for i, cell in enumerate(cells)],
               per_row=per_row, mobile=mobile, gutters=gap)


def heading(name, value, level="h3", mapped_field=None, css=None, style=None):
    value_field = mapped(mapped_field) if mapped_field else text(value)
    return frag("BASIC_COMPONENT-heading", name, {"element-text": value_field},
                {"headingLevel": level}, style=style, css=css)


def paragraph(name, value, mapped_field=None, css=None, style=None):
    value_field = mapped(mapped_field) if mapped_field else text(value)
    return frag("BASIC_COMPONENT-paragraph", name, {"element-text": value_field},
                style=style, css=css)


def button(name, label, href, display="primary", size="regular"):
    # The editable is "link", not "element-link". A wrong id is not an error:
    # the button renders with Liferay's own placeholder label, "Go Somewhere".
    return frag("BASIC_COMPONENT-button", name,
                {"link": link(href, label)},
                {"buttonSize": size, "displayType": display})


# =====================================================================
# Master page — header, drop zone, footer
# =====================================================================
NAV_PORTLET = "com_liferay_site_navigation_menu_web_portlet_SiteNavigationMenuPortlet"


def build_master():
    d = SITE / "layout-page-templates" / "master-pages" / "outfitter"
    write(d / "master-page.json", {"name": "Outfitter"})
    write(d / "page-definition.json", page_definition([
        frag("site-header", "master:header",
             {"brand": text("Alpine Ridge Outfitters"),
              "cta": link("/web/outfitter/catalogue", "Book gear")},
             {"homeLink": "/web/outfitter"},
             # No widgetConfig: a display style of "[custom]" with no template
             # renders nothing at all, with no error. The defaults show the
             # site's primary navigation menu, which is what we want.
             children=[portlet("master:nav", NAV_PORTLET)]),
        drop_zone(),
        frag("site-footer", "master:footer",
             {"brand": text("Alpine Ridge Outfitters"),
              "blurb": text("Expedition kit, hired by the day from four depots "
                            "across the range and the coast."),
              "legal": text("A fictional company, built to demonstrate Liferay "
                            "Objects at DevCon 2026. No gear is actually for hire.")},
             children=[portlet("master:footer-nav", NAV_PORTLET)]),
    ], name="master"))
    return d


# =====================================================================
# Display page template — one page per piece of gear
# =====================================================================
def build_display_page():
    d = SITE / "layout-page-templates" / "display-page-templates" / "gear"
    write(d / "display-page-template.json", {
        "contentType": {"className": "[$OBJECT_DEFINITION_CLASS_NAME:OutfitterGear$]"},
        "name": "Gear Detail",
    })
    specs = [
        ("SKU", "sku"),
        ("Category", "category"),
        ("Best for", "activity"),
        ("Home depot", "depot"),
        ("Condition", "gearCondition"),
        ("Days on hire this year", "utilisationDays"),
        ("Days out of service", "downtimeDays"),
        ("Replacement value", "replacementValue"),
    ]
    spec_rows = [
        frag("spec-row", f"gear:spec:{field}",
             {"label": text(label), "value": mapped(field, "DisplayPageItem")})
        for label, field in specs
    ]
    write(d / "page-definition.json", page_definition([
        band("gear:banner", "gear-default.jpg", "", "", height="short", scrim="heavy"),
        section("gear:body", [
            row("gear:cols", [
                col("gear:main", 7, [
                    paragraph("gear:eyebrow", "", mapped_field="category",
                              css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-brand-primary);\n"
                                  "\tfont-size: .8125rem;\n\tfont-weight: 600;\n"
                                  "\tletter-spacing: .14em;\n\ttext-transform: uppercase;\n}"),
                    heading("gear:title", "", level="h1", mapped_field="gearName"),
                    paragraph("gear:summary", "", mapped_field="summary",
                              css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-neutral-7);\n"
                                  "\tfont-size: 1.125rem;\n}"),
                    heading("gear:specs-heading", "Specification", level="h2",
                            style={"marginTop": "5"}),
                    *spec_rows,
                ]),
                col("gear:aside", 5, [
                    section("gear:price-card", [
                        paragraph("gear:rate-label", "Daily rate"),
                        heading("gear:rate", "", level="h2", mapped_field="dailyRate"),
                        paragraph("gear:rate-note",
                                  "Per day, including the pre-hire check. Discounts "
                                  "apply from the fourth day."),
                        button("gear:cta", "Check availability", "/web/outfitter/contact"),
                        button("gear:back", "Back to the catalogue", "/web/outfitter/catalogue",
                               display="secondary"),
                    ], css=CARD_CSS),
                ]),
            ]),
        ], style=SPACER_LG),
    ], master="outfitter", name="display:gear"))
    return d


# =====================================================================
# Pages
# =====================================================================
CATEGORIES = [
    ("Shelter", "cat-shelter.jpg", "Tents, tarps and bivvies"),
    ("Paddle", "cat-paddle.jpg", "Kayaks, packrafts, paddles"),
    ("Climb", "cat-climb.jpg", "Racks, ropes, axes, harnesses"),
    ("Navigation", "cat-navigation.jpg", "Satellite, VHF, GPS, charts"),
    ("Sleep", "cat-sleep.jpg", "Bags, quilts, mats, stoves"),
    ("Pack", "cat-pack.jpg", "Haul bags, dry barrels, day packs"),
]

DEPOTS = [
    ("Fjordside", "depot-fjordside.jpg", "Sea kayaks and coastal kit, on the water"),
    ("Highland", "depot-highland.jpg", "Alpine racks and winter shelter"),
    ("Lakehead", "depot-lakehead.jpg", "Trail and multi-day walking gear"),
    ("Coast Road", "depot-coast-road.jpg", "Everything, collected on your way out"),
]


def build_home():
    gear_card = [
        section("home:featured-card", [
            paragraph("home:featured-cat", "", mapped_field="category",
                      css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-brand-primary);\n"
                          "\tfont-size: .75rem;\n\tfont-weight: 600;\n"
                          "\tletter-spacing: .12em;\n\tmargin: 0;\n"
                          "\ttext-transform: uppercase;\n}"),
            heading("home:featured-name", "", level="h3", mapped_field="gearName"),
            paragraph("home:featured-summary", "", mapped_field="summary",
                      css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-neutral-7);\n"
                          "\tfont-size: .9375rem;\n}"),
        ], css=CARD_CSS),
    ]

    return [
        frag("hero", "home:hero", {
            "backgroundImage": image("hero-alpine.jpg"),
            "eyebrow": text("Alpine & coastal hire"),
            "title": text("Gear that has already been where you are going"),
            "lead": text("Forty-eight items, four depots, checked between every "
                         "hire. Book by the day; collect on your way out."),
            "cta-primary": link("/web/outfitter/catalogue", "Browse the gear"),
            "cta-secondary": link("/web/outfitter/how-it-works", "How hiring works"),
        }, {"height": "tall", "align": "left", "showEyebrow": True,
            "showSecondaryCta": True}),

        section("home:promise", [
            intro("home:promise-intro", "Why hire",
                  "Owning the kit is the expensive part of going outside",
                  "You need a four-season tent twice a year. We keep it serviced "
                  "the other three hundred and sixty-three days."),
            grid("home:promise-grid", [
                feature("home:promise-1", "shield-check", "Checked between hires",
                        "Every item comes back to a depot, gets inspected, and is "
                        "logged out of service if anything is wrong."),
                feature("home:promise-2", "map-marker", "Four depots",
                        "Collect from whichever one is on your route. Return to "
                        "any of them — we move stock between depots ourselves."),
                feature("home:promise-3", "time", "Priced by the day",
                        "No weekly minimum. The rate drops from the fourth day, "
                        "which is when most trips actually start costing money."),
            ], per_row=3),
        ], style=SPACER_LG),

        section("home:categories", [
            intro("home:cat-intro", "The fleet", "Six things to hire",
                  "Browse by what you are doing, not by what it is called."),
            grid("home:cat-grid-1", [
                category(f"home:cat:{name}", pic, name, meta,
                         "/web/outfitter/catalogue")
                for name, pic, meta in CATEGORIES[:3]
            ], per_row=3),
            grid("home:cat-grid-2", [
                category(f"home:cat:{name}", pic, name, meta,
                         "/web/outfitter/catalogue")
                for name, pic, meta in CATEGORIES[3:]
            ], per_row=3),
        ], style={"paddingBottom": "7"}),

        band("home:band-fjord", "band-fjord.jpg",
             "Three days of water, one bag of kit",
             "Sea kayaks, dry barrels and a satellite messenger, from the "
             "Fjordside depot.",
             cta="See the coastal range", height="tall", scrim="medium"),

        section("home:numbers", [
            grid("home:numbers-grid", [
                stat("home:stat-1", "48", "Items in the fleet",
                     "Counted at the last stock check"),
                stat("home:stat-2", "4", "Depots", "Collect at one, return to any"),
                stat("home:stat-3", "9,000", "Hires logged",
                     "Since the Objects behind this site were seeded"),
                stat("home:stat-4", "2", "Brands on one portal",
                     "Same platform, same data, two style books"),
            ], per_row=4, mobile=2),
        ], style=SPACER_LG),

        section("home:featured", [
            intro("home:featured-intro", "Just back in", "Recently returned, ready to go",
                  "Pulled live from the Gear Object — this list is not authored."),
            collection("home:featured-collection", "Gear Catalogue", gear_card,
                       columns=3, items=6, per_page=6, pagination="None"),
            button("home:featured-cta", "See all forty-eight", "/web/outfitter/catalogue",
                   display="secondary"),
        ], style={"paddingBottom": "7"}),

        band("home:band-cta", "band-trail.jpg",
             "Tell us the trip, not the kit list",
             "Send us where you are going and when. We will put the bag together.",
             cta="Get in touch", cta_href="/web/outfitter/contact",
             height="short", align="center", scrim="heavy"),
    ]


def build_gear():
    card = [
        section("gear:card", [
            paragraph("gear:card-cat", "", mapped_field="category",
                      css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-brand-primary);\n"
                          "\tfont-size: .75rem;\n\tfont-weight: 600;\n"
                          "\tletter-spacing: .12em;\n\tmargin: 0 0 .25rem;\n"
                          "\ttext-transform: uppercase;\n}"),
            heading("gear:card-name", "", level="h3", mapped_field="gearName"),
            paragraph("gear:card-summary", "", mapped_field="summary",
                      css=".[$FRAGMENT_CLASS$] {\n\tcolor: var(--color-neutral-7);\n"
                          "\tfont-size: .9375rem;\n\tmin-height: 3rem;\n}"),
            frag("spec-row", "gear:card-depot",
                 {"label": text("Depot"), "value": mapped("depot")}),
            frag("spec-row", "gear:card-rate",
                 {"label": text("Per day (\u20ac)"), "value": mapped("dailyRate")}),
        ], css=CARD_CSS),
    ]
    return [
        frag("hero", "gear:hero", {
            "backgroundImage": image("cat-pack.jpg"),
            "eyebrow": text("The catalogue"),
            "title": text("Everything we hire"),
            "lead": text("Forty-eight items across six categories, held at four depots."),
            "cta-primary": link("/web/outfitter/how-it-works", "How hiring works"),
        }, {"height": "short", "align": "left", "showEyebrow": True,
            "showSecondaryCta": False}),
        section("gear:list", [
            collection("gear:collection", "Gear Catalogue", card, columns=3, items=48,
                       per_page=12, pagination="Numeric"),
        ], style=SPACER_LG),
    ]


def build_how_it_works():
    return [
        frag("hero", "how:hero", {
            "backgroundImage": image("story-how-it-works.jpg"),
            "eyebrow": text("How it works"),
            "title": text("Four steps, one of which is walking"),
            "lead": text("From picking a date to handing the bag back."),
        }, {"height": "short", "align": "left", "showEyebrow": True,
            "showSecondaryCta": False}),
        section("how:steps", [
            row("how:steps-row", [
                col("how:steps-left", 7, [
                    step("how:step-1", 1, "Tell us the dates and the depot",
                         "Pick the days you need and where you want to collect. "
                         "Stock is held per depot, so the answer depends on both."),
                    step("how:step-2", 2, "We put the bag together",
                         "Each item is checked out against your hire and logged. "
                         "Anything that failed its last inspection never reaches you."),
                    step("how:step-3", 3, "Collect, or have it moved",
                         "Collect from your depot, or ask us to move it to another "
                         "one on the route. Moving stock is what the four depots are for."),
                    step("how:step-4", 4, "Bring it back to any depot",
                         "Return anywhere. We inspect, log the condition and, if it "
                         "needs work, take it out of service before it goes out again."),
                ]),
                col("how:steps-right", 5, [
                    card("how:aside", [
                        heading("how:aside-title", "What we check", level="h3"),
                        paragraph("how:aside-body",
                                  "Seams, zips and poles on shelter. Hull and bulkheads "
                                  "on anything that floats. Sheath and core on rope, with "
                                  "a date on the tag. Battery health on anything with a "
                                  "radio in it."),
                        heading("how:aside-title-2", "What it costs when we get it wrong",
                                level="h3", style={"marginTop": "4"}),
                        paragraph("how:aside-body-2",
                                  "If kit fails an inspection after you have booked it, "
                                  "you get the substitute at the lower of the two rates, "
                                  "or the hire free if we cannot substitute."),
                    ]),
                ]),
            ]),
        ], style=SPACER_LG),
        band("how:band", "band-weather.jpg",
             "The weather decides, not the booking",
             "Cancel up to 24 hours before collection and the hire costs nothing.",
             cta=None, height="short", align="center", scrim="heavy"),
    ]


def build_depots():
    return [
        frag("hero", "depots:hero", {
            "backgroundImage": image("depot-fjordside.jpg"),
            "eyebrow": text("Where we are"),
            "title": text("Four depots"),
            "lead": text("Collect at one, return to any. We move the stock."),
        }, {"height": "short", "align": "left", "showEyebrow": True,
            "showSecondaryCta": False}),
        section("depots:grid", [
            intro("depots:intro", None, "Pick the one on your route",
                  "Each depot keeps the kit its country needs, and can pull "
                  "anything else across overnight."),
            grid("depots:row", [
                category(f"depots:{name}", pic, name, meta, "/web/outfitter/contact")
                for name, pic, meta in DEPOTS
            ], per_row=2, mobile=1),
        ], style=SPACER_LG),
    ]


def build_contact():
    return [
        frag("hero", "contact:hero", {
            "backgroundImage": image("band-trail.jpg"),
            "eyebrow": text("Get in touch"),
            "title": text("Tell us the trip"),
            "lead": text("Dates, depot and roughly what you are doing. "
                         "We will come back with a kit list and a price."),
        }, {"height": "short", "align": "left", "showEyebrow": True,
            "showSecondaryCta": False}),
        section("contact:body", [
            row("contact:cols", [
                col("contact:left", 7, [
                    intro("contact:intro", None, "What to send us",
                          "The more of this you can answer, the closer the first "
                          "reply will be to a real quote."),
                    step("contact:q1", 1, "Where and when",
                         "Dates, and the depot you can reach most easily."),
                    step("contact:q2", 2, "How many of you",
                         "Party size decides shelter and how much we can split "
                         "across packs."),
                    step("contact:q3", 3, "What you already own",
                         "Most people have boots and a bag. We would rather not "
                         "hire you a second one."),
                ]),
                col("contact:right", 5, [
                    card("contact:card", [
                        heading("contact:card-title", "Depot desks", level="h3"),
                        paragraph("contact:card-body",
                                  "Fjordside and Coast Road are open seven days. "
                                  "Highland and Lakehead are closed Tuesdays outside "
                                  "the season."),
                        frag("spec-row", "contact:spec-1",
                             {"label": text("Email"),
                              "value": text("hire@alpineridge.example")}),
                        frag("spec-row", "contact:spec-2",
                             {"label": text("Phone"), "value": text("+00 1234 5678")}),
                        frag("spec-row", "contact:spec-3",
                             {"label": text("Reply within"), "value": text("One working day")}),
                    ]),
                ]),
            ]),
        ], style=SPACER_LG),
    ]


HIRES = {"object-erc": "OUTFITTERRENTAL", "rest-context-path": "/o/c/outfitterhires"}


def chart(name, instance, dimension, measure, aggregation, chart_type, strategy,
          **extra):
    props = dict(HIRES, **{
        "instance-id": instance,
        "dimension": dimension,
        "measure": measure,
        "aggregation": aggregation,
        "chart-type": chart_type,
        "strategy": strategy,
    })
    props.update(extra)
    return widget(name, props)


def build_operations():
    return [
        frag("hero", "ops:hero", {
            "backgroundImage": image("cat-navigation.jpg"),
            "eyebrow": text("Operations"),
            "title": text("Nine thousand hires, no reports to write"),
            "lead": text("Every chart below is the same widget pointed at the "
                         "Hire Object and given a dimension and a measure."),
        }, {"height": "short", "align": "left", "showEyebrow": True,
            "showSecondaryCta": False}),
        section("ops:top", [
            intro("ops:intro", "Revenue", "Where the money comes from",
                  "Server-side aggregation: the browser receives the answer, "
                  "not the nine thousand rows."),
            row("ops:row-1", [
                col("ops:c1", 6, [chart("ops:revenue-depot", "ops-revenue-depot",
                                        "depot", "revenue", "sum", "bar", "server")]),
                col("ops:c2", 6, [chart("ops:revenue-activity", "ops-revenue-activity",
                                        "activity", "revenue", "sum", "pie", "server")]),
            ], mobile=1),
            row("ops:row-2", [
                col("ops:c3", 4, [chart("ops:hires-category", "ops-hires-category",
                                        "category", "revenue", "count", "bar", "server")]),
                col("ops:c4", 4, [chart("ops:days-category", "ops-days-category",
                                        "category", "days", "avg", "bar", "server")]),
                col("ops:c5", 4, [chart("ops:party-activity", "ops-party-activity",
                                        "activity", "partySize", "avg", "bar", "server")]),
            ], mobile=1),
        ], style=SPACER_LG),
        section("ops:bottom", [
            intro("ops:intro-2", "Mix", "Channel and status",
                  "The same widget again, on different fields."),
            row("ops:row-3", [
                col("ops:c6", 6, [chart("ops:channel", "ops-channel",
                                        "channel", "revenue", "sum", "pie", "server")]),
                col("ops:c7", 6, [chart("ops:status", "ops-status",
                                        "hireStatus", "revenue", "count", "bar", "server")]),
            ], mobile=1),
        ], style={"paddingBottom": "7"}),
    ]


if __name__ == "__main__":
    print("master page   ->", build_master().relative_to(ROOT))
    print("display page  ->", build_display_page().relative_to(ROOT))
    pages = [
        ("01_home", "/home", "Home", build_home(), 0),
        ("02_catalogue", "/catalogue", "Gear", build_gear(), 1),
        ("03_how-it-works", "/how-it-works", "How It Works", build_how_it_works(), 2),
        ("04_depots", "/depots", "Depots", build_depots(), 3),
        ("05_operations", "/operations", "Operations", build_operations(), 4),
        ("06_contact", "/contact", "Contact", build_contact(), 5),
    ]
    for folder, url, title, children, priority in pages:
        d = layout(folder, url, title, children, priority)
        print(f"{title:14} -> {d.relative_to(ROOT)}")
