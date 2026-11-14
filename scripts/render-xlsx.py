# 由 competition-score.mjs 调用：从 stdin 读 JSON（{zh, en, all}），
# 生成三张工作表的 比赛排名.xlsx（9 列：排名/昵称/五章得分/时间加分/总得分）。
# 美化：表头深蓝白字、斑马纹、满 675 金色高亮（第 1 名更深的金）、冻结首行、自动筛选。
# 依赖：python + openpyxl
import json
import os
import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HEADER = ['排名', '昵称', '第一章得分', '第二章得分', '第三章得分', '第四章得分', '第E章得分', '时间加分', '总得分']
WIDTHS = [6, 28, 11, 11, 11, 11, 11, 11, 10]
SHEETS = [('中文版', 'zh'), ('英文版', 'en'), ('全体排名', 'all')]
CHAPTERS = ['ch1', 'ch2', 'ch3', 'ch4', 'chE']

HEADER_FILL = PatternFill('solid', fgColor='305496')  # 表头深蓝
HEADER_FONT = Font(bold=True, color='FFFFFF')
TOP_FILL = PatternFill('solid', fgColor='FFD966')     # 第 1 名（金）
FULL_FILL = PatternFill('solid', fgColor='FFF2CC')    # 内置分满 675（浅金）
CELL_FULL_FILL = PatternFill('solid', fgColor='FFEB9C')  # 未满 675 者某章满分的格子（黄）
ZEBRA_FILL = PatternFill('solid', fgColor='F2F2F2')   # 斑马纹
# 各章满分（= 满 675 玩家的各章合计）
CHAPTER_MAX = {'ch1': 120, 'ch2': 102, 'ch3': 133, 'ch4': 108, 'chE': 212}
THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal='center', vertical='center')
LEFT = Alignment(horizontal='left', vertical='center')


def main():
    data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    out_file = sys.argv[1] if len(sys.argv) > 1 else '比赛排名.xlsx'

    wb = Workbook()
    wb.remove(wb.active)

    for sheet_name, key in SHEETS:
        ws = wb.create_sheet(sheet_name)

        # 表头
        ws.append(HEADER)
        for cell in ws[1]:
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = CENTER
            cell.border = BORDER

        # 数据行
        for idx, row in enumerate(data[key], start=2):
            base = sum(row['scores'][c] for c in CHAPTERS)
            full = base == 675
            ws.append([
                row['rank'],
                row['nick'],
                row['scores']['ch1'],
                row['scores']['ch2'],
                row['scores']['ch3'],
                row['scores']['ch4'],
                row['scores']['chE'],
                row['timeBonus'],
                row['total'],
            ])

            if row['rank'] == 1:
                fill = TOP_FILL
            elif full:
                fill = FULL_FILL
            elif idx % 2 == 0:
                fill = ZEBRA_FILL
            else:
                fill = None

            for cell in ws[idx]:
                cell.border = BORDER
                cell.alignment = LEFT if cell.column == 2 else CENTER
                if fill:
                    cell.fill = fill
            if full:  # 满 675：昵称与总得分加粗
                ws.cell(idx, 2).font = Font(bold=True)
                ws.cell(idx, 9).font = Font(bold=True)
            else:
                # 未满 675：某一章拿到该章满分 → 该格标黄（列 3~7 为五章得分）
                for col_idx, ch in enumerate(CHAPTERS, start=3):
                    if row['scores'][ch] == CHAPTER_MAX[ch]:
                        ws.cell(idx, col_idx).fill = CELL_FULL_FILL

        for cell_idx, width in enumerate(WIDTHS, start=1):
            ws.column_dimensions[get_column_letter(cell_idx)].width = width
        ws.freeze_panes = 'A2'

    try:
        wb.save(out_file)
        print(f'已写入: {out_file}')
    except PermissionError:
        # 目标文件被占用（常见：用户正用 Excel 打开着）→ 另存带时间戳的副本
        stem, ext = os.path.splitext(out_file)
        fallback = f'{stem}-{datetime.now():%Y%m%d-%H%M%S}{ext}'
        wb.save(fallback)
        print(f'原文件被占用（Excel 打开中？），已另存为: {fallback}')


if __name__ == '__main__':
    main()
