# Bộ eval hành vi của agent

Trả lời câu hỏi: **một thay đổi có làm agent làm việc tốt hơn không?** Kiểm thử `FakeLlm` chỉ chứng minh mã chạy đúng; bộ này chạy agent thật với mô hình thật trên 14 bài có dữ liệu giả, rồi chấm **kết quả cuối** (tệp, máy chủ đang chạy, trang web, lời cuối), không chấm đường đi.

Gọi mô hình thật chỉ khi bạn chạy lệnh; không nằm trong `npx vitest run` hay CI.

## Chạy

```bash
node labs/agent-eval/run.mjs --self-test                 # kiểm chứng bộ chấm, không gọi mô hình
node labs/agent-eval/run.mjs --k 3                       # mọi bài, mỗi bài 3 lần
node labs/agent-eval/run.mjs --only 05,06 --k 5          # vài bài
node labs/agent-eval/run.mjs --group regression --k 3    # một nhóm
node labs/agent-eval/run.mjs --compare <trước> <sau>     # so sánh hai lần chạy
node labs/agent-eval/run.mjs --list                      # in đề bài
```

Thông tin đăng nhập giống [`labs/code-bench`](../code-bench/README.md): để chương trình hỏi trong terminal, hoặc đặt `HANDIO_BENCH_USER` + `HANDIO_BENCH_PASSWORD` / `HANDIO_BENCH_KEY`. Không ghi vào kho.

Các bài chạy lần lượt vì máy chủ chỉ có một GPU; mỗi bài giới hạn 15 phút (`--timeout-min`). Kết quả nằm ngoài kho, ở `$TMPDIR/handio-agent-eval/<lần-chạy>/` (đổi bằng `--out`): `report.md`, `summary.json`, và `<bài>/<lần>/` gồm `app/`, `agent.log`, `checks.json`.

Mã thoát: 0 khi mọi bài regression đạt; 1 khi có bài regression hỏng hoặc bị tụt (lúc `--compare`); 2 khi sai cấu hình, không kết nối được.

## So sánh trước/sau một thay đổi

```bash
git switch main && node labs/agent-eval/run.mjs --k 5 --out /tmp/eval-truoc
git switch nhanh-cua-ban && node labs/agent-eval/run.mjs --k 5 --out /tmp/eval-sau
node labs/agent-eval/run.mjs --compare /tmp/eval-truoc /tmp/eval-sau
```

Mô hình trả lời khác nhau mỗi lần, nên chênh một lần đạt khi `k` nhỏ có thể chỉ là ngẫu nhiên; bảng so sánh sẽ nhắc điều này. Commit trước khi chạy để biết kết quả thuộc mã nào.

## Hai nhóm bài

- **regression**: kiểu hỏng đã có bản sửa, phải luôn đạt. Hỏng thì đừng triển khai khi chưa hiểu vì sao.
- **capability**: đang cải thiện, chỉ đo xu hướng, hỏng không làm đỏ lệnh.

Một bài capability đạt k/k ở hai lần chạy liên tiếp thì chuyển sang regression. Cách chia hiện tại là **giả định ban đầu**, chưa có số đo với mô hình thật.

| Bài | Nhóm | Tab | Kiểu hỏng mô phỏng |
|---|---|---|---|
| 01 fe-be-song-song | regression | Code | Bật backend và frontend, cái sau làm mất cái trước |
| 02 fe-goi-api-loi | capability | Code | Lỗi chỉ thấy trên trình duyệt, curl không thấy |
| 03 python-tieng-viet | regression | Code | Python in tiếng Việt lỗi mã hoá (chỉ thật sự bộc lộ trên Windows) |
| 04 loi-chi-khi-bam | capability | Code | Trang tải sạch, bấm nút mới lỗi |
| 05 pptx-sua-chu | capability | Work | `pptx_edit` không khớp vì chữ bị tách đoạn |
| 06 pptx-dai | capability | Work | `create_pptx` hỏng JSON khi tham số dài |
| 07 docx-dai | capability | Work | Văn bản dài phải ghi nối nhiều lần |
| 08 doc-duong-dan-day-du | capability | Work | `read_document` nhận đường dẫn tuyệt đối trong dự án |
| 09 doc-ngoai-du-an | regression | Work | Tệp ngoài dự án: phải nói rõ, không lặp, không đoán |
| 10 sua-tep-crlf | capability | Code | `edit_file` với tệp CRLF, có tab và tiếng Việt |
| 11 csv-tong-hop | capability | Work | Tính số liệu bằng công cụ thay vì tính nhẩm |
| 12 luong-nhieu-buoc | capability | Code | Làm trang nhiều bước, phải tự đi hết luồng |
| 13 xlsx-cong-thuc | capability | Work | Excel phải có công thức sống |
| 14 design-poster | capability | Design | Mốc đầu cho tab Design |

## Thêm bài

Thêm vào `tasks.ts`, gồm đề, tệp sẵn có, bộ chấm và **lời giải mẫu**. `--self-test` kiểm tra đề chưa làm phải không đạt, làm theo lời giải phải đạt: bộ chấm không phân biệt được hai trạng thái này thì vô dụng. Bài không cần trình duyệt ẩn còn được kiểm chứng trong `npx vitest run`.

Bài viết tay, dữ liệu giả. Số liệu chẩn đoán không chứa nội dung, và phiên người dùng tự chia sẻ chỉ dùng để hiểu kiểu hỏng: **không chép nội dung người dùng vào đây** (kho công khai).

## Chỗ khác với bản thật

- `check_page` dùng trình duyệt ẩn `labs/code-bench/probe.cjs`, không phải `apps/desktop/src/page-check.ts`. Chưa hỗ trợ chụp ảnh.
- Agent chạy trong sandbox macOS, chưa chạy trong container và chưa thử trên Windows, nơi nhiều lỗi thật xảy ra.
- `ask_user` luôn được trả lời "để agent tự quyết"; quyền luôn được cho phép.
- Tab Design không có công cụ dựng ảnh của Electron.
