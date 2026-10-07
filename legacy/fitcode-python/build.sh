#!/bin/sh
# Đóng gói thành một file chạy được: dist/fitcode.pyz  (cần Python >= 3.8 trên máy chạy)
set -e
cd "$(dirname "$0")"
rm -rf build dist && mkdir -p build dist
cp -R fitcode build/fitcode
find build -name '__pycache__' -type d -prune -exec rm -rf {} +
printf 'from fitcode.cli import main\nmain()\n' > build/__main__.py
python3 -m zipapp build -o dist/fitcode.pyz -p '/usr/bin/env python3' -c
rm -rf build
echo "Đã tạo dist/fitcode.pyz ($(wc -c < dist/fitcode.pyz) byte)"
