import docx
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

doc = docx.Document()
tbl = doc.add_table(rows=2, cols=2)
cell = tbl.cell(0, 0)
tcPr = cell._tc.get_or_add_tcPr()
shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="1E3A8A"/>')
tcPr.append(shd)
doc.save("test_table.docx")
print("Table styling test passed!")
