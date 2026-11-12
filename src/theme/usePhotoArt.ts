/*
 * photo-left 的左图：把"状态 + 用户图片目录"解析成一个 asset:// 地址。
 *
 * 一、目录只列一次（挂载时异步列一遍），状态切换只在这份清单里重新挑，不重复走 IPC。
 * 二、没有任何磁盘能力（浏览器预览 / 权限没开）→ 返回 null，调用方退化成纯色块。
 * 三、这个 hook 不抛错：任何一层失败都被 io.ts 收成 [] / null。
 */
import { useEffect, useMemo, useState } from "react";
import { appDataDirOf, listDirFiles, toAssetUrl } from "./io";
import { themeAssetPath } from "./paths";
import { photoDirOf, pickPhotoFile } from "./photoLeft";
import type { MascotState } from "./types";

export function usePhotoArt(state: MascotState): string | null {
  const [dir, setDir] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const appData = await appDataDirOf();
      if (!alive || appData === null) return;
      const target = photoDirOf(appData);
      const listed = await listDirFiles(target);
      if (!alive) return;
      setDir(target);
      setFiles(listed);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const file = useMemo(() => (files === null ? null : pickPhotoFile(files, state)), [files, state]);

  return useMemo(() => {
    if (dir === null || file === null) return null;
    return toAssetUrl(themeAssetPath(dir, file));
  }, [dir, file]);
}
