// Danh tính gói MSIX cho Microsoft Store: lấy ở Partner Center → sản phẩm → Product identity (KHÔNG phải bí mật), đặt ở biến repo GitHub.
//   STORE_IDENTITY_NAME           Package/Identity/Name                 vd 12345KhachThu.NEUAgent
//   STORE_PUBLISHER               Package/Identity/Publisher            vd CN=00000000-0000-0000-0000-000000000000
//   STORE_PUBLISHER_DISPLAY_NAME  Package/Properties/PublisherDisplayName

/** Danh tính giả để dựng THỬ trên CI (kiểm tra đóng gói được); gói dựng bằng nó không nộp lên Store được. */
export const TEST_IDENTITY = Object.freeze({ identityName: "NEUAgent.Test", publisher: "CN=NEU Agent Test", publisherDisplayName: "NEU Agent (thử)" });

/** Đọc và kiểm tra danh tính từ biến môi trường. Thiếu hết thì trả `undefined`; sai dạng thì ném lỗi tiếng Việt nêu đủ các chỗ sai. */
export function storeIdentity(env) {
  const identityName = (env.STORE_IDENTITY_NAME ?? "").trim();
  const publisher = (env.STORE_PUBLISHER ?? "").trim();
  const publisherDisplayName = (env.STORE_PUBLISHER_DISPLAY_NAME ?? "").trim();
  if (!identityName && !publisher && !publisherDisplayName) return undefined;
  const bad = [];
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) bad.push("STORE_IDENTITY_NAME phải gồm 3–50 ký tự chữ, số, dấu chấm, gạch ngang (Package/Identity/Name)");
  if (!/^CN=[^\r\n]{1,8000}$/.test(publisher)) bad.push("STORE_PUBLISHER phải bắt đầu bằng CN= (Package/Identity/Publisher)");
  if (!publisherDisplayName || publisherDisplayName.length > 256 || /[\r\n]/.test(publisherDisplayName)) bad.push("STORE_PUBLISHER_DISPLAY_NAME phải có 1–256 ký tự, một dòng (Package/Properties/PublisherDisplayName)");
  if (bad.length) throw new Error("Danh tính gói Store không hợp lệ:\n- " + bad.join("\n- "));
  return { identityName, publisher, publisherDisplayName };
}
