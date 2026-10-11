# Gói mở rộng (extension packs)

Hando thêm tính năng bằng **gói mở rộng**, không phải bằng cách sửa mã nguồn lõi. Lõi (`packages/core`, `packages/ui`, `apps/*`) là phần chung: động cơ agent, công cụ, giao diện. Mọi thứ riêng của một tổ chức hay một nghiệp vụ — quy trình, mẫu, văn phong, công cụ nối với hệ thống nội bộ — nằm trong gói.

**Lợi ích:** triển khai cho tổ chức khác = giữ nguyên mã, thay bộ gói. Thêm tính năng mới = thêm một thư mục, không cần dựng lại ứng dụng ở bản web.

## 1. Gói là gì

Một thư mục chỉ chứa tệp chữ:

```
packs/<id>/
  pack.json                 bắt buộc: {id, name, version, description, profiles?}
  prompt.md                 lời dặn thêm vào system prompt (quy ước, văn phong); ≤ 6000 ký tự
  skills/<tên>/SKILL.md     quy trình/kiến thức agent nạp khi cần (+ tệp kèm .md/.txt/.json…)
  commands/<tên>.md         lệnh /tên; thư mục con thành "a:b"; $ARGUMENTS, $1…$9
  agents/<tên>.md           subagent chuyên biệt (name, description, tools)
  tools.json                công cụ gọi dịch vụ HTTP của tổ chức (tìm web…)      — chỉ gói org/user
  mcp.json                  máy chủ MCP = công cụ mới (email, lịch…)             — chỉ gói org/user
  hooks.json                hook chạy lệnh theo sự kiện                         — chỉ gói org/user
```

`pack.json`:
```json
{ "id": "giang-vien", "name": "Công cụ cho giảng viên", "version": "1.0.0",
  "description": "Đề cương, đề thi, rubric…", "profiles": ["work"] }
```
`profiles` chọn tab dùng gói (`work`, `code`, `design`; bỏ trống = cả ba). `id` chỉ gồm `a-z`, `0-9`, `-`.

Tệp `SKILL.md`, lệnh và subagent dùng frontmatter giống `.neuagent/` của dự án:
```markdown
---
description: Soạn đề cương chi tiết môn học
---
Soạn đề cương cho môn: $ARGUMENTS …
```

## 2. Gói nằm ở đâu, ai được tin

| Nguồn | Vị trí | Tin cậy |
|---|---|---|
| **org** — quản trị cài | Desktop: `/Library/Application Support/NEU Agent/packs/` (macOS), `%ProgramData%\NEU Agent\packs\` (Windows), hoặc đi kèm bản cài (`resources/packs`, lấy từ thư mục `packs/` của kho mã). Web: `packs.json` sinh lúc dựng từ `packs/` (hoặc `NEU_PACKS_DIR`) | có |
| **user** — người dùng tự cài | Desktop: `<thư mục dữ liệu ứng dụng>/packs/` | có |
| **project** — nằm trong dự án | `<dự án>/.neuagent/packs/<tên>/` | **không** |

- Gói **không tin cậy** (trong dự án) chỉ được có *nội dung chữ* (kỹ năng, lệnh, subagent, lời dặn). `mcp.json`, `hooks.json` và `tools.json` bị bỏ qua và có cảnh báo, vì chúng chạy chương trình thật hoặc gọi dịch vụ. Lý do: một thư mục tải từ nơi lạ không được tự chạy mã trên máy bạn.
- Trùng `id`: gói gần người dùng hơn thắng (project > user > org). Trùng tên lệnh/skill/subagent: phần của **dự án** ghi đè gói; giữa các gói, gói đứng trước (theo tên thư mục) thắng.
- Gói hỏng (JSON sai, id lạ) bị bỏ qua và hiện thành thông báo khởi động; không làm hỏng ứng dụng. Giới hạn: ≤ 300 tệp/gói, mỗi tệp ≤ 100 KB.
- Nội dung đọc từ gói là hướng dẫn cho agent, không có quyền cao hơn người dùng; quyền công cụ (hỏi trước khi ghi/chạy) vẫn áp dụng như thường.

Trong ứng dụng: gõ `/packs` xem gói đang bật; lệnh của gói hiện trong danh sách `/`.

## 3. Thêm công cụ mới

### 3a. Công cụ HTTP (`tools.json`) — chạy được cả ở bản web lẫn Desktop
Nối agent với dịch vụ của tổ chức (tìm web, tra cứu nội bộ…) bằng khai báo, không cần mã. Địa chỉ luôn là đường dẫn **dưới địa chỉ gốc dịch vụ của ứng dụng** (`toolsBase`: web = thư mục của trang, vd `https://ai.neu.edu.vn/agent/`; Desktop = máy chủ của tổ chức), kèm đăng nhập sẵn có; không gọi được máy chủ khác.
```json
{ "web_search": {
    "description": "Search the web …",
    "readonly": true,
    "parameters": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] },
    "http": { "method": "GET", "path": "tools/search", "query": { "q": "{query}" } } } }
```
`{tên}` được thay bằng đối số công cụ (tham số trống thì bỏ). `POST` có thể kèm `body` JSON. Dịch vụ nên trả **văn bản gọn** cho mô hình (≤ 20.000 ký tự). `readonly: true` = chỉ tra cứu, không hỏi từng lần; bỏ trống = hỏi như `web_fetch` (nên dùng cho công cụ mà địa chỉ/đối số có thể đi tới máy chủ ngoài). Kết quả luôn là dữ liệu không tin cậy: sau khi nhận, ghi file/chạy lệnh được hỏi lại. Bộ gói `tim-kiem-web` là ví dụ; dịch vụ phía sau nó ở `deploy/220/tools/` (xem [DEPLOY.md](DEPLOY.md), mục “Công cụ web”).

### 3b. Công cụ MCP (`mcp.json`)

Công cụ mới (tìm kiếm web, đọc email, lịch, hệ thống nội bộ) thêm qua `mcp.json` của gói **org/user**:
```json
{ "tim-kiem": { "command": "node", "args": ["server.js"], "env": { "SEARCH_URL": "https://…" } } }
```
Máy chủ MCP chạy cục bộ trên máy người dùng (chỉ Desktop; bản web không chạy được chương trình, hãy dùng 3a). Công cụ MCP của gói dùng được ở mọi tab; kết quả từ MCP là dữ liệu không tin cậy (sau khi nhận, ghi file/chạy lệnh được hỏi lại).

## 4. Triển khai cho tổ chức khác

1. Giữ nguyên mã. Tạo thư mục gói riêng (ví dụ `packs-abc/`) rồi dựng với `NEU_PACKS_DIR=packs-abc` (web: `npm run build -w @neu/agent-web`; Desktop: đặt gói vào `packs/` hoặc cài vào thư mục quản trị ở trên).
2. Đổi địa chỉ máy chủ/tên sản phẩm bằng cấu hình dựng và `policy.json` (xem [DEPLOY.md](DEPLOY.md), [INSTALL.md](INSTALL.md)).
3. Bộ gói của NEU nằm ở `packs/` (xem [packs/README.md](../packs/README.md)); tổ chức khác không cần dùng chúng.

## 5. Viết gói tốt

- **Một việc, làm trọn**: lệnh nên ra sản phẩm hoàn chỉnh (tệp mới, đã tự kiểm tra), không chỉ "gợi ý".
- **Chỉ tên công cụ có thật** trong dấu huyền (test `packs-shipped.test.ts` kiểm tra bộ gói đi kèm: không trùng lệnh, subagent chỉ dùng công cụ tồn tại).
- **Không bịa**: dặn agent ghi "[cần bổ sung]" khi thiếu thông tin thay vì đoán số liệu, tên, căn cứ pháp lý.
- **Ngắn**: skill chỉ nạp khi cần nên có thể dài hơn lệnh; `prompt.md` luôn nằm trong ngữ cảnh nên phải rất ngắn.
- Mỗi lần thêm/sửa gói người dùng thấy: ghi vào [CHANGELOG.md](../CHANGELOG.md) (xem [RELEASE.md](RELEASE.md)).

## 6. Kiểm thử

```bash
node scripts/packs.mjs          # liệt kê gói và số tệp
npx vitest run packages/core/test/packs.test.ts packages/core/test/packs-shipped.test.ts
```
