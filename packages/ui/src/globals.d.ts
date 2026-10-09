/** Hằng số do bản dựng nhúng vào (apps/web/build.mjs, apps/desktop/build.mjs). Không có khi chạy test: luôn kiểm tra `typeof` trước khi dùng. */
interface ChangelogEntry {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
}
declare const __CHANGELOG__: ChangelogEntry[] | undefined;
declare const __APP_VERSION__: string | undefined;
