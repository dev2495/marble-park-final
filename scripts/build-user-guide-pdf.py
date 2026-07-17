#!/usr/bin/env python3
import json
import os
import shutil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "reports" / "marble-park-user-training-2026-07-17"
PUBLIC = ROOT / "apps" / "web" / "public" / "help"
DATA = REPORT / "guide-data.json"
OUTPUT = REPORT / "Marble-Park-ERP-Complete-User-Guide-2026-07-17.pdf"
PUBLIC_OUTPUT = PUBLIC / "Marble-Park-ERP-User-Guide.pdf"
LOGO = ROOT / "apps" / "web" / "public" / "brand" / "marble-park-logo.jpg"

INK = colors.HexColor("#18181b")
MUTED = colors.HexColor("#52525b")
LINE = colors.HexColor("#ded8d6")
SOFT = colors.HexColor("#f7f4f3")
BLUE = colors.HexColor("#8f241f")
BLUE_SOFT = colors.HexColor("#fff0ee")
GREEN = colors.HexColor("#0d7470")
GREEN_SOFT = colors.HexColor("#e7f5f3")


class GuideDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=17 * mm, bottomMargin=16 * mm, title="Marble Park ERP Complete User Guide", author="Marble Park")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="guide", frames=frame, onPage=self._decorate))

    def _decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(self.leftMargin, A4[1] - 11 * mm, A4[0] - self.rightMargin, A4[1] - 11 * mm)
        if LOGO.exists():
            canvas.drawImage(str(LOGO), self.leftMargin, A4[1] - 9.6 * mm, width=4.2 * mm, height=6.3 * mm, preserveAspectRatio=True, anchor="c", mask="auto")
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(INK)
        canvas.drawString(self.leftMargin + 6 * mm, A4[1] - 8 * mm, "MARBLE PARK ERP")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - self.rightMargin, 8 * mm, f"Complete user guide  |  {doc.page}")
        canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=11, textColor=BLUE, spaceAfter=4, uppercase=True))
styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=28, leading=31, textColor=INK, alignment=TA_CENTER, spaceAfter=12))
styles.add(ParagraphStyle(name="GuideTitle", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceBefore=10, spaceAfter=5))
styles.add(ParagraphStyle(name="BodyMP", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=MUTED, spaceAfter=6))
styles.add(ParagraphStyle(name="Step", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13, textColor=INK, leftIndent=12, firstLineIndent=-12, spaceAfter=5))
styles.add(ParagraphStyle(name="Check", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.7, leading=12, textColor=MUTED, leftIndent=10, firstLineIndent=-10, spaceAfter=4))
styles.add(ParagraphStyle(name="TOC", parent=styles["BodyText"], fontName="Helvetica", fontSize=10, leading=14, textColor=INK, spaceAfter=5))


def fit_image(source: Path, max_width: float, max_height: float):
    with PILImage.open(source) as image:
        width, height = image.size
    ratio = min(max_width / width, max_height / height)
    return Image(str(source), width=width * ratio, height=height * ratio)


def flow_table(flow):
    cells = []
    for index, step in enumerate(flow):
        cells.append(Paragraph(f"<b>{step}</b>", ParagraphStyle("Flow", parent=styles["BodyMP"], fontSize=7.6, leading=9, textColor=BLUE, alignment=TA_CENTER)))
        if index < len(flow) - 1:
            cells.append(Paragraph("-&gt;", ParagraphStyle("Arrow", parent=styles["BodyMP"], fontSize=8, textColor=MUTED, alignment=TA_CENTER)))
    widths = []
    step_width = (178 * mm - max(0, len(flow) - 1) * 6 * mm) / max(1, len(flow))
    for index in range(len(cells)):
        widths.append(6 * mm if index % 2 else step_width)
    table = Table([cells], colWidths=widths)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_SOFT),
        ("BACKGROUND", (1, 0), (1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def build():
    payload = json.loads(DATA.read_text())
    guides = payload["guides"]
    story = [Spacer(1, 10 * mm)]
    if LOGO.exists():
        cover_logo = fit_image(LOGO, 24 * mm, 34 * mm)
        cover_logo.hAlign = "CENTER"
        story += [cover_logo, Spacer(1, 5 * mm)]
    story += [Paragraph("MARBLE PARK RETAIL OPERATIONS", styles["Eyebrow"]), Paragraph("Complete user guide", styles["CoverTitle"]), Paragraph("Customer promise to physical fulfilment", ParagraphStyle("Subtitle", parent=styles["BodyMP"], fontSize=14, leading=20, alignment=TA_CENTER, textColor=MUTED)), Spacer(1, 12 * mm)]
    lifecycle = Table([[Paragraph(f"<b>0{i + 1}</b><br/>{label}", ParagraphStyle(f"Life{i}", parent=styles["BodyMP"], fontSize=8, leading=11, alignment=TA_CENTER, textColor=INK)) for i, label in enumerate(["Lead + intent", "Quote + revision", "Partial order", "Reserve / procure", "Pick + dispatch", "Payment + return"])]], colWidths=[29.5 * mm] * 6)
    lifecycle.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), .6, LINE), ("INNERGRID", (0, 0), (-1, -1), .4, LINE), ("BACKGROUND", (0, 0), (-1, -1), SOFT), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [lifecycle, Spacer(1, 14 * mm), Paragraph("For showroom sales, office, inventory, dispatch, managers and owners. This manual explains both the action and the control that proves the action was completed correctly.", ParagraphStyle("CoverBody", parent=styles["BodyMP"], fontSize=11, leading=17, alignment=TA_CENTER, textColor=MUTED)), PageBreak(), Paragraph("Guide index", styles["GuideTitle"])]
    for index, guide in enumerate(guides):
        story.append(Paragraph(f"<b>{index + 1:02d}</b> &nbsp; {guide['title']} &nbsp; <font color='#52525b'>{guide['duration']} | {' / '.join(guide['roles'])}</font>", styles["TOC"]))
    story.append(PageBreak())

    for index, guide in enumerate(guides):
        story += [Paragraph(f"{index + 1:02d}  /  {' - '.join(guide['roles']).upper()}  /  {guide['duration']}", styles["Eyebrow"]), Paragraph(guide["title"], styles["GuideTitle"]), Paragraph(guide["summary"], styles["BodyMP"]), Spacer(1, 3 * mm), flow_table(guide["flow"]), Spacer(1, 4 * mm)]
        image_value = guide.get("image")
        if image_value:
            source = PUBLIC / "images" / Path(image_value).name
            if source.exists():
                picture = fit_image(source, 178 * mm, 87 * mm)
                picture.hAlign = "CENTER"
                story += [picture, Spacer(1, 3 * mm)]
        steps = [Paragraph("How to complete it", styles["Section"])]
        steps.extend(Paragraph(f"<b>{step_index + 1}.</b> {step}", styles["Step"]) for step_index, step in enumerate(guide["steps"]))
        checks = [Paragraph("Before you finish", styles["Section"])]
        checks.extend(Paragraph(f"<font color='#176b4d'><b>OK</b></font> {check}", styles["Check"]) for check in guide["checks"])
        check_box = Table([[checks]], colWidths=[54 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT), ("BOX", (0, 0), (-1, -1), .5, colors.HexColor("#b8dfcc")), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        content = Table([[steps, check_box]], colWidths=[118 * mm, 57 * mm], hAlign="LEFT")
        content.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 6), ("TOPPADDING", (0, 0), (-1, -1), 0)]))
        story.append(content)
        if guide.get("video"):
            story += [Spacer(1, 3 * mm), Paragraph(f"Training video: {Path(guide['video']).name}", styles["BodyMP"])]
        if index < len(guides) - 1:
            story.append(PageBreak())

    doc = GuideDoc(str(OUTPUT))
    doc.build(story)
    shutil.copy2(OUTPUT, PUBLIC_OUTPUT)
    print(json.dumps({"ok": True, "guides": len(guides), "reportPdf": str(OUTPUT), "publicPdf": str(PUBLIC_OUTPUT)}, indent=2))


if __name__ == "__main__":
    build()
