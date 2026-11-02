import { contextBridge, ipcRenderer } from 'electron';

export interface AppInfo {
  name: string;
  version: string;
}

export interface FsebAPI {
  openFilePicker: () => Promise<string | null>;
  startExamFromFile: (filePath: string) => Promise<boolean>;
  retryLoading: () => Promise<void>;
  closeApplication: () => Promise<void>;
  reloadExam: () => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  onStateUpdate: (callback: (state: string, details?: Record<string, unknown>) => void) => void;
  onShowQuitModal: (callback: () => void) => void;
}

const api: FsebAPI = {
  openFilePicker: () => ipcRenderer.invoke('fseb:open-file-picker'),
  startExamFromFile: (filePath: string) => ipcRenderer.invoke('fseb:start-exam', filePath),
  retryLoading: () => ipcRenderer.invoke('fseb:retry-loading'),
  closeApplication: () => ipcRenderer.invoke('fseb:close-app'),
  reloadExam: () => ipcRenderer.invoke('fseb:reload-exam'),
  getAppInfo: () => ipcRenderer.invoke('fseb:get-app-info'),
  onStateUpdate: (callback) => {
    ipcRenderer.on('fseb:state-update', (_event, { state, details }) => {
      callback(state, details);
    });
  },
  onShowQuitModal: (callback) => {
    ipcRenderer.on('fseb:show-quit-modal', () => {
      callback();
    });
  },
};

contextBridge.exposeInMainWorld('fsebAPI', api);
