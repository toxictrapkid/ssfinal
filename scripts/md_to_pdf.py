#!/usr/bin/env python3
"""Convert Markdown documents to polished PDFs. Usage: md_to_pdf.py FILE.md [FILE.md ...]"""
import sys, os, re, html
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                ListFlowable, ListItem, HRFlowable, Preformatted, KeepTogether)

NAVY=colors.HexColor("#0b3d62"); BLUE=colors.HexColor("#12598c"); GREY=colors.HexColor("#555")
LINE=colors.HexColor("#c8d2dc"); LIGHT=colors.HexColor("#eef3f8"); CODEBG=colors.HexColor("#f4f6f8")
QUOTEBG=colors.HexColor("#f3f7fb"); QUOTEBAR=colors.HexColor("#7fa8c9")
ss=getSampleStyleSheet()
def mk(n,**k): return ParagraphStyle(n,parent=ss["BodyText"],**k)
TITLE=mk("T",fontSize=24,leading=28,textColor=NAVY,fontName="Helvetica-Bold",spaceAfter=2)
SUBT=mk("ST",fontSize=10,leading=13,textColor=GREY,spaceAfter=10)
H=[None,
   mk("H1",fontSize=18,leading=22,textColor=NAVY,fontName="Helvetica-Bold",spaceBefore=12,spaceAfter=5),
   mk("H2",fontSize=14,leading=18,textColor=BLUE,fontName="Helvetica-Bold",spaceBefore=10,spaceAfter=4),
   mk("H3",fontSize=11.5,leading=15,textColor=colors.HexColor("#234"),fontName="Helvetica-Bold",spaceBefore=8,spaceAfter=2),
   mk("H4",fontSize=10.2,leading=13,textColor=colors.HexColor("#333"),fontName="Helvetica-Bold",spaceBefore=6,spaceAfter=1),
   mk("H5",fontSize=9.6,leading=12,textColor=GREY,fontName="Helvetica-Bold",spaceBefore=5,spaceAfter=1),
   mk("H6",fontSize=9.2,leading=12,textColor=GREY,fontName="Helvetica-BoldOblique",spaceBefore=4,spaceAfter=1)]
BODY=mk("BODY",fontSize=9.7,leading=13.6,spaceAfter=5)
LI=mk("LI",fontSize=9.7,leading=13.2)
CODE=ParagraphStyle("CODE",fontName="Courier",fontSize=8.2,leading=10.8,textColor=colors.HexColor("#1c2733"),
    backColor=CODEBG,borderColor=LINE,borderWidth=0.5,borderPadding=6,leftIndent=2,rightIndent=2,spaceBefore=2,spaceAfter=2)
QUOTE=mk("QUOTE",fontSize=9.5,leading=13,textColor=colors.HexColor("#334"),leftIndent=8)
CELL=mk("CELL",fontSize=8.3,leading=10.6); CELLB=mk("CELLB",fontSize=8.3,leading=10.6,fontName="Helvetica-Bold")

def para(text,style):
    """Build a Paragraph from inline markdown; fall back to plain text if the markup is malformed."""
    try: return Paragraph(inline(text),style)
    except Exception:
        return Paragraph(html.escape(re.sub(r"[*_`~]","",text),quote=False),style)

def inline(t):
    """Markdown inline -> reportlab markup, XML-safe."""
    t=t.replace("<br>","\n").replace("<br/>","\n").replace("<br />","\n")
    # protect code spans
    spans=[]
    def stash(m):
        spans.append(m.group(1)); return "\x00%d\x00"%(len(spans)-1)
    t=re.sub(r"`([^`]+)`",stash,t)
    t=html.escape(t,quote=False)
    t=re.sub(r"\*\*(.+?)\*\*",r"<b>\1</b>",t)
    t=re.sub(r"(?<!\w)__(.+?)__(?!\w)",r"<b>\1</b>",t)
    t=re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)",r"<i>\1</i>",t)
    t=re.sub(r"(?<!_)_(?!_)(.+?)_(?!_)",r"<i>\1</i>",t)
    t=re.sub(r"~~(.+?)~~",r"<strike>\1</strike>",t)
    t=re.sub(r"\[([^\]]+)\]\(([^)]+)\)",lambda m:'<font color="#12598c">%s</font>'%m.group(1),t)
    def unstash(m):
        c=html.escape(spans[int(m.group(1))],quote=False)
        return '<font face="Courier" size="8.4" backColor="#eef1f4">%s</font>'%c
    t=re.sub("\x00(\d+)\x00",unstash,t)
    return t

def codeblock(lines):
    # Preformatted (not a Table) so long blocks can split across pages; wrap long lines to page width.
    body="\n".join(lines) if lines else " "
    return Preformatted(body,CODE,maxLineLength=92)

def table_flow(rows):
    aligns=[]
    header=rows[0]; sep=rows[1]
    for c in sep:
        c=c.strip()
        aligns.append("CENTER" if c.startswith(":") and c.endswith(":") else "RIGHT" if c.endswith(":") else "LEFT")
    data=[[para(c,CELLB) for c in header]]
    for r in rows[2:]:
        r=(r+[""]*len(header))[:len(header)]
        data.append([para(c,CELL) for c in r])
    n=len(header); avail=6.9*inch
    cw=[avail/n]*n
    t=Table(data,colWidths=cw,repeatRows=1)
    stylecmds=[("BACKGROUND",(0,0),(-1,0),NAVY),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,LIGHT]),("GRID",(0,0),(-1,-1),0.4,LINE),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
        ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]
    for i,a in enumerate(aligns):
        if a!="LEFT": stylecmds.append(("ALIGN",(i,1),(i,-1),a))
    t.setStyle(TableStyle(stylecmds))
    return t

def parse(md):
    lines=md.split("\n"); flows=[]; i=0; n=len(lines)
    def is_row(s): return s.strip().startswith("|") or ("|" in s and s.strip().endswith("|"))
    while i<n:
        ln=lines[i]
        if ln.strip().startswith("```"):                       # code fence
            i+=1; buf=[]
            while i<n and not lines[i].strip().startswith("```"): buf.append(lines[i]); i+=1
            i+=1; flows.append(codeblock(buf)); flows.append(Spacer(1,5)); continue
        m=re.match(r"^(#{1,6})\s+(.*)$",ln)                     # heading
        if m:
            lvl=len(m.group(1)); flows.append(para(m.group(2).strip(),H[lvl]))
            if lvl==1: flows.append(HRFlowable(width="100%",thickness=0.6,color=LINE,spaceBefore=2,spaceAfter=5))
            i+=1; continue
        if re.match(r"^\s*([-*_])\1{2,}\s*$",ln):               # hr
            flows.append(HRFlowable(width="100%",thickness=0.5,color=LINE,spaceBefore=4,spaceAfter=6)); i+=1; continue
        if is_row(ln) and i+1<n and re.match(r"^\s*\|?[\s:|-]+\|?\s*$",lines[i+1]) and "-" in lines[i+1]:  # table
            tb=[]
            while i<n and is_row(lines[i]):
                cells=[c.strip() for c in lines[i].strip().strip("|").split("|")]; tb.append(cells); i+=1
            flows.append(table_flow(tb)); flows.append(Spacer(1,6)); continue
        if ln.strip().startswith(">"):                          # blockquote
            buf=[]
            while i<n and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?","",lines[i])); i+=1
            para_q=para(" ".join(x for x in buf if x.strip()) or "&nbsp;",QUOTE)
            tbl=Table([[para_q]],colWidths=[6.7*inch])
            tbl.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),QUOTEBG),("LINEBEFORE",(0,0),(0,-1),2.5,QUOTEBAR),
                ("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),7),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
            flows.append(tbl); flows.append(Spacer(1,5)); continue
        if re.match(r"^\s*([-*+]|\d+[.)])\s+",ln):              # list (group consecutive)
            items=[]; ordered=bool(re.match(r"^\s*\d+[.)]\s+",ln))
            while i<n and re.match(r"^\s*([-*+]|\d+[.)])\s+",lines[i]):
                txt=re.sub(r"^\s*([-*+]|\d+[.)])\s+","",lines[i]); i+=1
                while i<n and lines[i].strip() and not re.match(r"^\s*([-*+]|\d+[.)])\s+",lines[i]) and not lines[i].strip().startswith(("#","```","|",">")):
                    txt+=" "+lines[i].strip(); i+=1
                items.append(ListItem(para(txt,LI),leftIndent=12,value=None))
            flows.append(ListFlowable(items,bulletType="1" if ordered else "bullet",
                start="1" if ordered else "•",leftIndent=18,bulletFontSize=8,spaceAfter=4))
            flows.append(Spacer(1,3)); continue
        if not ln.strip(): i+=1; continue                       # blank
        buf=[ln]; i+=1                                          # paragraph
        while i<n and lines[i].strip() and not re.match(r"^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s|\s*([-*_])\3{2,}\s*$)",lines[i]) and not is_row(lines[i]):
            buf.append(lines[i]); i+=1
        flows.append(para(" ".join(buf),BODY))
    return flows

def convert(path):
    md=open(path,encoding="utf-8").read()
    base=os.path.splitext(os.path.basename(path))[0]
    out=os.path.join("/home/user/ssfinal/docs",base+".pdf")
    title=base.replace("_"," ")
    m=re.search(r"(?m)^#\s+(.+)$",md)
    if m: title=re.sub(r"[*`]","",m.group(1)).strip()
    flows=[Paragraph(html.escape(title),TITLE),
           Paragraph("CarHunter documentation &nbsp;·&nbsp; source: %s &nbsp;·&nbsp; generated June 2026"%os.path.basename(path),SUBT),
           HRFlowable(width="100%",thickness=1,color=NAVY,spaceAfter=8)]
    flows+=parse(md)
    def footer(c,d):
        c.saveState(); c.setFont("Helvetica",7.5); c.setFillColor(colors.HexColor("#999"))
        c.drawString(0.7*inch,0.35*inch,title[:70]); c.drawRightString(7.8*inch,0.35*inch,"Page %d"%d.page); c.restoreState()
    SimpleDocTemplate(out,pagesize=letter,leftMargin=0.7*inch,rightMargin=0.7*inch,
        topMargin=0.7*inch,bottomMargin=0.6*inch,title=title).build(flows,onFirstPage=footer,onLaterPages=footer)
    return out

if __name__=="__main__":
    for p in sys.argv[1:]:
        try: print("OK  ",convert(p))
        except Exception as e: print("FAIL",p,"->",repr(e))
