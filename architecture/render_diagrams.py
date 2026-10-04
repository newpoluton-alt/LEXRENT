"""Draw the proposed architecture as editable SVGs and high-resolution JPGs.

Uses code-based vector primitives and Pillow; no image-generation service.
Run with the workspace Python runtime (Pillow required).
"""

from pathlib import Path
import html
import math
import zipfile
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
SCALE = 2
FONT = Path('/System/Library/Fonts/Avenir Next.ttc')
MONO = Path('/System/Library/Fonts/Menlo.ttc')
C = {
    'background': '#F7F9FC', 'ink': '#14253B', 'muted': '#516278',
    'border': '#D9E2EC', 'line': '#7B8CA0', 'white': '#FFFFFF',
    'blue': '#2463B3', 'blue_tint': '#EDF4FD',
    'teal': '#007D76', 'teal_tint': '#ECF8F5',
    'purple': '#7450B7', 'purple_tint': '#F3EEFA',
    'amber': '#946B12', 'amber_tint': '#FFF5DD',
}


class Canvas:
    def __init__(self, width=2400, height=1780):
        self.width, self.height = width, height
        self.im = Image.new('RGB', (width * SCALE, height * SCALE), C['background'])
        self.d = ImageDraw.Draw(self.im)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
                    '<title>Rental Housing Law Navigator — proposed architecture</title>',
                    '<desc>Code-rendered architecture, refined from the supplied handwritten sketch and participant guide.</desc>',
                    f'<rect width="{width}" height="{height}" fill="{C["background"]}"/>']
        self.fonts = {}

    def font(self, size, weight='regular', mono=False):
        key = size, weight, mono
        if key not in self.fonts:
            if mono:
                self.fonts[key] = ImageFont.truetype(str(MONO), int(size * SCALE))
            else:
                index = {'regular': 7, 'medium': 5, 'bold': 0, 'demi': 2}[weight]
                self.fonts[key] = ImageFont.truetype(str(FONT), int(size * SCALE), index=index)
        return self.fonts[key]

    def rect(self, x, y, w, h, fill, stroke=None, radius=0, line_width=2):
        box = tuple(round(v * SCALE) for v in (x, y, x+w, y+h))
        if radius:
            self.d.rounded_rectangle(box, radius=round(radius*SCALE), fill=fill, outline=stroke, width=round(line_width*SCALE))
        else:
            self.d.rectangle(box, fill=fill, outline=stroke, width=round(line_width*SCALE))
        border = f' stroke="{stroke}" stroke-width="{line_width}"' if stroke else ''
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}"{border}/>')

    def text(self, x, y, value, size=24, color=None, weight='regular', mono=False, max_width=None):
        color = color or C['ink']
        font = self.font(size, weight, mono)
        width = self.d.textlength(value, font=font) / SCALE
        if max_width is not None and width > max_width + 0.5:
            raise ValueError(f'Text exceeds its box: {value!r} ({width:.1f} > {max_width})')
        if x < 0 or y < 0 or x + width > self.width:
            raise ValueError(f'Text outside canvas: {value!r}')
        self.d.text((round(x*SCALE), round(y*SCALE)), value, font=font, fill=color, anchor='lt')
        family = 'Menlo, Consolas, monospace' if mono else "'Avenir Next', Arial, sans-serif"
        svg_weight = '700' if weight == 'bold' else '600' if weight == 'demi' else '500' if weight == 'medium' else '400'
        self.svg.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{svg_weight}" dominant-baseline="text-before-edge">{html.escape(value)}</text>')
        return width

    def lines(self, x, y, values, size=24, leading=35, max_width=None, **kwargs):
        for i, value in enumerate(values):
            self.text(x, y + leading*i, value, size, max_width=max_width, **kwargs)

    def line(self, points, color=None, width=3, arrow=False):
        color = color or C['line']
        xy = [(round(x*SCALE), round(y*SCALE)) for x, y in points]
        self.d.line(xy, fill=color, width=round(width*SCALE), joint='curve')
        pts = ' '.join(f'{x},{y}' for x, y in points)
        self.svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/>')
        if arrow:
            x, y = points[-1]
            px, py = points[-2]
            angle = math.atan2(y-py, x-px)
            length, half = 15, 7
            back = (x-length*math.cos(angle), y-length*math.sin(angle))
            triangle = [(x, y), (back[0]+half*math.sin(angle), back[1]-half*math.cos(angle)),
                        (back[0]-half*math.sin(angle), back[1]+half*math.cos(angle))]
            self.d.polygon([(round(a*SCALE), round(b*SCALE)) for a, b in triangle], fill=color)
            pts = ' '.join(f'{a},{b}' for a, b in triangle)
            self.svg.append(f'<polygon points="{pts}" fill="{color}"/>')

    def ellipse(self, x, y, w, h, fill, stroke=None, width=2):
        self.d.ellipse(tuple(round(v*SCALE) for v in (x, y, x+w, y+h)), fill=fill, outline=stroke, width=round(width*SCALE))
        border = f' stroke="{stroke}" stroke-width="{width}"' if stroke else ''
        self.svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{fill or "none"}"{border}/>')

    def polygon(self, points, fill, stroke=None, width=2):
        xy = [(round(x*SCALE), round(y*SCALE)) for x, y in points]
        self.d.polygon(xy, fill=fill)
        if stroke:
            self.d.line(xy+[xy[0]], fill=stroke, width=round(width*SCALE), joint='curve')
        pts = ' '.join(f'{x},{y}' for x, y in points)
        border = f' stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round"' if stroke else ''
        self.svg.append(f'<polygon points="{pts}" fill="{fill}"{border}/>')

    def dashed(self, points, color=None, width=2, dash=10, gap=8, arrow=False):
        color = color or C['line']
        for a, b in zip(points, points[1:]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            distance = math.hypot(dx, dy)
            if not distance:
                continue
            pos = 0
            while pos < distance:
                end = min(pos+dash, distance)
                segment = [(round((a[0]+dx*p/distance)*SCALE), round((a[1]+dy*p/distance)*SCALE)) for p in (pos, end)]
                self.d.line(segment, fill=color, width=round(width*SCALE))
                pos += dash+gap
        pts = ' '.join(f'{x},{y}' for x, y in points)
        self.svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-dasharray="{dash} {gap}"/>')
        if arrow:
            a, b = points[-2], points[-1]
            distance = math.hypot(b[0]-a[0], b[1]-a[1])
            near = (b[0]-(b[0]-a[0])*1/distance, b[1]-(b[1]-a[1])*1/distance)
            self.line([near, b], color, width, arrow=True)

    def centered(self, cx, y, value, size=24, **kwargs):
        width = self.d.textlength(value, font=self.font(size, kwargs.get('weight', 'regular'), kwargs.get('mono', False))) / SCALE
        self.text(cx-width/2, y, value, size, **kwargs)

    def icon(self, kind, x, y, accent, size=38):
        s = size
        if kind == 'chip':
            self.rect(x+7, y+7, s-14, s-14, C['white'], accent, radius=5)
            self.rect(x+14, y+14, s-28, s-28, accent, radius=2)
            for p in (12, 21, 30):
                self.line([(x+p, y), (x+p, y+7)], accent, 2)
                self.line([(x+p, y+s-7), (x+p, y+s)], accent, 2)
                self.line([(x, y+p), (x+7, y+p)], accent, 2)
                self.line([(x+s-7, y+p), (x+s, y+p)], accent, 2)
        elif kind == 'service':
            for dy in (0, 13, 26):
                self.rect(x, y+dy, s, 10, C['white'], accent, radius=3)
                self.ellipse(x+5, y+dy+3, 4, 4, accent)
                self.line([(x+17, y+dy+5), (x+31, y+dy+5)], accent, 2)
        elif kind == 'user':
            self.ellipse(x+12, y, 15, 15, C['white'], accent, 3)
            self.line([(x+20, y+15), (x+20, y+31)], accent, 3)
            self.line([(x+5, y+23), (x+35, y+23)], accent, 3)
            self.line([(x+20, y+31), (x+8, y+42)], accent, 3)
            self.line([(x+20, y+31), (x+32, y+42)], accent, 3)

    def document(self, x, y, w, h, title, body, accent, footer, tag='SOURCE DOCUMENTS'):
        fold = 40
        self.polygon([(x, y), (x+w-fold, y), (x+w, y+fold), (x+w, y+h), (x, y+h)], C['white'], C['border'])
        tint = C['blue_tint'] if accent == C['blue'] else C['teal_tint']
        self.polygon([(x+w-fold, y), (x+w-fold, y+fold), (x+w, y+fold)], tint, C['border'])
        self.text(x+25, y+23, tag, 18, accent, 'bold', max_width=w-85)
        self.text(x+25, y+62, title, 30, weight='demi', max_width=w-50)
        self.lines(x+25, y+117, body, 24, 35, max_width=w-50, color=C['muted'])
        self.line([(x+25, y+h-58), (x+w-25, y+h-58)], C['border'], 1)
        self.text(x+25, y+h-39, footer, 20, accent, mono=True, max_width=w-50)

    def cylinder(self, x, y, w, h, title, body, accent, footer=None, compact=False):
        ry = 23 if not compact else 15
        # Bottom ellipse, covered by the body, leaves only the lower arc visible.
        self.ellipse(x, y+h-2*ry, w, 2*ry, C['white'], C['border'])
        self.rect(x, y+ry, w, h-2*ry, C['white'])
        self.line([(x, y+ry), (x, y+h-ry)], C['border'], 2)
        self.line([(x+w, y+ry), (x+w, y+h-ry)], C['border'], 2)
        self.ellipse(x, y, w, 2*ry, C['blue_tint'] if accent == C['blue'] else C['teal_tint'], C['border'])
        if compact:
            self.centered(x+w/2, y+2*ry+10, title, 25, weight='demi', max_width=w-40)
            return
        self.text(x+25, y+64, 'VERSIONED DATA STORE', 18, accent, 'bold', max_width=w-50)
        self.text(x+25, y+105, title, 30, weight='demi', max_width=w-50)
        self.lines(x+25, y+158, body, 23, 33, max_width=w-50, color=C['muted'])
        if footer:
            self.text(x+25, y+h-52, footer, 20, accent, mono=True, max_width=w-50)

    def gate(self, x, y, w, h, title, body, accent):
        cx, cy = x+w/2, y+h/2
        self.polygon([(cx, y), (x+w, cy), (cx, y+h), (x, cy)], C['white'], accent, 3)
        self.centered(cx, cy-42, title, 30, weight='demi', max_width=w-70)
        self.centered(cx, cy+12, body, 23, color=C['muted'], max_width=w-85)

    def entity(self, x, y, w, h, title, fields, accent, footer=None):
        self.rect(x, y, w, h, C['white'], C['border'], radius=16)
        self.rect(x, y, w, 62, C['blue_tint'] if accent == C['blue'] else C['teal_tint'], radius=16)
        self.rect(x, y+40, w, 22, C['blue_tint'] if accent == C['blue'] else C['teal_tint'])
        self.text(x+25, y+18, title, 28, accent, 'bold', mono=True, max_width=w-50)
        for i, field in enumerate(fields):
            self.text(x+25, y+87+i*32, field, 23, C['ink'] if field.startswith(('PK', 'FK')) else C['muted'], mono=True, max_width=w-50)
        if footer:
            self.line([(x+25, y+h-57), (x+w-25, y+h-57)], C['border'], 1)
            self.text(x+25, y+h-38, footer, 19, accent, 'demi', max_width=w-50)

    def relationship(self, points, start='1', end='N', color=None):
        color = color or C['line']
        self.line(points, color, 3)
        for endpoint, inside, cardinality in [(points[0], points[1], start), (points[-1], points[-2], end)]:
            dx, dy = inside[0]-endpoint[0], inside[1]-endpoint[1]
            distance = math.hypot(dx, dy)
            ux, uy = dx/distance, dy/distance
            vx, vy = -uy, ux
            def at(a, b=0):
                return (endpoint[0]+a*ux+b*vx, endpoint[1]+a*uy+b*vy)
            if 'N' in cardinality:
                for side in (-11, 0, 11):
                    self.line([at(24), at(2, side)], color, 3)
            else:
                self.line([at(13, -10), at(13, 10)], color, 3)
            if cardinality.startswith('0'):
                center = at(36)
                self.ellipse(center[0]-6, center[1]-6, 12, 12, C['background'], color, 2)

    def browser(self, x, y, w, h):
        self.rect(x, y, w, h, C['white'], C['border'], radius=18)
        self.rect(x, y, w, 48, C['purple_tint'], radius=18)
        self.rect(x, y+28, w, 20, C['purple_tint'])
        for i, color in enumerate(('#B8A7D6', '#CBBFDF', '#DDD3EB')):
            self.ellipse(x+25+i*24, y+17, 12, 12, color)
        self.text(x+122, y+13, 'FRONTEND TEAM · LOVABLE APP', 19, C['purple'], 'bold', max_width=w-160)
        self.text(x+28, y+73, 'Lookup · Evidence · Changes', 31, weight='demi', max_width=w-56)
        col = (w-80)/3
        content = [('PROPERTY LOOKUP', ['Address + query date', 'Coverage + missing facts']),
                   ('SOURCE EVIDENCE', ['Exact source quotations', 'Citations + retrieval dates']),
                   ('CHANGE EXPLORER', ['Lifecycle + effective dates', 'Affected IDs + conflicts'])]
        for i, (label, body) in enumerate(content):
            xx = x+28+i*(col+12)
            self.text(xx, y+135, label, 17, C['purple'], 'bold', max_width=col)
            self.lines(xx, y+169, body, 22, 31, max_width=col, color=C['muted'])
            if i:
                self.line([(xx-16, y+130), (xx-16, y+h-55)], C['border'], 1)
        self.text(x+28, y+h-34, 'Group by law; show a separate result per rule.  |  Not legal advice', 20, C['purple'], 'demi', max_width=w-56)

    def chip(self, x, y, label, color, fill, w=None, size=20, h=42):
        text_width = self.d.textlength(label, font=self.font(size, 'demi')) / SCALE
        w = w or text_width + 36
        self.rect(x, y, w, h, fill, radius=12)
        self.text(x+18, y+(h-size)/2-1, label, size, color, 'demi', max_width=w-36)
        return w

    def card(self, x, y, w, title, tag, body, accent, footer=None, h=270):
        self.rect(x, y+5, w, h, '#E8EEF5', radius=18)
        self.rect(x, y, w, h, C['white'], C['border'], radius=18)
        self.rect(x+25, y+23, 5, 22, accent, radius=2)
        self.text(x+42, y+22, tag, 18, accent, 'bold', max_width=w-68)
        self.text(x+25, y+62, title, 30, weight='demi', max_width=w-50)
        self.lines(x+25, y+117, body, 24, 35, max_width=w-50, color=C['muted'])
        if footer:
            self.line([(x+25, y+h-58), (x+w-25, y+h-58)], C['border'], 1)
            self.text(x+25, y+h-39, footer, 20, accent, mono=True, max_width=w-50)

    def step(self, x, y, w, number, title, body, accent, tint, h=150):
        self.rect(x, y, w, h, C['white'], C['border'], radius=16)
        self.rect(x+22, y+25, 47, 47, tint, radius=13)
        self.text(x+31, y+35, f'{number:02}', 22, accent, 'bold', max_width=38)
        self.text(x+89, y+29, title, 29, weight='demi', max_width=w-115)
        self.lines(x+89, y+82, body, 23, 33, max_width=w-115, color=C['muted'])

    def save(self, stem):
        jpg = OUT / f'{stem}.jpg'
        self.im.save(jpg, 'JPEG', quality=96, subsampling=0, dpi=(240, 240))
        (OUT / f'{stem}.svg').write_text('\n'.join(self.svg + ['</svg>']), encoding='utf-8')
        # Small companion used for visual inspection; final JPG retains full resolution.
        preview = self.im.copy()
        preview.thumbnail((1600, 1200), Image.Resampling.LANCZOS)
        preview.save(OUT / f'{stem}-preview.jpg', 'JPEG', quality=94, subsampling=0)
        print(f'{jpg.name}: {self.im.width} x {self.im.height}')


def header(c, title, subtitle, diagram_number):
    c.text(80, 63, 'RENTAL HOUSING LAW NAVIGATOR', 21, C['blue'], 'bold')
    c.text(80, 108, title, 52, weight='bold', max_width=2030)
    c.text(80, 182, subtitle, 28, C['muted'], max_width=2200)
    c.chip(2080, 65, f'DIAGRAM {diagram_number:02}', C['muted'], '#E9EFF6', w=240)


def team_lane(c, y, h, team, title_lines, owner, accent, tint):
    c.rect(80, y, 2240, h, tint, C['border'], radius=24)
    c.chip(109, y+38, team, accent, C['white'], w=220, h=44, size=19)
    c.lines(110, y+111, title_lines, 29, 42, max_width=205, weight='bold')
    c.lines(110, y+239, owner, 22, 31, max_width=205, color=accent, weight='demi')


def overview():
    c = Canvas(height=2000)
    header(c, 'Architecture by team', 'AI extracts distinct requirements; backend evaluates them; frontend presents results and evidence.', 1)
    team_lane(c, 280, 445, 'AI TEAM', ['Rules &', 'evidence'], ['Claude credits'], C['blue'], C['blue_tint'])
    team_lane(c, 840, 420, 'BACKEND TEAM', ['Matching,', 'changes & API'], ['Codex'], C['teal'], C['teal_tint'])
    team_lane(c, 1420, 375, 'FRONTEND TEAM', ['Experience', '& navigation'], ['Lovable'], C['purple'], C['purple_tint'])

    c.document(350, 360, 420, 270, 'Legal sources',
               ['Corpus text + manifest', 'Acquire permitted linked text', 'Source status + retrieval dates'], C['blue'], 'captured public sources')
    c.card(825, 360, 420, 'Claude extraction', 'AI PROCESSOR',
           ['Chunk captured source text', 'Extract distinct requirements', 'Attach evidence + conditions'], C['blue'], 'one law / multiple rules')
    c.icon('chip', 1180, 379, C['blue'])
    c.centered(1510, 319, 'QUALITY GATE', 18, color=C['blue'], weight='bold')
    c.gate(1300, 360, 420, 270, 'Evidence valid?', 'Schema + exact quotes', C['blue'])
    c.cylinder(1775, 350, 520, 330, 'Verified rule bundle',
               ['Independent rule versions', 'Conditions + lifecycle dates', 'Exact evidence + source lineage'], C['blue'], 'rules.json + internal records')
    c.line([(777, 495), (815, 495)], C['blue'], 3, arrow=True)
    c.line([(1252, 495), (1290, 495)], C['blue'], 3, arrow=True)
    c.line([(1728, 495), (1765, 495)], C['blue'], 3, arrow=True)
    c.text(1726, 461, 'pass', 18, C['blue'], 'demi')
    c.line([(1510, 630), (1510, 667)], C['amber'], 3, arrow=True)
    c.chip(1388, 670, 'Review / retry', C['amber'], C['amber_tint'], w=244, size=21, h=43)
    c.line([(2035, 680), (2035, 775), (1510, 775), (1510, 900)], C['blue'], 4, arrow=True)
    c.text(1470, 742, 'Validated rules + provenance', 23, C['blue'], 'demi', max_width=555)

    y = 900
    c.document(350, y, 420, 270, 'Property inputs',
               ['500 public sample properties', 'Known and missing facts', 'Selected query date'], C['teal'], 'sample_addresses.csv', tag='PROPERTY DATA FILE')
    c.card(825, y, 420, 'Legal jurisdiction', 'LOCATION SERVICE',
           ['Normalize and verify address', 'Resolve legal state / city', 'Record match uncertainty'], C['teal'], 'verified municipality match')
    c.icon('service', 1180, y+20, C['teal'])
    c.card(1300, y, 420, 'Rule evaluator', 'COVERAGE + CHANGES',
           ['Date + jurisdiction + facts', 'Unknown + precedence + flags', 'T1–T5 scenario evaluation'], C['teal'], 'persist rule-level results')
    c.card(1775, y, 520, 'API & exports', 'BACKEND SERVICE',
           ['Search, lookup, changes, evidence', 'Result records + audit trail', 'Export required submission JSON'], C['teal'], 'lookups.json + changes.json')
    c.icon('service', 2230, y+20, C['teal'])
    for right, left in [(770, 825), (1245, 1300), (1720, 1775)]:
        c.line([(right+7, y+135), (left-10, y+135)], C['teal'], 3, arrow=True)
    c.text(350, 862, 'DATE / SCENARIO INPUTS · T1–T5 · ONE SHARED EVALUATOR', 19, C['teal'], 'bold', max_width=850)

    c.line([(2035, 1170), (2035, 1480)], C['purple'], 4, arrow=True)
    c.line([(2035, 1465), (2035, 1180)], C['purple'], 4, arrow=True)
    c.text(1635, 1335, 'Stable JSON API contract', 25, C['purple'], 'demi', max_width=620)
    c.card(350, 1480, 590, 'User interaction', 'ADDRESS-FIRST WORKFLOW',
           ['Search address + choose date', 'Confirm the matched property', 'Provide missing facts if known'], C['purple'], h=250)
    c.icon('user', 863, 1500, C['purple'])
    c.line([(947, 1605), (1020, 1605)], C['purple'], 4, arrow=True)
    c.browser(1030, 1480, 1265, 270)

    c.text(80, 1840, 'NOTATION', 18, C['muted'], 'bold')
    c.polygon([(240, 1840), (260, 1840), (271, 1851), (271, 1875), (240, 1875)], C['white'], C['line'])
    c.text(285, 1847, 'Document / input', 21, C['muted'])
    c.icon('chip', 625, 1838, C['blue'])
    c.text(679, 1847, 'AI processor', 21, C['muted'])
    c.polygon([(992, 1838), (1011, 1857), (992, 1876), (973, 1857)], C['white'], C['blue'])
    c.text(1028, 1847, 'Validation decision', 21, C['muted'])
    c.cylinder(1408, 1835, 50, 43, '', [], C['teal'], compact=True)
    c.text(1477, 1847, 'Database / store', 21, C['muted'])
    c.rect(1850, 1838, 47, 38, C['white'], C['purple'], radius=5)
    c.line([(1851, 1849), (1896, 1849)], C['purple'], 2)
    c.text(1915, 1847, 'Browser interface', 21, C['muted'])
    c.rect(80, 1910, 2240, 55, '#EAF0F6', radius=14)
    c.text(108, 1927, 'TRACE EVERY ANSWER', 18, C['ink'], 'bold')
    c.text(370, 1926, 'Source capture + retrieval date · rule version · property facts · query date · decision rationale', 22, C['muted'], max_width=1910)
    c.text(80, 1978, 'Proposed architecture · team ownership is separate from logical data storage', 17, C['muted'])
    c.save('01-system-architecture')


def detailed_flow():
    c = Canvas()
    header(c, 'From property lookup to change impact', 'Backend team: one deterministic evaluator serves both flows. Frontend displays the results and evidence.', 2)
    c.rect(80, 280, 1080, 1215, C['teal_tint'], C['border'], radius=24)
    c.rect(1240, 280, 1080, 1215, C['teal_tint'], C['border'], radius=24)
    c.text(120, 314, 'ADDRESS LOOKUP', 25, C['teal'], 'bold')
    c.text(1280, 314, 'CHANGE-IMPACT EVALUATION', 25, C['teal'], 'bold')

    lookup = [
        ('Search + query date', ['Select a matched sample property.', 'Default as-of date: 2026-10-01.']),
        ('Resolve jurisdiction + property facts', ['Normalize address; verify legal state / municipality.', 'Keep unresolved location and missing facts explicit.']),
        ('Select rule versions', ['Use verified rules for the resolved jurisdiction.', 'Evaluate enacted / effective / pending status as of date.']),
        ('Evaluate applicability', ['Test coverage; preserve unknown; apply supported precedence.', 'Flag conflicts and explain every decision.']),
        ('Return a cited answer', ['Rule ID + result + explanation + conflict flag.', 'Attach exact source text, URL and retrieval date.']),
    ]
    change = [
        ('Load change case', ['T1–T5: jurisdictions, dates and lifecycle status.', 'Pending cases are hypothetical; failed cases stay inactive.']),
        ('Build date / scenario snapshots', ['Select rule versions for each supplied query date or scenario.', 'Use the same verified property and jurisdiction facts.']),
        ('Reuse applicability engine', ['Evaluate all 500 properties under each scenario.', 'Use the identical coverage, precedence and conflict logic.']),
        ('Identify affected addresses', ["Apply each supplied test's affected-set criteria.", 'Keep conflict IDs and unresolved facts visible.']),
        ('Export change results', ['Affected address IDs + conflict address IDs + notes.', 'T5 retains a failed rule record and an empty affected set.']),
    ]
    for x, steps, accent, tint in [(120, lookup, C['teal'], C['teal_tint']), (1280, change, C['teal'], C['teal_tint'])]:
        for i, (title, body) in enumerate(steps):
            y = 380 + i*220
            c.step(x, y, 1000, i+1, title, body, accent, tint)
            if i < len(steps)-1:
                c.line([(x+500, y+158), (x+500, y+208)], accent, 3, arrow=True)
    c.text(120, 1455, 'Backend via API to Lovable lookup + evidence view', 20, C['teal'], 'demi', max_width=995)
    c.text(1280, 1455, 'changes.json via API to Lovable change explorer', 20, C['teal'], 'demi', max_width=995)

    c.text(80, 1540, 'LOOKUP RESULT VALUES', 19, C['muted'], 'bold')
    statuses = [
        ('applies', C['teal'], C['teal_tint']),
        ('unknown', C['amber'], C['amber_tint']),
        ('superseded', C['muted'], '#EAF0F6'),
        ('not_yet_effective', C['blue'], C['blue_tint']),
        ('pending', C['purple'], C['purple_tint']),
    ]
    for i, (label, accent, tint) in enumerate(statuses):
        c.chip(80 + i*454, 1580, label, accent, tint, w=424, size=24, h=58)
    c.text(80, 1670, 'Non-matching rules are omitted. Unknown is a valid result when the required facts are unavailable.', 26, C['ink'], max_width=2240)
    c.text(80, 1723, 'Every displayed answer retains its query date and source evidence. A failed proposal never activates a current rule.', 22, C['muted'], max_width=2240)
    c.save('02-lookup-and-change-flow')


def database_model():
    c = Canvas(height=2200)
    header(c, 'Database & record relationships', 'Eight logical entities: independent requirements, immutable evidence, and reproducible evaluations.', 3)
    c.rect(80, 280, 1080, 1665, C['blue_tint'], C['border'], radius=24)
    c.rect(1240, 280, 1080, 1665, C['teal_tint'], C['border'], radius=24)
    c.text(120, 308, 'LEGAL RECORDS · AI TEAM PRODUCES', 24, C['blue'], 'bold')
    c.text(1300, 308, 'OPERATIONAL RECORDS · BACKEND TEAM', 24, C['teal'], 'bold')
    ys = [350, 760, 1170, 1580]
    h, w = 320, 980

    # Relationship lines are drawn before entities so they cannot cross field text.
    for a, b in [(ys[0]+h, ys[1]), (ys[1]+h, ys[2])]:
        c.relationship([(610, a), (610, b)], color=C['blue'])
        c.text(636, a+29, '1 : N', 19, C['blue'], 'demi')
    c.relationship([(610, ys[3]), (610, ys[2]+h)], color=C['blue'])
    c.text(636, ys[2]+h+29, '1 : N', 19, C['blue'], 'demi')
    c.relationship([(1790, ys[0]+h), (1790, ys[1])], start='0..1', end='N', color=C['teal'])
    c.text(1816, ys[0]+h+29, '0..1 : N · case is optional on a run', 19, C['teal'], 'demi')
    c.relationship([(1790, ys[1]+h), (1790, ys[2])], color=C['teal'])
    c.text(1816, ys[1]+h+29, '1 : N', 19, C['teal'], 'demi')
    c.relationship([(1790, ys[3]), (1790, ys[2]+h)], color=C['teal'])
    c.text(1816, ys[2]+h+29, '1 : N', 19, C['teal'], 'demi')
    c.relationship([(1100, 960), (1197, 960), (1197, 1355), (1300, 1355)], color=C['line'])
    c.text(1126, 1090, '1 : N', 19, C['muted'], 'demi')

    c.entity(120, ys[0], w, h, 'LAW', [
        'PK law_id', 'title, instrument_identifier, authority_level',
        'issuing_state, issuing_legal_city',
    ], C['blue'], 'Groups distinct obligations; applicability is computed per rule.')
    c.entity(120, ys[1], w, h, 'RULE_VERSION', [
        'PK rule_version_id', 'FK law_id; team_rule_id, version, category',
        'title, citation, requirement, key_value',
        'coverage_ast, exemptions, interactions',
        'lifecycle_dates, extraction_version', 'source_bundle_hash',
    ], C['blue'], 'Unique(team_rule_id, version); one stable ID per requirement.')
    c.entity(120, ys[2], w, h, 'RULE_EVIDENCE', [
        'PK evidence_id', 'FK rule_version_id, source_id',
        'quoted_span, start_offset, end_offset',
        'evidence_role, primary_citation',
    ], C['blue'], 'Junction: many rule versions can cite many source captures.')
    c.entity(120, ys[3], w, h, 'SOURCE_DOCUMENT', [
        'PK source_id  (immutable capture)', 'doc_id, source_url, capture_status',
        'retrieved_at, content_hash', 'text_location, capture_version',
    ], C['blue'], 'Retain captured text; retrieval time is separate from law dates.')

    c.entity(1300, ys[0], w, h, 'CHANGE_CASE', [
        'PK test_id  (T1–T5)', 'type, query_dates, jurisdiction_filter',
        'rule_references, hypothetical_scenario', 'affected_set_criteria',
    ], C['teal'], 'Supports date, boundary, hypothetical and negative cases.')
    c.entity(1300, ys[1], w, h, 'EVALUATION_RUN', [
        'PK run_id', 'FK test_id  (nullable for ordinary lookups)',
        'run_type, requested_as_of, scenarios',
        'rule_bundle_hash, property_data_hash',
        'input_snapshot_ref, fact_overrides_json',
        'executed_at, change_summary_json',
    ], C['teal'], 'Summary retains affected IDs, conflict IDs and case notes.')
    c.entity(1300, ys[2], w, h, 'EVALUATION_RESULT', [
        'PK result_id', 'FK run_id, address_id, rule_version_id',
        'as_of, scenario_key, result', 'explanation, conflict_flag',
        'conflict_rule_ids, missing_facts',
    ], C['teal'], 'One result per run / property / rule version / date / scenario.')
    c.entity(1300, ys[3], w, h, 'PROPERTY', [
        'PK address_id', 'street_address, normalized_address',
        'postal_city, legal_state, legal_city', 'municipality_id, resolution_status',
        'year_built, units, facts_json', 'dataset_source, retrieved_at',
    ], C['teal'], 'Keep missing facts null and explain unresolved jurisdiction.')

    c.rect(80, 1980, 2240, 147, '#EAF0F6', radius=18)
    c.text(110, 2002, 'ONE LAW / MANY REQUIREMENTS', 20, C['blue'], 'bold')
    c.text(110, 2041, 'Each requirement has its own coverage, dates, evidence and result. Successive versions retain the same rule ID.', 24, C['ink'], max_width=2180)
    c.text(110, 2086, 'Logical model: SQL tables or versioned JSON records. Frontend accesses these records through the backend API.', 22, C['muted'], max_width=2180)
    c.text(80, 2160, 'Crow’s feet indicate many. PK = primary key; FK = foreign key. Shared data storage is owned by the backend team.', 20, C['muted'], max_width=2240)
    c.save('03-database-relationships')


def request_sequence():
    c = Canvas(height=2200)
    header(c, 'Runtime request & evidence flow', 'A sequence diagram separates AI ingestion, frontend interactions, backend decisions and storage operations.', 4)
    c.rect(80, 260, 2240, 140, C['blue_tint'], C['border'], radius=20)
    c.chip(105, 283, 'AI TEAM', C['blue'], C['white'], w=180, h=47)
    c.text(350, 288, 'Extract requirements', 27, C['blue'], 'demi')
    c.line([(642, 313), (720, 313)], C['blue'], 3, arrow=True)
    c.text(755, 288, 'Validate evidence', 27, C['blue'], 'demi')
    c.line([(1016, 313), (1090, 313)], C['blue'], 3, arrow=True)
    c.text(1125, 288, 'Publish rule versions', 27, C['blue'], 'demi')
    c.line([(1434, 313), (1845, 313)], C['blue'], 3, arrow=True)
    c.cylinder(1870, 273, 420, 106, 'Verified rule data', [], C['blue'], compact=True)
    c.text(350, 345, 'On source ingestion / updates; query-time evaluation uses verified outputs.', 22, C['muted'], max_width=1470)

    centers = [260, 760, 1370, 2090]
    for x in centers:
        c.dashed([(x, 590), (x, 2025)], C['border'], 2, dash=10, gap=10)
    c.rect(140, 470, 240, 110, C['white'], C['border'], radius=16)
    c.icon('user', 165, 492, C['muted'])
    c.text(223, 506, 'User', 28, weight='demi')
    for x, title, team, accent, tint in [(535, 'Lovable frontend', 'FRONTEND TEAM', C['purple'], C['purple_tint']),
                                         (1145, 'Evaluation API', 'BACKEND TEAM', C['teal'], C['teal_tint'])]:
        c.rect(x, 470, 450, 110, tint, C['border'], radius=16)
        c.text(x+25, 490, team, 18, accent, 'bold', max_width=350)
        c.text(x+25, 530, title, 27, weight='demi', max_width=365)
    c.text(1955, 438, 'BACKEND STORAGE', 18, C['teal'], 'bold')
    c.cylinder(1865, 470, 450, 110, 'Database / JSON store', [], C['teal'], compact=True)
    c.line([(2180, 379), (2180, 460)], C['blue'], 3, arrow=True)

    # UML activation bars show the intervals in which each service works.
    c.rect(750, 675, 20, 795, C['purple_tint'], C['purple'])
    c.rect(750, 1555, 20, 470, C['purple_tint'], C['purple'])
    c.rect(1360, 795, 20, 580, C['teal_tint'], C['teal'])
    c.rect(1360, 1655, 20, 285, C['teal_tint'], C['teal'])
    c.rect(2080, 900, 20, 115, C['teal_tint'], C['teal'])
    c.rect(2080, 1240, 20, 80, C['teal_tint'], C['teal'])
    c.rect(2080, 1755, 20, 100, C['teal_tint'], C['teal'])

    def message(a, b, y, text, label_x, max_width, color, response=False, mono=False):
        if response:
            c.dashed([(a, y), (b, y)], color, 3, dash=12, gap=9, arrow=True)
        else:
            c.line([(a, y), (b, y)], color, 3, arrow=True)
        c.text(label_x, y-40, text, 22, color, 'medium', mono=mono, max_width=max_width)

    message(260, 750, 675, '1. Search address + date', 330, 400, C['purple'])
    message(770, 1360, 795, '2. Lookup(address_id, as_of)', 810, 520, C['purple'], mono=True)
    message(1380, 2080, 900, '3. Property facts + rule versions + evidence IDs', 1420, 650, C['teal'])
    message(2080, 1380, 1000, '4. Snapshot + source references', 1450, 620, C['teal'], response=True)
    c.line([(1380, 1090), (1470, 1090), (1470, 1170), (1380, 1170)], C['teal'], 3, arrow=True)
    c.rect(1515, 1060, 530, 165, C['teal_tint'], C['border'], radius=14)
    c.text(1535, 1080, 'EVALUATE EVERY REQUIREMENT', 18, C['teal'], 'bold', max_width=490)
    c.lines(1535, 1118, ['Jurisdiction + date + coverage', 'Missing facts: unknown', 'Precedence + conflict checks'], 22, 32, max_width=490, color=C['muted'])
    c.line([(1380, 1240), (2080, 1240)], C['teal'], 3, arrow=True)
    c.text(1450, 1252, '5. Save run + results + input snapshot', 22, C['teal'], 'medium', max_width=620)
    c.dashed([(2080, 1308), (1380, 1308)], C['teal'], 3, dash=12, gap=9, arrow=True)
    c.text(1980, 1282, 'Saved', 20, C['teal'], max_width=80)
    message(1360, 770, 1365, '6. Rule results + reasons + missing facts', 810, 520, C['teal'], response=True)
    message(750, 260, 1460, '7. Law groups + separate rule statuses', 330, 400, C['purple'], response=True)
    message(260, 750, 1555, '8. Open supporting evidence', 330, 400, C['purple'])
    message(770, 1360, 1655, '9. Evidence request(rule_version_id)', 810, 520, C['purple'], mono=True)
    message(1380, 2080, 1755, '10. Read exact quote + source capture', 1420, 650, C['teal'])
    message(2080, 1380, 1840, '11. Quote, citation, URL + retrieval date', 1450, 620, C['teal'], response=True)
    message(1360, 770, 1925, '12. Verified evidence response', 810, 520, C['teal'], response=True)
    message(750, 260, 2005, '13. Show source evidence drawer', 330, 400, C['purple'], response=True)

    c.rect(80, 2050, 2240, 78, '#EAF0F6', radius=16)
    c.text(110, 2076, 'Solid arrows: requests / work. Dashed arrows: responses. Vertical bars: active processing.', 23, C['muted'], max_width=2180)
    c.text(80, 2160, 'Frontend reads API results; backend computes coverage and retrieves evidence; AI prepares validated rule versions.', 22, C['muted'], max_width=2240)
    c.save('04-request-and-evidence-sequence')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    overview()
    detailed_flow()
    database_model()
    request_sequence()
    with zipfile.ZipFile(OUT / 'architecture-diagrams.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            if path.suffix in {'.jpg', '.svg', '.md', '.py'} and '-preview' not in path.stem:
                archive.write(path, path.name)


if __name__ == '__main__':
    main()
