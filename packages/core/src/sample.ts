/** Dự án mẫu nhỏ (có một lỗi cố ý) để thử agent: bản web nạp vào thư mục ảo; bản desktop chép ra thư mục tạm. */
export const SAMPLE_PROJECT: Record<string, string> = {
  "README.md": "# Máy tính điểm\n\nThư viện nhỏ tính điểm trung bình của sinh viên.\n\n- `src/grades.js`: hàm `average(scores)`.\n- `src/grades.test.js`: kiểm tra nhanh, chạy bằng `node src/grades.test.js`.\n",
  "AGENTS.md": "# Hướng dẫn cho agent\n\n- Viết mã JavaScript thuần (CommonJS), không thêm thư viện.\n- Bình luận bằng tiếng Việt.\n- Sau khi sửa phải chạy lại `node src/grades.test.js`.\n",
  "src/grades.js": '// Tính điểm trung bình của một danh sách điểm.\nfunction average(scores) {\n  const total = scores.reduce((sum, s) => sum + s, 0);\n  return total / (scores.length + 1);\n}\n\nif (typeof module !== "undefined") module.exports = { average };\n',
  "src/grades.test.js": 'const { average } = require("./grades");\n\nconst got = average([8, 9, 10]);\nif (Math.abs(got - 9) > 1e-9) {\n  console.error("FAIL: average([8, 9, 10]) =", got, "(mong đợi 9)");\n  process.exit(1);\n}\nconsole.log("OK: average =", got);\n',
};
