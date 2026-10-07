import { contextBridge, ipcRenderer } from "electron";

/** Cầu nối tối thiểu giữa giao diện (sandbox) và tiến trình chính. Không lộ ipcRenderer. */
contextBridge.exposeInMainWorld("neu", {
  platform: process.platform,
  call: (profile: string, method: string, args: unknown[]) => ipcRenderer.invoke("neu:call", profile, method, args),
  onEvent: (cb: (profile: string, e: unknown) => void) => {
    const h = (_e: unknown, profile: string, ev: unknown) => cb(profile, ev);
    ipcRenderer.on("neu:event", h);
    return () => ipcRenderer.removeListener("neu:event", h);
  },
});
