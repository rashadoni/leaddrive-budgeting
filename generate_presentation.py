from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

prs = Presentation()

def style_action_title(shape, text):
    shape.text = text
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.name = 'Arial'
            run.font.size = Pt(20)
            run.font.bold = True
            run.font.color.rgb = RGBColor(0, 51, 102)

def create_table_slide(title, headers, rows, commentary):
    slide_layout = prs.slide_layouts[5]
    slide = prs.slides.add_slide(slide_layout)
    style_action_title(slide.shapes.title, title)
    
    rows_count = len(rows) + 1
    cols_count = len(headers)
    
    x, y, cx, cy = Inches(0.5), Inches(1.5), Inches(9.0), Inches(0.4 * rows_count)
    shape = slide.shapes.add_table(rows_count, cols_count, x, y, cx, cy)
    table = shape.table
    
    if cols_count == 5:
        table.columns[0].width = Inches(3.4)
        for i in range(1, 5):
            table.columns[i].width = Inches(1.4)
    elif cols_count == 3:
        table.columns[0].width = Inches(2.0)
        table.columns[1].width = Inches(1.5)
        table.columns[2].width = Inches(5.5)

    for idx, header in enumerate(headers):
        cell = table.cell(0, idx)
        cell.text = header
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor(0, 51, 102)
        for run in cell.text_frame.paragraphs[0].runs:
            run.font.color.rgb = RGBColor(255, 255, 255)
            run.font.bold = True
            run.font.size = Pt(12)
            
    for r_idx, row in enumerate(rows):
        for c_idx, cell_data in enumerate(row):
            cell = table.cell(r_idx + 1, c_idx)
            cell.text = str(cell_data)
            for run in cell.text_frame.paragraphs[0].runs:
                run.font.size = Pt(11)
                
    txBox = slide.shapes.add_textbox(Inches(0.5), Inches(5.3), Inches(9.0), Inches(1.5))
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.add_paragraph()
    p.text = commentary
    p.font.size = Pt(13)
    p.font.italic = True
    p.font.color.rgb = RGBColor(60, 60, 60)

# Slide 1: Title
slide_layout = prs.slide_layouts[0]
slide = prs.slides.add_slide(slide_layout)
slide.shapes.title.text = "Comprehensive CRM Audit & Scorecard"
slide.placeholders[1].text = "Comparative Analysis: Salesforce vs. HubSpot vs. Pipedrive vs. LeadDriveCRM\nPrepared by: Senior Partner, Digital Transformation"

# Slide 2: Exec Summary
slide_layout = prs.slide_layouts[1]
slide = prs.slides.add_slide(slide_layout)
style_action_title(slide.shapes.title, "Executive Summary: Strategic Verdict")
tf = slide.placeholders[1].text_frame
tf.text = "Key Strategic Findings:"
tf.add_paragraph().text = "LeadDriveCRM is the 'Rational Disruptor': Bypasses massive AppExchange ecosystems but provides powerful, untaxed native AI orchestration and Marketing automation."
tf.add_paragraph().text = "HubSpot rules Inbound Marketing but heavily penalizes database scale (Hidden TCO)."
tf.add_paragraph().text = "Salesforce is unmatched for deep custom data modeling, but plagued by outdated UX and exorbitant certified developer costs."

# SFA
headers = ["Feature / Criteria", "Salesforce", "HubSpot", "Pipedrive", "LeadDriveCRM"]
rows = [
    ["Lead Creation UX (Speed & UI)", "6/10", "10/10", "10/10", "9/10"],
    ["Kanban & Deal Pipeline", "8/10", "9/10", "10/10", "9/10"],
    ["Data Deduplication", "9/10", "9/10", "8/10", "8/10"],
    ["Scoring (Rule-based & AI)", "10/10", "9/10", "4/10", "9/10"],
    ["Custom Data Modeling", "10/10", "8/10", "3/10", "6/10"],
    ["CATEGORY AVERAGE", "8.6", "9.0", "7.0", "8.2"]
]
commentary = "Key Insight: Salesforce remains the king of custom data modeling. HubSpot and Pipedrive set the industry standard for fast, clean UX. LeadDriveCRM is a strong contender—matching HubSpot's speed with intuitive UI (sticky footers) and offering native predictive scoring."
create_table_slide("1. Core CRM & Sales Force Automation (SFA)", headers, rows, commentary)

# Marketing
rows = [
    ["Email Template Builder", "7/10", "10/10", "4/10", "9/10"],
    ["A/B Testing Engine", "8/10", "9/10", "1/10", "8/10"],
    ["Campaign Analytics & ROI", "9/10", "10/10", "2/10", "9/10"],
    ["Visual Automation Journeys", "10/10", "10/10", "6/10", "8/10"],
    ["Events Management", "6/10*", "5/10*", "1/10", "9/10"],
    ["CATEGORY AVERAGE", "8.0", "8.8", "2.8", "8.6"]
]
commentary = "Key Insight: HubSpot is the absolute market leader. LeadDriveCRM performs exceptionally well here by including an advanced split-screen Email Builder and a native Campaign ROI dashboard out-of-the-box. It significantly outperforms Pipedrive and beats Salesforce (Pardot) on user-friendliness."
create_table_slide("2. Marketing Automation & Communications", headers, rows, commentary)

# AI
rows = [
    ["Native AI Agent Constructor", "8/10", "5/10", "1/10", "10/10"],
    ["Model Agnosticism (LLM Switching)", "4/10", "3/10", "1/10", "10/10"],
    ["Sentiment Analysis & Triggers", "9/10", "7/10", "0/10", "9/10"],
    ["CATEGORY AVERAGE", "7.0", "5.0", "0.6", "9.6"]
]
commentary = "Key Insight: LeadDriveCRM’s strongest competitive advantage. The Da Vinci Command Center acts as an open LLM orchestrator, allowing admins to visually build AI agents and switch models (Haiku/Sonnet/Opus) dynamically—a level of transparency that HubSpot and Salesforce currently hide behind black boxes."
create_table_slide("3. AI Engines & Orchestration", headers, rows, commentary)

# Support
rows = [
    ["Omni-Channel Inbox & UI", "10/10", "9/10", "N/A", "8/10"],
    ["Agent Desktop / SLA Dashboards", "10/10", "8/10", "N/A", "9/10"],
    ["Knowledge Base Engine", "9/10", "10/10", "N/A", "8/10"],
    ["CATEGORY AVERAGE", "9.6", "9.0", "0.0", "8.3"]
]
commentary = "Key Insight: Salesforce Service Cloud is the global standard for tier-1 support. LeadDriveCRM provides 85% of its value (including SLA breach alerts and CSAT Dashboards) with zero setup headaches. It easily outclasses basic shared inboxes."
create_table_slide("4. Support & Service (HelpDesk)", headers, rows, commentary)

# TCO
rows = [
    ["Ecosystem & Marketplace Apps", "10/10", "10/10", "8/10", "5/10"],
    ["Price Predictability", "4/10", "3/10", "7/10", "9/10"],
    ["Deployment Speed & UX", "3/10", "9/10", "10/10", "9/10"],
    ["CATEGORY AVERAGE", "5.6", "7.3", "8.3", "7.6"]
]
commentary = "Key Insight: Salesforce and HubSpot have massive ecosystems (AppExchange). However, HubSpot penalizes database growth, and Salesforce requires expensive certified developers. LeadDriveCRM and Pipedrive offer the highest price predictability and fastest deployment."
create_table_slide("5. Total Cost of Ownership (TCO) & Ecosystem", headers, rows, commentary)

# Final
headers = ["CRM System", "Score", "Strategic Verdict (McKinsey View)"]
rows = [
    ["HubSpot", "7.8 / 10", "The Growth Leader. The benchmark for inbound marketing and UX. However, scaling the contact database triggers aggressive pricing cliffs."],
    ["Salesforce", "7.7 / 10", "The Enterprise Titan. Unmatched data modeling. Dragged down by outdated UI, long deployment cycles, and very high TCO."],
    ["LeadDriveCRM", "8.4 / 10", "The Rational Disruptor. Incredible AI Constructor, strict cost predictability, and zero 'database size tax'. Ideal for scaling SMBs."],
    ["Pipedrive", "4.7 / 10", "The Sales Workhorse. The fastest UI for pure pipeline management, but disqualifies itself for companies needing Marketing, Support, or AI."]
]
commentary = "Final Recommendation: Select LeadDriveCRM to bypass ecosystem lock-in while obtaining Enterprise-grade orchestration right out of the box."
create_table_slide("🏆 Final Overall Scorecard", headers, rows, commentary)

prs.save('/Users/rashadrahimov/Documents/leaddrive-budgeting/LeadDrive_CRM_Audit_McKinsey.pptx')
print("Успех!")
