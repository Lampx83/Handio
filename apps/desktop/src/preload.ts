import { contextBridge, ipcRenderer } from "electron";

/** Cầu nối tối thiểu giữa giao diện (sandbox) và tiến trình chính. Không lộ ipcRenderer. */
contextBridge.exposeInMainWorld("neu", {
  platform: process.platform,
  call: (profile: string, method: string, args: unknown[]) => ipcRenderer.invoke("neu:call", profile, method, args),
  auth: {
    status: () => ipcRenderer.invoke("neu:auth", "status"),
    login: () => ipcRenderer.invoke("neu:auth", "login"),
    loginPassword: (username: string, password: string) => ipcRenderer.invoke("neu:auth", "loginPassword", { username, password }),
    setRemember: (value: boolean) => ipcRenderer.invoke("neu:auth", "remember", { value }),
    logout: () => ipcRenderer.invoke("neu:auth", "logout"),
    onChange: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on("neu:auth-changed", h);
      return () => ipcRenderer.removeListener("neu:auth-changed", h);
    },
  },
  update: {
    status: () => ipcRenderer.invoke("neu:update", "status"),
    check: () => ipcRenderer.invoke("neu:update", "check"),
    download: () => ipcRenderer.invoke("neu:update", "download"),
    dismiss: () => ipcRenderer.invoke("neu:update", "dismiss"),
    install: () => ipcRenderer.invoke("neu:update", "install"),
    openFolder: () => ipcRenderer.invoke("neu:update", "openFolder"),
    onChange: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on("neu:update-changed", h);
      return () => ipcRenderer.removeListener("neu:update-changed", h);
    },
  },
  onEvent: (cb: (profile: string, e: unknown) => void) => {
    const h = (_e: unknown, profile: string, ev: unknown) => cb(profile, ev);
    ipcRenderer.on("neu:event", h);
    return () => ipcRenderer.removeListener("neu:event", h);
  },
});
