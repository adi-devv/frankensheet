"""
make_fixtures.py  –  Phase 1 fixture generator
Run:  python fixtures/make_fixtures.py
Requires:  pip install openpyxl

Produces five .xlsx files in fixtures/fidelity/:
  01_budget_sums.xlsx          – budget sheet with SUM/AVERAGE formulas
  02_merged_cells_styles.xlsx  – merged cells, bold headers, coloured rows
  03_shared_formulas_names.xlsx– shared formulas, defined names, cross-sheet ref
  04_chart_condformat.xlsx     – bar chart + conditional formatting (data-bar)
  05_large_5k_rows.xlsx        – 5 000-row data sheet with formulas
"""

from pathlib import Path
import os
import zipfile
import xml.etree.ElementTree as ET
from openpyxl import Workbook
from openpyxl.styles import (
    Font, PatternFill, Alignment, Border, Side, numbers
)
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import DataBarRule
from openpyxl.worksheet.table import Table, TableStyleInfo

OUT = Path(__file__).parent / "fidelity"
OUT.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def thin_border():
    s = Side(style="thin")
    return Border(left=s, right=s, top=s, bottom=s)


def header_fill(hex_color: str):
    return PatternFill("solid", fgColor=hex_color)


# ---------------------------------------------------------------------------
# 01  Budget with SUM / AVERAGE / MAX formulas
# ---------------------------------------------------------------------------

def make_budget():
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"

    headers = ["Category", "Q1", "Q2", "Q3", "Q4", "Total", "Avg"]
    rows_data = [
        ["Salaries",    120_000, 120_000, 125_000, 130_000],
        ["Rent",         18_000,  18_000,  18_000,  18_000],
        ["Marketing",    15_000,  22_000,  18_000,  25_000],
        ["Travel",        4_500,   3_200,   6_100,   5_800],
        ["Software",      8_000,   8_000,   8_500,   9_000],
        ["Misc",          2_100,   1_800,   2_400,   3_000],
    ]

    # --- header row ---
    ws.append(headers)
    for col, cell in enumerate(ws[1], start=1):
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill("4472C4")
        cell.alignment = Alignment(horizontal="center")

    # --- data rows ---
    for r_idx, row in enumerate(rows_data, start=2):
        ws.append(row)
        last_data_col = len(row)          # 5  (A..E = category + 4 quarters)
        total_col = last_data_col + 1     # 6  = F
        avg_col   = last_data_col + 2     # 7  = G

        # Total = SUM(B:E) for this row
        b = get_column_letter(2)
        e = get_column_letter(last_data_col)
        ws.cell(r_idx, total_col).value = (
            f"=SUM({b}{r_idx}:{e}{r_idx})"
        )
        # Avg
        ws.cell(r_idx, avg_col).value = (
            f"=AVERAGE({b}{r_idx}:{e}{r_idx})"
        )
        # zebra stripe
        if r_idx % 2 == 0:
            fill = PatternFill("solid", fgColor="DCE6F1")
            for c in range(1, len(headers) + 1):
                ws.cell(r_idx, c).fill = fill

    # --- summary row ---
    summary_row = len(rows_data) + 2
    ws.cell(summary_row, 1).value = "TOTAL"
    ws.cell(summary_row, 1).font = Font(bold=True)
    for col_idx in range(2, 6):          # Q1..Q4
        col_letter = get_column_letter(col_idx)
        ws.cell(summary_row, col_idx).value = (
            f"=SUM({col_letter}2:{col_letter}{summary_row - 1})"
        )
    # Grand total
    ws.cell(summary_row, 6).value = (
        f"=SUM(F2:F{summary_row - 1})"
    )
    ws.cell(summary_row, 7).value = (
        f"=AVERAGE(G2:G{summary_row - 1})"
    )
    for c in range(1, len(headers) + 1):
        ws.cell(summary_row, c).font = Font(bold=True)
        ws.cell(summary_row, c).fill = header_fill("BDD7EE")

    # column widths
    ws.column_dimensions["A"].width = 14
    for col in "BCDEFG":
        ws.column_dimensions[col].width = 12

    # number format for money columns
    money_fmt = '#,##0'
    for row in ws.iter_rows(min_row=2, max_row=summary_row, min_col=2, max_col=7):
        for cell in row:
            cell.number_format = money_fmt

    wb.save(OUT / "01_budget_sums.xlsx")
    print("  wrote 01_budget_sums.xlsx")


# ---------------------------------------------------------------------------
# 02  Merged cells + rich styles
# ---------------------------------------------------------------------------

def make_merged_styles():
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"

    # Big title across A1:G1
    ws.merge_cells("A1:G1")
    ws["A1"].value = "Annual Performance Report 2024"
    ws["A1"].font = Font(bold=True, size=16, color="FFFFFF")
    ws["A1"].fill = header_fill("243F60")
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    # Section headers span two columns
    for start_col, label, color in [
        (1, "Department Info",  "5B9BD5"),
        (3, "H1 Results",       "70AD47"),
        (5, "H2 Results",       "ED7D31"),
    ]:
        end_col = start_col + 1
        sc = get_column_letter(start_col)
        ec = get_column_letter(end_col)
        ws.merge_cells(f"{sc}2:{ec}2")
        cell = ws[f"{sc}2"]
        cell.value = label
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill(color)
        cell.alignment = Alignment(horizontal="center")

    # Column headers row 3
    col_headers = ["Dept", "Head", "Target", "Actual", "Target", "Actual", "YoY%"]
    ws.append([])  # row 3 is next append
    for c, h in enumerate(col_headers, start=1):
        cell = ws.cell(3, c)
        cell.value = h
        cell.font = Font(bold=True)
        cell.border = thin_border()
        cell.fill = header_fill("D9E1F2")

    # Data rows 4-9
    dept_data = [
        ["Engineering", "Alice",  500_000, 512_000, 530_000, 548_000],
        ["Marketing",   "Bob",    200_000, 185_000, 210_000, 221_000],
        ["Sales",       "Carol",  800_000, 820_000, 850_000, 902_000],
        ["Finance",     "Dave",   100_000,  97_000, 105_000, 108_000],
        ["HR",          "Eve",     80_000,  79_500,  85_000,  83_000],
        ["Operations",  "Frank",  350_000, 361_000, 370_000, 375_000],
    ]
    for r_idx, row in enumerate(dept_data, start=4):
        ws.append(row)
        # YoY% = (H2 Actual - H1 Actual) / H1 Actual
        ws.cell(r_idx, 7).value = f"=(F{r_idx}-D{r_idx})/D{r_idx}"
        ws.cell(r_idx, 7).number_format = "0.0%"
        for c in range(1, 8):
            ws.cell(r_idx, c).border = thin_border()
        # money format
        for c in range(3, 7):
            ws.cell(r_idx, c).number_format = '#,##0'

    # Merge cells in dept column where same dept spans two rows (just Engineering for demo)
    # Actually leave as single cells — we already have the section merges above.

    # Freeze panes below row 3
    ws.freeze_panes = "A4"

    for col in "ABCDEFG":
        ws.column_dimensions[col].width = 14

    wb.save(OUT / "02_merged_cells_styles.xlsx")
    print("  wrote 02_merged_cells_styles.xlsx")


# ---------------------------------------------------------------------------
# 03  Shared formulas + defined names + cross-sheet ref
# ---------------------------------------------------------------------------

def make_shared_formulas():
    wb = Workbook()

    # --- Sheet 1: Rates ---
    rates_ws = wb.active
    rates_ws.title = "Rates"
    rates_ws["A1"] = "Currency"
    rates_ws["B1"] = "Rate to USD"
    rates_data = [
        ("EUR", 1.08),
        ("GBP", 1.27),
        ("JPY", 0.0067),
        ("CAD", 0.73),
        ("AUD", 0.65),
    ]
    for row in rates_data:
        rates_ws.append(row)

    # Defined name: TaxRate = 0.21
    # openpyxl DefinedName
    from openpyxl.workbook.defined_name import DefinedName
    wb.defined_names["TaxRate"] = DefinedName("TaxRate", attr_text="0.21")
    wb.defined_names["RatesTable"] = DefinedName(
        "RatesTable", attr_text="Rates!$A$2:$B$6"
    )

    # --- Sheet 2: Invoices ---
    inv_ws = wb.create_sheet("Invoices")
    inv_headers = ["InvoiceID", "Client", "Currency", "Amount_Local", "Amount_USD", "Tax_USD", "Total_USD"]
    inv_ws.append(inv_headers)
    for c, h in enumerate(inv_headers, start=1):
        inv_ws.cell(1, c).font = Font(bold=True)

    # 10 invoices so column E (Amount_USD) has 10 formula cells (E2:E11)
    invoices = [
        ("INV-001", "Acme Corp",    "EUR", 10_000),
        ("INV-002", "Globex",       "GBP",  5_500),
        ("INV-003", "Initech",      "JPY", 800_000),
        ("INV-004", "Umbrella",     "EUR",  3_200),
        ("INV-005", "Stark Ind",    "GBP",  7_800),
        ("INV-006", "Wayne Ent",    "CAD",  9_000),
        ("INV-007", "Oscorp",       "AUD",  4_600),
        ("INV-008", "Cyberdyne",    "EUR",  6_300),
        ("INV-009", "Tyrell Corp",  "CAD",  3_400),
        ("INV-010", "Massive Dyn",  "AUD",  5_200),
    ]
    for r_idx, (inv_id, client, currency, amount) in enumerate(invoices, start=2):
        inv_ws.cell(r_idx, 1).value = inv_id
        inv_ws.cell(r_idx, 2).value = client
        inv_ws.cell(r_idx, 3).value = currency
        inv_ws.cell(r_idx, 4).value = amount
        # Amount_USD: VLOOKUP into Rates sheet
        inv_ws.cell(r_idx, 5).value = (
            f"=D{r_idx}*VLOOKUP(C{r_idx},RatesTable,2,FALSE)"
        )
        # Tax_USD: Amount_USD * TaxRate
        inv_ws.cell(r_idx, 6).value = f"=E{r_idx}*TaxRate"
        # Total_USD
        inv_ws.cell(r_idx, 7).value = f"=E{r_idx}+F{r_idx}"

        for c in [5, 6, 7]:
            inv_ws.cell(r_idx, c).number_format = '#,##0.00'

    # Summary row
    summary = len(invoices) + 2
    inv_ws.cell(summary, 2).value = "TOTAL"
    inv_ws.cell(summary, 2).font = Font(bold=True)
    for c in [5, 6, 7]:
        col = get_column_letter(c)
        inv_ws.cell(summary, c).value = f"=SUM({col}2:{col}{summary-1})"
        inv_ws.cell(summary, c).number_format = '#,##0.00'
        inv_ws.cell(summary, c).font = Font(bold=True)

    # Cross-sheet formula: total invoices in USD shown on Rates sheet
    rates_ws["D1"] = "Total Invoiced (USD)"
    rates_ws["D1"].font = Font(bold=True)
    rates_ws["D2"] = f"=Invoices!E{summary}"
    rates_ws["D2"].number_format = '#,##0.00'

    for col in "ABCDEFG":
        inv_ws.column_dimensions[col].width = 16
    rates_ws.column_dimensions["D"].width = 20

    wb.save(OUT / "03_shared_formulas_names.xlsx")

    # openpyxl writes plain <f>formula</f> for every cell — no t="shared".
    # Post-process the zip so column E (E2:E11) becomes a real shared formula:
    #   E2 → master: <f t="shared" ref="E2:E11" si="0">…</f>
    #   E3..E11 → slaves: <f t="shared" si="0"/>
    _inject_shared_formulas(OUT / "03_shared_formulas_names.xlsx")
    print("  wrote 03_shared_formulas_names.xlsx (with <f t=\"shared\">)")


# ---------------------------------------------------------------------------
# Shared-formula injection helper
# ---------------------------------------------------------------------------

_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_NS_R    = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _inject_shared_formulas(filepath):
    """Rewrite column E (E2:E11) of the Invoices sheet as a shared formula.

    After openpyxl saves, every formula cell has a plain <f>formula</f>.
    We open the .xlsx zip, locate the Invoices worksheet XML by reading
    workbook.xml + workbook.xml.rels, then string-replace the <f> elements
    for E2 (master) and E3:E11 (slaves).  All other zip entries are copied
    verbatim to a new zip which replaces the original.
    """
    filepath = str(filepath)

    # Range of the shared formula block
    FIRST_ROW = 2
    LAST_ROW  = 11          # 10 invoices → rows 2..11
    SHARED_REF = f"E{FIRST_ROW}:E{LAST_ROW}"

    with zipfile.ZipFile(filepath, "r") as zin:
        # ---- find which sheetN.xml is the Invoices sheet ----
        wb_tree = ET.fromstring(zin.read("xl/workbook.xml"))
        sheets_elem = wb_tree.find(f"{{{_NS_MAIN}}}sheets")
        invoices_rid = None
        for s in sheets_elem:
            if s.get("name") == "Invoices":
                invoices_rid = s.get(f"{{{_NS_R}}}id")
                break
        assert invoices_rid, "Invoices sheet not found in workbook.xml"

        rels_tree = ET.fromstring(zin.read("xl/_rels/workbook.xml.rels"))
        sheet_path = None
        for rel in rels_tree:
            if rel.get("Id") == invoices_rid:
                target = rel.get("Target")
                sheet_path = target.lstrip("/") if target.startswith("/") else "xl/" + target
                break
        assert sheet_path, f"Could not resolve rId {invoices_rid} to a sheet path"

        # ---- read the worksheet XML as text ----
        sheet_text = zin.read(sheet_path).decode("utf-8")

        # ---- transform column E formulas ----
        # E2 becomes the shared-formula master
        master_formula = f"D{FIRST_ROW}*VLOOKUP(C{FIRST_ROW},RatesTable,2,FALSE)"
        old_master = f"<f>{master_formula}</f>"
        new_master = f'<f t="shared" ref="{SHARED_REF}" si="0">{master_formula}</f>'
        assert old_master in sheet_text, (
            f"Master formula not found in sheet XML: {old_master}\n"
            "openpyxl may have changed its formula serialization."
        )
        sheet_text = sheet_text.replace(old_master, new_master, 1)

        # E3..E11 become slaves (empty body, reference master by si)
        for row in range(FIRST_ROW + 1, LAST_ROW + 1):
            old_slave = f"<f>D{row}*VLOOKUP(C{row},RatesTable,2,FALSE)</f>"
            new_slave = '<f t="shared" si="0"/>'
            assert old_slave in sheet_text, (
                f"Slave formula not found for row {row}: {old_slave}"
            )
            sheet_text = sheet_text.replace(old_slave, new_slave, 1)

        # ---- rebuild the zip ----
        tmp_path = filepath + ".tmp"
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == sheet_path:
                    zout.writestr(item, sheet_text.encode("utf-8"))
                else:
                    zout.writestr(item, zin.read(item.filename))

    os.replace(tmp_path, filepath)


# ---------------------------------------------------------------------------
# 04  Chart + conditional formatting
# ---------------------------------------------------------------------------

def make_chart_condformat():
    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"

    headers = ["Month", "Product A", "Product B", "Product C", "Total"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    import random
    random.seed(42)
    ws.append(headers)
    for c, h in enumerate(headers, start=1):
        ws.cell(1, c).font = Font(bold=True)
        ws.cell(1, c).fill = header_fill("4472C4")
        ws.cell(1, c).font = Font(bold=True, color="FFFFFF")

    for r_idx, month in enumerate(months, start=2):
        a = random.randint(40_000, 120_000)
        b = random.randint(30_000, 90_000)
        c_val = random.randint(20_000, 70_000)
        ws.cell(r_idx, 1).value = month
        ws.cell(r_idx, 2).value = a
        ws.cell(r_idx, 3).value = b
        ws.cell(r_idx, 4).value = c_val
        ws.cell(r_idx, 5).value = f"=SUM(B{r_idx}:D{r_idx})"
        for c in range(2, 6):
            ws.cell(r_idx, c).number_format = '#,##0'

    # --- Bar chart (Product A vs B vs C per month) ---
    chart = BarChart()
    chart.type = "col"
    chart.grouping = "clustered"
    chart.title = "Monthly Sales by Product"
    chart.y_axis.title = "Revenue (USD)"
    chart.x_axis.title = "Month"
    chart.width = 20
    chart.height = 12

    cats = Reference(ws, min_col=1, min_row=2, max_row=13)
    for col_idx, name in [(2, "Product A"), (3, "Product B"), (4, "Product C")]:
        data = Reference(ws, min_col=col_idx, min_row=1, max_row=13)
        chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    ws.add_chart(chart, "G2")

    # --- Conditional formatting: data bar on Total column (E2:E13) ---
    rule = DataBarRule(
        start_type="min", start_value=0,
        end_type="max", end_value=100,
        color="638EC6",
    )
    ws.conditional_formatting.add("E2:E13", rule)

    # --- Second sheet: Targets with colour-scale ---
    ws2 = wb.create_sheet("Targets")
    ws2.append(["Month", "Target", "Actual", "Hit?"])
    ws2.cell(1, 1).font = Font(bold=True)
    ws2.cell(1, 2).font = Font(bold=True)
    ws2.cell(1, 3).font = Font(bold=True)
    ws2.cell(1, 4).font = Font(bold=True)

    from openpyxl.formatting.rule import CellIsRule
    from openpyxl.styles import colors

    for r_idx, month in enumerate(months, start=2):
        target = random.randint(80_000, 160_000)
        actual = random.randint(70_000, 170_000)
        ws2.cell(r_idx, 1).value = month
        ws2.cell(r_idx, 2).value = target
        ws2.cell(r_idx, 3).value = actual
        ws2.cell(r_idx, 4).value = f'=IF(C{r_idx}>=B{r_idx},"✓","✗")'

    # Colour scale on Actual column: green (high) to red (low)
    from openpyxl.formatting.rule import ColorScaleRule
    color_scale = ColorScaleRule(
        start_type="min", start_color="F8696B",
        mid_type="percentile", mid_value=50, mid_color="FFEB84",
        end_type="max", end_color="63BE7B",
    )
    ws2.conditional_formatting.add(f"C2:C13", color_scale)

    for col in "ABCDE":
        ws.column_dimensions[col].width = 12
    for col in "ABCD":
        ws2.column_dimensions[col].width = 12

    wb.save(OUT / "04_chart_condformat.xlsx")
    print("  wrote 04_chart_condformat.xlsx")


# ---------------------------------------------------------------------------
# 05  Large 5 000-row data sheet
# ---------------------------------------------------------------------------

def make_large():
    import random
    random.seed(99)

    wb = Workbook()
    ws = wb.active
    ws.title = "Transactions"

    headers = [
        "TxnID", "Date", "Account", "Category",
        "Debit", "Credit", "Balance", "Note",
    ]
    ws.append(headers)
    for c, h in enumerate(headers, start=1):
        ws.cell(1, c).font = Font(bold=True)
        ws.cell(1, c).fill = header_fill("4472C4")
        ws.cell(1, c).font = Font(bold=True, color="FFFFFF")

    categories = ["Payroll", "Supplies", "Services", "Revenue", "Tax", "Refund", "Transfer"]
    accounts   = ["Operating", "Savings", "Payroll", "Tax Reserve"]
    notes      = ["auto", "manual", "batch", "adjustment", ""]

    N = 5_000
    balance = 100_000.00
    # Excel date serial for 2024-01-01
    base_serial = 45292  # 2024-01-01 in 1900 system

    for i in range(1, N + 1):
        row_idx = i + 1
        txn_id = f"T{i:05d}"
        date_serial = base_serial + (i // 3)   # ~3 txns per day
        account  = random.choice(accounts)
        category = random.choice(categories)
        debit  = round(random.uniform(0, 5_000), 2) if random.random() > 0.4 else 0
        credit = round(random.uniform(0, 5_000), 2) if debit == 0 else 0
        balance += credit - debit
        note = random.choice(notes)

        ws.cell(row_idx, 1).value = txn_id
        ws.cell(row_idx, 2).value = date_serial
        ws.cell(row_idx, 2).number_format = "YYYY-MM-DD"
        ws.cell(row_idx, 3).value = account
        ws.cell(row_idx, 4).value = category
        ws.cell(row_idx, 5).value = debit  if debit  else None
        ws.cell(row_idx, 6).value = credit if credit else None
        # Balance formula — references previous balance
        if row_idx == 2:
            ws.cell(row_idx, 7).value = f"=F{row_idx}-E{row_idx}"
        else:
            ws.cell(row_idx, 7).value = f"=G{row_idx-1}+F{row_idx}-E{row_idx}"
        ws.cell(row_idx, 8).value = note if note else None

        for c in [5, 6, 7]:
            ws.cell(row_idx, c).number_format = '#,##0.00'

    # Summary sheet
    ws2 = wb.create_sheet("Summary")
    ws2["A1"] = "Total Rows"
    ws2["B1"] = N
    ws2["A2"] = "Total Debit"
    ws2["B2"] = "=SUM(Transactions!E:E)"
    ws2["A3"] = "Total Credit"
    ws2["B3"] = "=SUM(Transactions!F:F)"
    ws2["A4"] = "Net"
    ws2["B4"] = "=B3-B2"
    ws2["A5"] = "Final Balance"
    ws2["B5"] = f"=Transactions!G{N+1}"
    for r in range(1, 6):
        ws2.cell(r, 1).font = Font(bold=True)
        ws2.cell(r, 2).number_format = '#,##0.00'

    ws.column_dimensions["A"].width = 10
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 12
    ws.column_dimensions["E"].width = 12
    ws.column_dimensions["F"].width = 12
    ws.column_dimensions["G"].width = 14
    ws.column_dimensions["H"].width = 10

    # Freeze header row
    ws.freeze_panes = "A2"

    wb.save(OUT / "05_large_5k_rows.xlsx")
    print("  wrote 05_large_5k_rows.xlsx")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Writing fixtures to {OUT}/")
    make_budget()
    make_merged_styles()
    make_shared_formulas()
    make_chart_condformat()
    make_large()
    print("Done.")
