#!/usr/bin/env python3
"""Build the visual client handover for purchasing, lot cost, and quote readiness."""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image as PdfImage,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "output" / "playwright"
OUTPUT = ROOT / "output" / "pdf" / "Marble-Park-Purchasing-Pricing-Cost-Guide.pdf"
PUBLIC_OUTPUT = ROOT / "apps" / "web" / "public" / "help" / OUTPUT.name

PAGE = landscape(A4)
PAGE_W, PAGE_H = PAGE
INK = colors.HexColor("#171719")
MUTED = colors.HexColor("#667085")
RED = colors.HexColor("#A62D26")
RED_DARK = colors.HexColor("#5D1F1C")
RED_SOFT = colors.HexColor("#F8ECEA")
CREAM = colors.HexColor("#F7F4EF")
GREEN = colors.HexColor("#147D64")
GREEN_SOFT = colors.HexColor("#EAF7F2")
AMBER = colors.HexColor("#B25D13")
AMBER_SOFT = colors.HexColor("#FFF6E8")
LINE = colors.HexColor("#DEDAD3")
WHITE = colors.white


def register_fonts() -> tuple[str, str]:
    candidates = [
        ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("MPRegular", regular))
            pdfmetrics.registerFont(TTFont("MPBold", bold))
            return "MPRegular", "MPBold"
    return "Helvetica", "Helvetica-Bold"


REGULAR, BOLD = register_fonts()
styles = getSampleStyleSheet()


def style(name: str, **kwargs) -> ParagraphStyle:
    base = kwargs.pop("parent", styles["Normal"])
    defaults = {"fontName": REGULAR, "textColor": INK, "leading": 14}
    defaults.update(kwargs)
    return ParagraphStyle(name, parent=base, **defaults)


KICKER = style("kicker", fontName=BOLD, fontSize=8.5, leading=10, textColor=RED, spaceAfter=5)
TITLE = style("title", fontName=BOLD, fontSize=27, leading=30, spaceAfter=8)
SUBTITLE = style("subtitle", fontSize=11, leading=16, textColor=MUTED)
H1 = style("h1", fontName=BOLD, fontSize=20, leading=24, spaceAfter=7)
H2 = style("h2", fontName=BOLD, fontSize=12, leading=15, spaceAfter=4)
BODY = style("body", fontSize=9.5, leading=14, textColor=colors.HexColor("#35363A"))
SMALL = style("small", fontSize=7.8, leading=11, textColor=MUTED)
CAPTION = style("caption", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_CENTER)
CALLOUT = style("callout", fontName=BOLD, fontSize=10, leading=14, textColor=RED_DARK)
TABLE_HEAD = style("tablehead", fontName=BOLD, fontSize=7.8, leading=10, textColor=WHITE)
TABLE_CELL = style("tablecell", fontSize=7.5, leading=10)
TABLE_CELL_MUTED = style("tablecellmuted", fontSize=7.5, leading=10, textColor=MUTED)


class BrandBar(Flowable):
    def __init__(self, height: float = 5 * mm):
        super().__init__()
        self.height = height

    def wrap(self, avail_width, _avail_height):
        self.width = avail_width
        return avail_width, self.height

    def draw(self):
        self.canv.setFillColor(RED)
        self.canv.roundRect(0, 0, self.width * 0.66, self.height, 2 * mm, fill=1, stroke=0)
        self.canv.setFillColor(RED_DARK)
        self.canv.roundRect(self.width * 0.64, 0, self.width * 0.36, self.height, 2 * mm, fill=1, stroke=0)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(14 * mm, 12 * mm, PAGE_W - 14 * mm, 12 * mm)
    canvas.setFont(REGULAR, 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(14 * mm, 7.5 * mm, "MARBLE PARK · PURCHASING, PRICING & LOT COST")
    canvas.drawRightString(PAGE_W - 14 * mm, 7.5 * mm, f"PAGE {doc.page}")
    canvas.restoreState()


def p(text: str, used_style=BODY) -> Paragraph:
    return Paragraph(text, used_style)


def bullet(text: str) -> Paragraph:
    return Paragraph(f"<font color='#A62D26'>●</font> &nbsp;{text}", BODY)


def card(title: str, body: str, tint=CREAM, width=77 * mm) -> Table:
    table = Table([[p(title, H2)], [p(body, BODY)]], colWidths=[width])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), tint),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 10),
    ]))
    return table


def screenshot(name: str, max_width: float, max_height: float, caption: str = "") -> list:
    path = SCREENSHOTS / name
    if not path.exists():
        raise FileNotFoundError(path)
    with Image.open(path) as image:
        width, height = image.size
    scale = min(max_width / width, max_height / height)
    view = PdfImage(str(path), width=width * scale, height=height * scale)
    table = Table([[view]], colWidths=[width * scale])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    result = [table]
    if caption:
        result.extend([Spacer(1, 2 * mm), p(caption, CAPTION)])
    return result


def section_intro(kicker: str, title: str, subtitle: str) -> list:
    return [p(kicker.upper(), KICKER), p(title, H1), p(subtitle, SUBTITLE), Spacer(1, 4 * mm)]


def page_two_columns(left, right, widths=(83 * mm, 173 * mm)) -> Table:
    table = Table([[left, right]], colWidths=list(widths), hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 7 * mm),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def workflow_table() -> Table:
    cells = [
        ("01", "Master", "MRP required; floor optional"),
        ("02", "Purchase order", "Supplier rate + UOM + discount + optional GST"),
        ("03", "GRN", "PO cost inherited; manual rate captured"),
        ("04", "Inventory lot", "Net pre-tax unit cost becomes the cost truth"),
        ("05", "Quote", "MRP read-only; no false zero when setup is missing"),
    ]
    row = []
    for number, title, body in cells:
        row.append([p(number, KICKER), p(title, H2), p(body, SMALL)])
    table = Table([row], colWidths=[51 * mm] * 5)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return table


def build_story() -> list:
    story = []

    # Cover
    story += [Spacer(1, 7 * mm), BrandBar(), Spacer(1, 10 * mm), p("CLIENT HANDOVER · RELEASE 2026-08-25", KICKER)]
    story += [p("Purchasing, pricing<br/>and lot-cost truth", TITLE)]
    story += [p("A visual operating guide for purchase orders, GRN inward, master MRP, searchable selection and legacy cost readiness. Screens show the verified Marble Park release using isolated training data.", SUBTITLE), Spacer(1, 12 * mm)]
    story += [workflow_table(), Spacer(1, 11 * mm)]
    story += [Table([[card("What this protects", "No stock lot is received without a positive cost. A PO-linked receipt cannot secretly replace its approved PO cost.", GREEN_SOFT, 82 * mm), card("What remains flexible", "GST is optional on both PO and quote. Supplier rate can be entered in BOX, PC or the governed purchase UOM.", AMBER_SOFT, 82 * mm), card("What users see", "Fast searchable selectors, clear setup queues and actionable errors. Missing MRP never becomes a misleading Rs. 0 quote.", RED_SOFT, 82 * mm)]], colWidths=[85 * mm] * 3, style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-2, -1), 4 * mm)])]
    story += [PageBreak()]

    # Sources of truth
    story += section_intro("1 · Source-of-truth model", "One commercial meaning per field", "MRP is a selling reference. Floor price is a quotation guardrail. Actual cost is the net pre-tax cost stored on the physical inward lot.")
    data = [
        [p("Value", TABLE_HEAD), p("Owned by", TABLE_HEAD), p("Used for", TABLE_HEAD), p("Rule", TABLE_HEAD)],
        [p("MRP", TABLE_CELL), p("Product SKU / tile variant", TABLE_CELL), p("Quote and label", TABLE_CELL), p("Required, editable and historically audited", TABLE_CELL)],
        [p("Floor price", TABLE_CELL), p("Product SKU / tile variant", TABLE_CELL), p("Quote approval guardrail", TABLE_CELL), p("Optional; visible to authorised commercial users", TABLE_CELL)],
        [p("Supplier rate", TABLE_CELL), p("PO line or manual GRN line", TABLE_CELL), p("Purchase negotiation", TABLE_CELL), p("Entered in the supplier UOM", TABLE_CELL)],
        [p("Actual cost", TABLE_CELL), p("Inventory lot", TABLE_CELL), p("Stock value and realised margin", TABLE_CELL), p("Net pre-tax base-unit cost; owner/admin visibility", TABLE_CELL)],
        [p("GST", TABLE_CELL), p("PO / quote transaction", TABLE_CELL), p("Tax presentation", TABLE_CELL), p("Optional; blank or 0 means without GST", TABLE_CELL)],
    ]
    table = Table(data, colWidths=[38 * mm, 57 * mm, 62 * mm, 98 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RED_DARK),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, CREAM]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [table, Spacer(1, 7 * mm), p("Never copy today’s Product Master value backwards into an old transaction. Quotes, PO lines, GRNs and inventory lots keep their own governed snapshots.", CALLOUT)]
    story += [PageBreak()]

    # Product master
    left = [p("MASTER DATA", KICKER), p("Set MRP before the SKU is used", H1), bullet("MRP is mandatory for new product SKUs and tile variants."), bullet("Floor price is optional and is the lowest ordinary quotation price."), bullet("Actual cost is not maintained here; it comes from inward lots."), bullet("MRP edits create history and audit records."), Spacer(1, 4 * mm), p("Owner/Admin task", H2), p("Use Pricing readiness to complete legacy SKUs that predate the mandatory-MRP rule.", BODY)]
    right = screenshot("product-master.png", 170 * mm, 133 * mm, "Product Master — searchable governed masters, required MRP, optional floor price and no editable actual-cost field.")
    story += [page_two_columns(left, right), PageBreak()]

    # Tile master
    left = [p("TILE MASTER", KICKER), p("Design × size × finish creates the inwardable SKU", H1), bullet("Design owns the catalogue identity and images."), bullet("Size owns geometry and coverage."), bullet("Variant owns finish, packing, MRP per SQFT and immutable warehouse SKU."), bullet("Labels and quotes show tile rates per SQFT even when fulfilment is in boxes."), Spacer(1, 4 * mm), p("Do not store cost here", H2), p("The same tile variant can arrive from different suppliers or batches at different costs. Each GRN lot retains its own cost.", BODY)]
    right = screenshot("tile-variant-master.png", 170 * mm, 133 * mm, "Tile Variant Registry — searchable design, size and finish selectors with governed packing and per-SQFT MRP.")
    story += [page_two_columns(left, right), PageBreak()]

    # PO builder
    left = [p("PURCHASE ORDER", KICKER), p("Enter known supplier terms without delaying the order", H1), bullet("Select product/SKU with fast search."), bullet("Enter quantity; supplier rate and UOM are optional on the PO."), bullet("A blank rate may remain pending through inward and be completed days later."), bullet("Apply one governed header discount if negotiated."), bullet("Choose GST % or leave 0/blank for a without-GST PO."), bullet("Any captured rate is audited, normalized and locked."), Spacer(1, 4 * mm), p("Keyboard", H2), p("Type to filter, use ↑/↓ to move, Enter to select and Esc to close. This is the standard interaction for upgraded high-volume selectors.", BODY)]
    right = screenshot("po-builder-desktop.png", 170 * mm, 133 * mm, "New PO — supplier rate, UOM, discount and optional GST are visible together before the order is saved.")
    story += [page_two_columns(left, right), PageBreak()]

    # Worked example
    story += section_intro("4 · Worked example", "From supplier rate to lot cost", "Illustrative training arithmetic; the system performs and stores the governed calculation at PO/GRN time.")
    example = [
        [p("Input", TABLE_HEAD), p("Value", TABLE_HEAD), p("Calculation", TABLE_HEAD), p("Stored result", TABLE_HEAD)],
        [p("Order", TABLE_CELL), p("10 BOX", TABLE_CELL), p("10 × 3 PC", TABLE_CELL), p("30 PC", TABLE_CELL)],
        [p("Supplier rate", TABLE_CELL), p("Rs. 1,500 / BOX", TABLE_CELL), p("Rs. 1,500 ÷ 3", TABLE_CELL), p("Rs. 500 / PC gross", TABLE_CELL)],
        [p("PO discount", TABLE_CELL), p("5%", TABLE_CELL), p("Rs. 500 × 95%", TABLE_CELL), p("Rs. 475 / PC net pre-tax", TABLE_CELL)],
        [p("GST", TABLE_CELL), p("18% or 0%", TABLE_CELL), p("Shown on PO totals", TABLE_CELL), p("Does not inflate inventory cost", TABLE_CELL)],
        [p("PO-linked GRN", TABLE_CELL), p("Receive 10 BOX", TABLE_CELL), p("Cost is inherited", TABLE_CELL), p("Lot cost Rs. 475 / PC", TABLE_CELL)],
    ]
    table = Table(example, colWidths=[50 * mm, 57 * mm, 72 * mm, 76 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RED_DARK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, CREAM]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [table, Spacer(1, 8 * mm), Table([[card("PO-linked GRN", "A rated line inherits its locked PO cost. A pending line may be inwarded without cost; its GRN and exact lot remain cost-pending until the permanent queue records the verified rate.", GREEN_SOFT, 120 * mm), card("Manual GRN", "Use only when no PO exists. The receiver must enter a positive supplier rate and UOM; that becomes the lot cost snapshot.", AMBER_SOFT, 120 * mm)]], colWidths=[125 * mm, 125 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 5 * mm)])]
    story += [PageBreak()]

    # Procurement page
    left = [p("DAILY WORKSPACE", KICKER), p("Find open work without one giant dropdown", H1), bullet("Overview shows daily purchasing and inward queues."), bullet("Purchase Orders separates open commitments from history."), bullet("Receiving guides PO-linked and manual GRN separately."), bullet("Search, status filters, pagination and printable documents support daily volume."), Spacer(1, 4 * mm), p("Before receiving", H2), p("Confirm supplier, SKU, packing, quantity, warehouse and physical batch. A received lot becomes commercial stock truth.", BODY)]
    right = screenshot("procurement-desktop.png", 170 * mm, 133 * mm, "Procurement workspace — overview, demand, purchase orders, receiving and history use one governed lifecycle.")
    story += [page_two_columns(left, right), PageBreak()]

    # Readiness
    left = [p("DELAYED COST", KICKER), p("Complete verified supplier costs when they arrive", H1), bullet("Only owner/admin users can access the permanent queue."), bullet("Unreceived and already received missing-cost lines stay visible."), bullet("Enter positive rate, UOM and reason for only the rows known today."), bullet("Received completion updates the original PO, GRN and exact lot without changing stock."), bullet("Existing positive costs are never silently overwritten."), Spacer(1, 4 * mm), p("Empty is healthy", H2), p("If no rows are shown, every non-cancelled PO line has a verified supplier cost.", BODY)]
    right = screenshot("po-cost-readiness-empty.png", 170 * mm, 133 * mm, "Permanent delayed-cost queue — truthful state for supplier costs still pending before or after inward.")
    story += [page_two_columns(left, right), PageBreak()]

    # Quote readiness
    left = [p("QUOTE PROTECTION", KICKER), p("Missing MRP is a setup task, never Rs. 0", H1), bullet("Quote search marks a SKU whose MRP is not ready."), bullet("The line remains visibly blocked from NRP/special pricing."), bullet("A direct link opens the MRP readiness queue."), bullet("Final payable shows setup required instead of a false zero."), bullet("Saved PDFs expose only MRP and final selling price to the customer."), Spacer(1, 4 * mm), p("Tile presentation", H2), p("Tile MRP and quoted rate are displayed per SQFT; box quantity remains the fulfilment unit.", BODY)]
    right = screenshot("quote-missing-mrp.png", 170 * mm, 133 * mm, "Quote Builder — an incomplete master blocks commercial output with an actionable setup state.")
    story += [page_two_columns(left, right), PageBreak()]

    # Roles / checklist
    story += section_intro("8 · Handover checklist", "Who does what every day", "Use named accounts. Do not share the owner login. Every price change and remediation keeps actor, reason and time.")
    role_rows = [
        [p("Role", TABLE_HEAD), p("Daily responsibility", TABLE_HEAD), p("Cannot do", TABLE_HEAD)],
        [p("Purchasing", TABLE_CELL), p("Create PO with optional supplier rate/UOM, discount and GST; print supplier document; monitor delayed costs", TABLE_CELL), p("Invent an unverified cost", TABLE_CELL_MUTED)],
        [p("Inventory", TABLE_CELL), p("Receive PO GRN; create manual GRN with positive rate; verify batch/location/packing", TABLE_CELL), p("Override PO-linked cost", TABLE_CELL_MUTED)],
        [p("Sales", TABLE_CELL), p("Quote from governed MRP; stay above floor or follow approval path", TABLE_CELL), p("See owner-only actual cost", TABLE_CELL_MUTED)],
        [p("Owner/Admin", TABLE_CELL), p("Complete MRP and permanent delayed-cost readiness; review audit and stock reconciliation", TABLE_CELL), p("Delete commercial history", TABLE_CELL_MUTED)],
    ]
    role_table = Table(role_rows, colWidths=[40 * mm, 135 * mm, 80 * mm], repeatRows=1)
    role_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RED_DARK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, CREAM]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    checklist = Table([
        [p("SHIFT-END CHECK", KICKER), "", ""],
        [bullet("Every missing PO cost remains visible in the delayed-cost queue."), bullet("All inward is posted to an exact lot and location."), bullet("Manual GRNs carry source reference and rate.")],
        [bullet("Tomorrow’s quoted SKUs have verified MRP."), bullet("Stock reconciliation has no unexplained critical row."), bullet("Cancelled work is voided with reason; nothing is deleted.")],
    ], colWidths=[85 * mm] * 3)
    checklist.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [role_table, Spacer(1, 6 * mm), checklist, Spacer(1, 6 * mm), p("Support path: open Help from the application header, select Purchasing & inward or Master pricing readiness, then use the exact workspace link in the guide.", CALLOUT)]
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frame = Frame(14 * mm, 15 * mm, PAGE_W - 28 * mm, PAGE_H - 28 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(str(OUTPUT), pagesize=PAGE, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=15 * mm, title="Marble Park Purchasing, Pricing and Lot-Cost Guide", author="Marble Park")
    doc.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=header_footer))
    doc.build(build_story())
    PUBLIC_OUTPUT.write_bytes(OUTPUT.read_bytes())
    print(f"Built {OUTPUT}")
    print(f"Copied {PUBLIC_OUTPUT}")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
